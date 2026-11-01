/**
 * The collaboration bus control channel.
 *
 * Three defects in this project shared a shape worth naming before reading this file: a
 * component that is present, is not disabled, and does not do its job. The defence is the one
 * used everywhere else here — a claim is worth what a failing test says about it.
 *
 * ## What it is not
 *
 * It does not replace, wrap or rename the kernel's Agent Teams service. `ctx.agentTeams` keeps
 * working exactly as upstream shipped it; this plugin publishes a separate capability beside
 * it. A wrapper is the easiest thing to write and the worst thing to own: the compatibility
 * layer exists because the kernel renames and re-shapes its services, and a wrapper would
 * freeze one of those shapes into this repository.
 *
 * ## The two channels
 *
 * The kernel keeps one mailbox for everything. The collaboration bus separates two
 * dispositions, and the separation is the point:
 *
 *   control   who changed what, when, with what intent. Append-only, on disk, replayable. A
 *             restart must not lose it and must not renumber it.
 *   data      token streams and intermediate payloads. In memory, expiring, never on disk.
 *             Losing it on restart is correct, not a defect.
 *
 * The separation is enforced by construction rather than by a rule: the two channels share no
 * queue, no counter and no file. A control append cannot queue behind a data flood because
 * there is nothing to queue behind.
 *
 * ## Durability
 *
 * The control log is one JSONL file. Its own format, not the kernel's session persistence: a
 * session log is a transcript of a conversation, while this is a ledger of team state changes,
 * with different retention and different readers. The compat table records that choice.
 *
 * Sequences come from the file: on open, the log reads the highest sequence it holds and
 * continues. Appends are serialised through one writer queue, and a lock file keeps a second
 * process out, because two writers sharing a counter is how a ledger gets duplicate keys.
 */
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import type { WriteStream } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto'
import { serialize as v8Serialize, deserialize as v8Deserialize } from 'node:v8'
import { Worker } from 'node:worker_threads'
import { FOLD_WORKER_SOURCE } from './fold-worker.ts'
import { spawn as spawnChild } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { STATUS_PATH } from './status-path.ts'
import { busStatus } from './bus-status.ts'
import type { BusStatus, RelayReading } from './bus-status.ts'
import { computeShadowDiagnostics, computeShadowFor, disposeComputeShadow, resolveFoldEngine } from './compute-engine.ts'
import type { ComputeShadowDiagnostics } from './compute-engine.ts'

export const name = 'dsh-link-collab'

/** The channel a record belongs to. */
export type Channel = 'control' | 'data'

/** One control-channel record. Immutable once appended. */
export interface ControlRecord {
  /** Monotonic sequence, assigned by the log. */
  readonly seq: number
  /** Always 'control', so a reader never has to know which channel it is reading. */
  readonly channel: 'control'
  /** Milliseconds since the epoch, as the writer saw the clock. */
  readonly at: number
  /** What happened, in the caller's vocabulary. */
  readonly kind: string
  /** Who caused it: a member name, a session id, an adapter id. */
  readonly actor?: string
  /** What it happened to. */
  readonly subject?: string
  /** Anything else needed to reconstruct the change. */
  readonly payload?: unknown
  /**
   * The log that produced this record: the local log name for one written here, the peer's name
   * for one ingested from a relay.
   *
   * `seq` alone cannot be a global key once two devices write: two ledgers both number their
   * records from 1, so a fold that dedupes by `seq` merges unrelated records and a relay that
   * orders by `seq` interleaves two writers into one hole nobody reports.
   */
  readonly writer?: string
  /**
   * This record's number in its writer's own stream: how many records that writer had produced when
   * it wrote this one.
   *
   * It is **not** the local `seq` once a log holds records it ingested. `seq` counts the whole merged
   * ledger — a log that took in three of a peer's records and then wrote one has a local `seq` of 4
   * for its own first record — while the own stream counts that writer's own work, which is what a
   * peer resumes against. Numbering a local record by the merged ledger instead made the second
   * writer's first batch arrive as a hole the receiver is right to refuse, so it could never be
   * heard (R42 measured it; R43 fixed it).
   */
  readonly originSeq?: number
  /**
   * The identity of the log that produced this record, as that log minted it.
   *
   * A writer name is a label a caller chooses; only the instance distinguishes "the same peer" from
   * "a peer that rebuilt its ledger and started numbering again". Without it the receiver reports a
   * rewritten peer's first records as already applied, and — when the new history is longer — keeps
   * the old writer's tail and the new writer's head as one continuous stream.
   */
  readonly instance?: string
}

/** One data-channel entry. Never persisted. */
export interface DataEntry {
  /** Always 'data'. */
  readonly channel: 'data'
  /** What this entry is. */
  readonly kind: string
  /** When it was put. */
  readonly at: number
  /** The entry. */
  readonly payload?: unknown
}

/** What a damaged log could not be read back as. */
export interface DamageReport {
  /** Lines that were not valid records, with their 1-based line numbers. */
  readonly brokenLines: readonly number[]
  /** Highest sequence that was readable, or 0 when nothing was. */
  readonly lastGoodSeq: number
  /** Bytes the file holds. */
  readonly bytes: number
}

/** Options for opening a control log. */
export interface LogOptions {
  /** Directory holding the log. Created when absent. */
  readonly dir: string
  /** How long a data entry stays readable, in milliseconds. @default 30000 */
  readonly dataTtlMs?: number
  /** Entries retained per data stream. @default 256 */
  readonly dataCapacity?: number
  /** Injectable clock, so a test need not wait. @default Date.now */
  readonly now?: () => number
  /**
   * Take the writer lock even when its record names a live process.
   *
   * The lock asks whether a process id is alive, which is not the same question as whether that
   * process holds this log: a recycled id, or an unrelated live process, can leave a log nobody
   * can open while its owner is gone. This is the supported way back, and it is a caller's explicit
   * decision rather than a fault-injection switch, because recovery must not depend on a test arm.
   * @default false
   */
  readonly reclaim?: boolean
  /**
   * The name this log's own records carry as their writer, and the name a peer must use when it
   * relays them. Two devices sharing one name is the configuration this replaces.
   * @default 'local'
   */
  readonly writer?: string
}

/** The public face of one open control log. */
export interface ControlLog {
  /**
   * Append one record and return the sequence it was given.
   * @param record - the record, without a sequence; `at` defaults to now.
   * @returns the assigned sequence.
   */
  append(record: { kind: string, actor?: string, subject?: string, payload?: unknown, at?: number }): Promise<number>
  /**
   * Read records after a cursor.
   * @param since - exclusive lower bound; 0 reads from the beginning.
   * @param limit - maximum records to return.
   * @returns the records, in sequence order.
   */
  page(since?: number, limit?: number): ControlRecord[]
  /**
   * Read every record in sequence order.
   * @returns all records.
   */
  replay(): ControlRecord[]
  /** Highest sequence assigned so far. */
  readonly lastSeq: number
  /**
   * The content digest (sha1, hex) of this log's lines, hashed natively at open and continued by every
   * successful append.
   *
   * A checkpoint stores the digest of the prefix it folded (which, at save, is the whole ledger); a
   * reader compares it before trusting the cache. Native hashing keeps the proof off the JS loop:
   * R502 measured ~9 ms / 18 MB at 100k rows, well under the 20%-of-fold budget.
   */
  readonly digest: string
  /**
   * Whether page()/replay() can answer from what the open already holds (R504).
   *
   * False while a checkpoint-accelerated open has not yet parsed the prefix: the rows are read on
   * the first call that needs them, and a caller that only wants the fold state never pays it.
   */
  readonly recordsMaterialised: boolean
  /**
   * Which tier read this ledger (R504): empty, stamp-trusted, stream-verified or full-parse.
   *
   * A reading, not a promise: it says how much integrity the open actually proved, which is the
   * number a status row or a gate grades the fast path by.
   */
  readonly openTier: LedgerOpenTier
  /** The name this log's own records carry as their writer. */
  readonly writer: string
  /**
   * This log's identity, minted once and kept in its directory.
   *
   * A peer resumes against the pair (writer, instance): the name says which device, the instance
   * says which of that device's ledgers. A log that loses its directory gets a new instance, and a
   * receiver sees that as a rewritten peer rather than as records it has already applied.
   */
  readonly instance: string
  /**
   * Per-writer high-water marks.
   * @returns one mark per writer this log holds records from, in first-seen order.
   */
  marks(): readonly WriterMark[]
  /**
   * This log's own records, in the order this log produced them.
   *
   * The numbers these rows carry ({@link ControlRecord.originSeq}) are their positions in this log's
   * own stream — 1, 2, 3 — and not their positions in the merged ledger, so a peer that has never
   * seen this log can take the batch from its first record whatever this log ingested meanwhile.
   * @param since - exclusive lower bound on this log's own stream; 0 reads from the beginning.
   * @param limit - maximum records to return.
   * @returns the records this writer produced, relayed ones excluded.
   */
  ownPage(since?: number, limit?: number): ControlRecord[]
  /**
   * Apply a batch from another log.
   *
   * A batch that is wholly or partly already applied is caught up rather than duplicated, so a
   * peer may re-send after a reconnect; the overlap is compared record by record, because the same
   * position holding different content is a conflict rather than a re-send. A batch that would leave
   * a hole is refused: a fold over records with a gap reports a state no writer ever produced. A
   * batch whose writer name is already held under another instance is refused unless it asks to be
   * adopted, which is how a peer that rebuilt its ledger is taken without losing either history. The
   * receiver's own writer name is not adoptable: a peer rebuilds its own ledger, never this one's.
   * @param batch - the records, the writer they belong to, and that log's instance.
   * @returns how many records were accepted and how many were already applied.
   * @throws RelayError when the batch names no writer or instance, starts after a hole, contains
   * one, arrives under a different instance without `adopt`, or contradicts an applied record.
   */
  ingest(batch: RelayBatch): Promise<RelayResult>
  /** The directory this log owns, so a caller can say where its ledger is. */
  readonly directory: string
  /** What the reader could not parse when the log was opened, or null when it was clean. */
  readonly damage: DamageReport | null
  /**
   * Put one entry on the data channel.
   * @param key - the stream this entry belongs to.
   * @param entry - the entry; `at` defaults to now.
   */
  put(key: string, entry: { kind: string, payload?: unknown, at?: number }): void
  /**
   * Read a data stream, oldest first, dropping expired entries.
   * @param key - the stream to read.
   * @returns the live entries.
   */
  take(key: string): DataEntry[]
  /** Number of live data entries across every stream. */
  dataSize(): number
  /** Flush pending writes and close. Appends after this reject rather than writing. */
  close(): Promise<void>
}

/** One record as it travels between logs: the origin's sequence, and nothing local. */
export interface RelayRecord {
  /** The record's sequence in the writer's own log. */
  readonly seq: number
  /** What happened, in the caller's vocabulary. */
  readonly kind: string
  /** Who caused it. */
  readonly actor?: string
  /** What it happened to. */
  readonly subject?: string
  /** Anything else needed to reconstruct the change. */
  readonly payload?: unknown
  /** The origin's clock, so the receiving log does not restamp it. */
  readonly at?: number
}

/** A batch from one writer, in that writer's sequence order. */
export interface RelayBatch {
  /** The log the batch came from. Every record is recorded as its work. */
  readonly writer: string
  /** The sending log's instance identity, as `log.instance` names it. */
  readonly instance: string
  /**
   * Accept the batch even though this writer name is already held under a different instance.
   *
   * A peer that rebuilt its ledger must say so: the receiver then drops the old instance's
   * high-water mark and treats the new history as a new stream, keeping the old records as history.
   * @default false
   */
  readonly adopt?: boolean
  /** The records, in the writer's sequence order. */
  readonly records: readonly RelayRecord[]
}

/** What one writer instance's records add up to in this log. */
export interface WriterMark {
  /** The writer's name, as the peer calls itself. */
  readonly writer: string
  /** The instance of that writer these records came from. */
  readonly instance: string
  /** The highest sequence seen from it, which is what a peer must resume after. */
  readonly lastSeq: number
  /** How many of its records this log holds. */
  readonly records: number
}

/** What one ingest did. */
export interface RelayResult {
  /** The writer the batch came from. */
  readonly writer: string
  /** How many records this log accepted. */
  readonly appended: number
  /** How many records the batch carried that were already applied. */
  readonly skipped: number
}

/** A batch this log refuses, with a code a caller can branch on. */
export class RelayError extends Error {
  /**
   * @param code - `RELAY_GAP` for a batch that starts after a hole, `RELAY_HOLE` for a batch that
   * contains one, `RELAY_WRITER_MISSING` for a batch that names no writer or instance,
   * `RELAY_REWRITTEN` for a writer name already held under another instance without `adopt`,
   * `RELAY_CONFLICT` for a record whose content differs from the one already applied at that
   * position, `RELAY_MALFORMED` for a batch whose records do not carry distinct positive integer
   * sequences, and `RELAY_IMPERSONATION` for a batch that claims this log's own identity —
   * including this log's own writer name under another instance, which `adopt` does not exempt.
   * @param message - what happened, in terms of the sequences involved.
   */
  constructor(readonly code: 'RELAY_GAP' | 'RELAY_HOLE' | 'RELAY_WRITER_MISSING' | 'RELAY_REWRITTEN' | 'RELAY_CONFLICT' | 'RELAY_MALFORMED' | 'RELAY_IMPERSONATION', message: string) {
    super(message)
    this.name = 'RelayError'
  }
}

/** What one relay exchange over the network returned. */
export interface RelayPushResult {
  /** Whether the receiver accepted the batch. */
  readonly ok: boolean
  /** How many records the receiver appended. */
  readonly appended: number
  /** How many records it already held. */
  readonly skipped: number
  /** The receiver's refusal code, when it refused. */
  readonly code?: string
}

/** Where this plugin accepts relay batches, and how it has answered them so far. */
export interface RelayService {
  /** Whether the route is registered on a web server. */
  readonly bound: boolean
  /** The pathname a peer must POST to. */
  readonly path: string
  /** Batches accepted. */
  readonly accepted: number
  /** Requests refused, with the last reason. */
  readonly refused: number
  /** The code of the last refusal, or null. */
  readonly lastCode: string | null
}

/** Options for {@link LinkCollab.relayTo}. */
export interface RelayPushOptions {
  /** The receiver's relay URL, including scheme, host and path. */
  readonly url: string
  /** The bearer token the receiver was configured with. */
  readonly token: string
  /** Exclusive lower bound on this log's own sequence; 0 sends everything. */
  readonly since?: number
  /** The identity to relay under, when the sender is not this log. */
  readonly as?: { readonly writer: string, readonly instance: string }
  /** How long to wait for the receiver, in milliseconds. @default 10000 */
  readonly timeoutMs?: number
}

/** The largest relay body this plugin will read, in bytes. */
const RELAY_BODY_LIMIT = 4 * 1024 * 1024

/** Where peers post relay batches, on the kernel's web server. */
const RELAY_PATH = '/api/dsh-link-collab/relay'

/**
 * Compare two secrets without leaking their length or their first difference through timing.
 *
 * Both sides are hashed first so the compared buffers are always the same size: comparing the raw
 * strings would refuse one of a different length before examining it, and `timingSafeEqual` throws
 * on unequal lengths rather than answering.
 *
 * @param present - the value the caller sent.
 * @param expected - the value this log was configured with.
 * @returns true when they are the same secret.
 */
function sameSecret(present: string, expected: string): boolean {
  const left = createHash('sha256').update(present).digest()
  const right = createHash('sha256').update(expected).digest()
  return timingSafeEqual(left, right)
}

/** What one relay request did, so the local caller can count it without re-reading the response. */
export interface RelayIngestOutcome {
  /** Whether the batch was applied. */
  readonly ok: boolean
  /** The refusal code when it was not, in this plugin's own vocabulary. */
  readonly code?: string
  /** How many records the receiver appended. */
  readonly appended?: number
  /** How many records it already held. */
  readonly skipped?: number
}

/**
 * The relay one end exposes to its peers, and the client side of the same exchange.
 *
 * Both halves live in one object because they are one protocol: the body this end demands is the body
 * that end sends. Kept apart — one half inside the plugin and one in a test — they drift, and the
 * drift reads as an unreachable peer rather than as two contracts that stopped agreeing.
 */
export interface RelayEndpoint {
  /** The pathname this endpoint answers on. */
  readonly path: string
  /**
   * Answer one relay request: authenticate, read the batch, hand it to the log.
   *
   * Speaks `req`/`res` and nothing else — no cordis context, no module state — so the exact handler the
   * kernel mounts is the one a caller can mount on a plain `node:http` server and grade over a real socket.
   * @param req - the incoming request.
   * @param res - the response to own until it is answered.
   * @returns what the exchange did.
   */
  readonly handler: (req: IncomingMessage, res: ServerResponse) => Promise<RelayIngestOutcome>
  /**
   * Send one batch to a peer's relay URL over the network.
   * @param url - the receiver's relay URL, including scheme, host and path.
   * @param batch - the records to hand over.
   * @param options - the token to present (defaulting to this endpoint's own secret) and the timeout.
   * @returns the receiver's answer.
   */
  readonly relayTo: (url: string, batch: RelayBatch, options?: { readonly token?: string, readonly timeoutMs?: number }) => Promise<RelayPushResult>
}

/** Answer one HTTP request with a JSON body. */
function answer(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

/**
 * POST one batch to a peer's relay URL and read its answer.
 *
 * This is the only place this build speaks the relay wire format as a client. A second fetch beside it
 * would be a second contract that only one end could change, and the peer would discover the change by
 * failing — so both the endpoint and the plugin's own `relayTo` come through here.
 * @param url - the receiver's relay URL.
 * @param token - the bearer token to present.
 * @param batch - the records to hand over.
 * @param timeoutMs - how long to wait for the receiver, in milliseconds.
 * @returns the receiver's answer, with an unreadable body reported as a refusal rather than a throw.
 */
async function pushBatch(url: string, token: string, batch: RelayBatch, timeoutMs?: number): Promise<RelayPushResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify(batch),
    signal: AbortSignal.timeout(timeoutMs ?? 10_000),
  })
  const parsed = (await response.json().catch(() => null)) as Partial<RelayPushResult> | null
  return {
    ok: parsed?.ok === true,
    appended: Number(parsed?.appended ?? 0),
    skipped: Number(parsed?.skipped ?? 0),
    ...(typeof parsed?.code === 'string' ? { code: parsed.code } : {}),
  }
}

/**
 * Build the relay endpoint: the route one end answers on, and the client that reaches a peer's.
 *
 * The factory exists so that "the route the kernel runs" and "the route a gate drives over a real
 * socket" are the same object rather than two look-alikes: a plugin-mounted route that no test can
 * reach is only ever graded by reading it, and a test's imitation proves nothing about the shipped one.
 * @param options - the shared secret, the log batches are applied to, and an optional pathname.
 * @returns the endpoint: its path, its request handler, and its client.
 */
export function createRelayEndpoint(options: { token: string, log: ControlLog, path?: string }): RelayEndpoint {
  const requested = typeof options?.token === 'string' ? options.token : ''
  // A secret that cannot be presented is not a secret: an empty or whitespace-only token would bind a
  // route that refuses every caller forever, and that misconfiguration would read as an unreachable
  // peer. It throws here, where the cause is still visible, rather than at the first refused batch.
  if (requested.trim() === '') throw new TypeError('createRelayEndpoint: token must be a non-empty secret')
  const log = options.log
  if (log === null || typeof log?.ingest !== 'function') throw new TypeError('createRelayEndpoint: log must be an open control log')
  const token = requested
  const path = options.path ?? RELAY_PATH

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<RelayIngestOutcome> => {
    const refuse = (status: number, code: string, detail?: string): RelayIngestOutcome => {
      answer(res, status, detail === undefined ? { ok: false, code } : { ok: false, code, error: detail })
      return { ok: false, code }
    }
    // Authentication comes before dispatch: an unauthenticated caller should not learn from a 405
    // that the route exists at all. The scheme is compared case-insensitively because RFC 7235 says
    // it is case-insensitive, and a compliant client that spells it `bearer` must not be refused.
    const authorization = req.headers.authorization
    const presented = typeof authorization === 'string' && /^bearer[ \t]+/i.test(authorization)
      ? authorization.replace(/^bearer[ \t]+/i, '')
      : null
    if (presented === null || !sameSecret(presented, token)) return refuse(401, 'UNAUTHORIZED')
    if (req.method !== 'POST') return refuse(405, 'METHOD')
    const contentType = String(req.headers['content-type'] ?? '')
    // Media types are case-insensitive too, and a client that writes `Application/JSON` is not wrong.
    if (!/^application\/json\b/i.test(contentType)) return refuse(415, 'CONTENT_TYPE')
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      const buffer = chunk as Buffer
      size += buffer.length
      if (size > RELAY_BODY_LIMIT) {
        // Answer and let the connection close politely. Destroying the request instead tore down a
        // keep-alive socket the caller was about to reuse, so the peer's NEXT batch vanished as a
        // connection reset and appeared in no counter at all — a refusal that eats the request after
        // it is worse than no refusal.
        res.setHeader('connection', 'close')
        return refuse(413, 'TOO_LARGE')
      }
      chunks.push(buffer)
    }
    let batch: unknown
    try {
      batch = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return refuse(400, 'RELAY_MALFORMED', 'the body is not JSON')
    }
    const rows = (batch as { records?: unknown } | null)?.records
    if (!Array.isArray(rows)) return refuse(400, 'RELAY_MALFORMED', 'the body carries no records array')
    try {
      const result = await log.ingest(batch as RelayBatch)
      answer(res, 200, { ok: true, appended: result.appended, skipped: result.skipped })
      return { ok: true, appended: result.appended, skipped: result.skipped }
    } catch (error) {
      const code = (error as { code?: string })?.code ?? 'RELAY_REFUSED'
      return refuse(400, code, String((error as { message?: unknown })?.message ?? error))
    }
  }

  return {
    path,
    handler,
    relayTo: (url, batch, push) => pushBatch(url, push?.token ?? token, batch, push?.timeoutMs),
  }
}

/** Marker file keeping a second process out of one log. */
const LOCK = '.writer'
/** How often a holder touches its lock file. A live kernel beats every few seconds. */
const LOCK_HEARTBEAT_MS = 5_000
/** A lock whose file has not been touched for this long is stale whatever its pid now says (six missed beats). */
const LOCK_STALE_MS = 30_000

/** Marker file holding the identity of the log in this directory. */
const INSTANCE = '.instance'

/**
 * Render a value the way the log will hold it, so two records compare equal exactly when they
 * are the same record on disk.
 *
 * The value is put through the same JSON round trip the appended line goes through, because
 * that is what the file keeps: undefined and functions are dropped, `toJSON` applies (a Date
 * becomes its ISO string) and a Map or a Set reduces to `{}`. Comparing the in-memory objects
 * instead made `Date(5)` and `Date(6)` look identical — a change silently dropped — and made the
 * same record's verdict depend on whether it arrived as an object or as JSON text. Keys are then
 * ordered and rendered into a string rather than copied into a fresh object, so a payload's own
 * `__proto__` key is kept instead of being absorbed as a prototype assignment.
 *
 * @param value - the value to render.
 * @returns a string that is equal for records that are equal on disk.
 */
function canonical(value: unknown): string {
  let persisted: unknown
  try {
    persisted = JSON.parse(JSON.stringify(value ?? null))
  } catch {
    return '<unrepresentable>'
  }
  const render = (node: unknown): string => {
    if (node === null || typeof node !== 'object') return JSON.stringify(node) ?? 'null'
    if (Array.isArray(node)) return '[' + node.map(render).join(',') + ']'
    const source = node as Record<string, unknown>
    return '{' + Object.keys(source).sort().map((key) => JSON.stringify(key) + ':' + render(source[key])).join(',') + '}'
  }
  return render(persisted)
}

/** Environment variable that arms fault injection. */
const ATTACKS = 'DSH_LINK_COLLAB_ATTACKS'

/**
 * Read a fault-injection flag.
 *
 * These switches exist so a gate can reproduce a defect on demand, and they ship inside the
 * plugin, so their names are part of the installed artifact. An inherited variable would let a
 * stray `DSH_LINK_COLLAB_*` in a parent shell silently unsubscribe this plugin, drop its writer
 * lock, or replay its sequence numbers — a test affordance reachable by accident is a defect in
 * shipped code. Every flag is honored only while the master switch is on, which is the one
 * variable a test run sets and production never has.
 *
 * @param name - the specific flag to read.
 * @returns true when the master switch is on and this flag is set.
 */
function attackFlag(name: string): boolean {
  return process.env[ATTACKS] === '1' && process.env[name] === '1'
}

/** Environment variable that turns the per-event DIAG trace back on. */
const TRACE = 'DSH_LINK_COLLAB_TRACE'

/**
 * Whether the per-event DIAG trace is on.
 *
 * OFF by default. The line runs for every session event of every session, and R487 measured that
 * cost: 4.57 us/event through the stdout pipe (0.73 us to a file sink), one log line per event, and
 * a 100k-row ledger implies roughly 667k session events, i.e. ~3 s of CPU and a log that grows one
 * line per event. That is a diagnostic, not a product fact, so it ships off; setting
 * DSH_LINK_COLLAB_TRACE=1 (or any value other than '0' and '') restores the line verbatim for a
 * live investigation.
 *
 * @returns true when the trace was asked for.
 */
function traceEnabled(): boolean {
  const value = process.env[TRACE]
  return value !== undefined && value !== '' && value !== '0'
}

// An armed build must say so. A switch nobody can see being on turns a broken instrument into a
// diagnosis of the plugin, which is the failure this project keeps paying for; one line makes the
// difference between "the subscription died" and "somebody armed fault injection".
if (process.env[ATTACKS] === '1') {
  console.error('[dsh-link-collab] FAULT INJECTION ARMED: ' + ATTACKS + '=1 — test switches are live in this process')
}

/**
 * Whether a process id is running, so a stale lock does not block a restart.
 * @param pid - the process id recorded in the lock.
 * @returns true when the process is alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // ESRCH is the answer this asks about; EPERM means somebody else owns it and it exists.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/* ------------------------------------------------------------------------------------------------
 * The ledger stamp (R504): the writer-maintained sidecar that lets a cold read skip the parse.
 *
 * Before R504 every open parsed every line of control.jsonl, and the checkpoint only saved the FOLD:
 * a cold read still paid the parse (~187 ms at 100k rows) before it could even ask the checkpoint
 * anything. The stamp is the second fact the checkpoint needs - where the ledger's tail is - kept up
 * to date by the same writer that appends, so an open can learn the tail without parsing the prefix.
 *
 * The stamp is a CACHE, never an authority. Every read that uses it re-proves what it can afford:
 * the DEFAULT tier hashes the file's bytes once (one native pass, no JSON.parse) and verifies the
 * prefix digest before believing any offset, which is what keeps R502's A1 guarantee - an in-place
 * prefix rewrite that preserves inode, size and sequence numbers must still fail open - while
 * paying about a twelfth of a full parse. The zero-read tier is opt-in (`fold.fastOpen`) and depends
 * on the OS timestamps it compares; its threat boundary is stated in R496 section 8.3.
 * ---------------------------------------------------------------------------------------------- */

/** The writer-maintained stamp beside control.jsonl. */
export const LEDGER_STAMP_FILE = 'control.stamp.json'
/** The stamp document format, so a foreign or older document is refused rather than parsed. */
export const LEDGER_STAMP_FORMAT = 'dsh-link.collab.ledger-stamp/1'
/** The stamp document version. */
export const LEDGER_STAMP_VERSION = 1
/** A suffix larger than this is parsed as a whole ledger instead of into one buffer: a bounded read. */
const STAMP_SUFFIX_MAX_BYTES = 64 * 1024 * 1024
/** A NUL separator for the stamp checksum, spelled without source escapes. */
const STAMP_NUL = String.fromCharCode(0)
/** A newline, spelled without source escapes (a text split and a stamp checksum use it). */
const STAMP_NEWLINE = String.fromCharCode(10)

/**
 * What the writer knows about the ledger's prefix at the instant it last stamped it.
 *
 * Every field is a fact the reader can re-prove: the identity binds the bytes to one file, the
 * sha1 binds them to one content, and the counters let a suffix parse number its lines without
 * reading the prefix. The checksum keeps a torn or hand-edited stamp from being believed at all.
 */
export interface LedgerStamp {
  /** {@link LEDGER_STAMP_FORMAT}. */
  readonly format: string
  /** {@link LEDGER_STAMP_VERSION}. */
  readonly version: number
  /** The ledger instance the stamped prefix belongs to. */
  readonly instance: string
  /** dev:ino@resolved-path of control.jsonl when the stamp was written. */
  readonly identity: string
  /** The stamped file length in bytes. */
  readonly bytes: number
  /** Newlines in the stamped text: the offset a suffix's line numbers are counted from. */
  readonly lines: number
  /** Records the stamped prefix holds. */
  readonly records: number
  /** Highest sequence in the stamped prefix. */
  readonly lastSeq: number
  /** sha1 (hex) of the stamped text: the prefix proof a reader subtracts the suffix from. */
  readonly digest: string
  /** The control file's mtimeNs at the stamp, compared only by the opt-in zero-read tier. */
  readonly mtimeNs: string
  /** When this digest was last proven against the file's bytes (epoch ms). */
  readonly verifiedAt: number
  /** When the stamp file was last written (epoch ms). */
  readonly writtenAt: number
  /** sha256 of every believing field, so a damaged stamp is named rather than interpreted. */
  readonly checksum: string
}

/** The stamp fields the checksum covers (everything but the checksum and the write instant). */
type LedgerStampBody = Omit<LedgerStamp, 'checksum' | 'writtenAt'>

/** The checksum over a stamp's believing fields (exported so a gate can forge a stamp and prove the boundary). */
export function ledgerStampChecksum(body: Omit<LedgerStamp, 'checksum' | 'writtenAt'>): string {
  return createHash('sha256')
    .update(body.format + STAMP_NUL + String(body.version))
    .update(STAMP_NUL + body.instance)
    .update(STAMP_NUL + body.identity)
    .update(STAMP_NUL + String(body.bytes))
    .update(STAMP_NUL + String(body.lines))
    .update(STAMP_NUL + String(body.records))
    .update(STAMP_NUL + String(body.lastSeq))
    .update(STAMP_NUL + body.digest)
    .update(STAMP_NUL + body.mtimeNs)
    .update(STAMP_NUL + String(body.verifiedAt))
    .digest('hex')
}

/** A monotonic suffix for stamp temp names, so two writes in one process cannot collide. */
let stampSequence = 0

/** What a stamp file read found: the parsed stamp, whether a file existed, and why it was refused. */
interface LedgerStampReading {
  readonly stamp: LedgerStamp | null
  /** Whether a stamp file existed at all (absent is not a failure, it is a first run). */
  readonly present: boolean
  /** Why the stamp cannot be believed, or null when it parsed and checksummed. */
  readonly reason: string | null
}

/**
 * Read and validate the stamp file, naming why it cannot be believed.
 * @param directory - the ledger directory.
 * @returns the stamp (or null), whether it existed, and the refusal reason.
 */
function readLedgerStamp(directory: string): LedgerStampReading {
  const path = join(directory, LEDGER_STAMP_FILE)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { stamp: null, present: false, reason: 'no-stamp-file' }
  }
  FOLD_STATS.stampsRead += 1
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return { stamp: null, present: true, reason: 'stamp-unreadable' } }
  if (parsed === null || typeof parsed !== 'object') return { stamp: null, present: true, reason: 'stamp-not-a-document' }
  const seen = parsed as Partial<LedgerStamp>
  if (seen.format !== LEDGER_STAMP_FORMAT) return { stamp: null, present: true, reason: 'stamp-foreign-format' }
  if (seen.version !== LEDGER_STAMP_VERSION) return { stamp: null, present: true, reason: 'stamp-format-version' }
  if (typeof seen.instance !== 'string' || typeof seen.identity !== 'string' || typeof seen.digest !== 'string'
    || typeof seen.mtimeNs !== 'string' || typeof seen.checksum !== 'string'
    || typeof seen.bytes !== 'number' || !Number.isInteger(seen.bytes) || seen.bytes < 0
    || typeof seen.lines !== 'number' || !Number.isInteger(seen.lines) || seen.lines < 0
    || typeof seen.records !== 'number' || !Number.isInteger(seen.records) || seen.records < 0
    || typeof seen.lastSeq !== 'number' || !Number.isInteger(seen.lastSeq) || seen.lastSeq < 0
    || typeof seen.verifiedAt !== 'number' || !Number.isFinite(seen.verifiedAt)
    || typeof seen.writtenAt !== 'number' || !Number.isFinite(seen.writtenAt)) {
    return { stamp: null, present: true, reason: 'stamp-malformed' }
  }
  const body: LedgerStampBody = {
    format: seen.format, version: seen.version, instance: seen.instance, identity: seen.identity,
    bytes: seen.bytes, lines: seen.lines, records: seen.records, lastSeq: seen.lastSeq,
    digest: seen.digest, mtimeNs: seen.mtimeNs, verifiedAt: seen.verifiedAt,
  }
  if (ledgerStampChecksum(body) !== seen.checksum) return { stamp: null, present: true, reason: 'stamp-checksum-mismatch' }
  const stamp: LedgerStamp = { ...body, writtenAt: seen.writtenAt, checksum: seen.checksum }
  return { stamp, present: true, reason: null }
}

/**
 * Write a stamp atomically: a temporary beside the target is renamed over it, so a reader sees the
 * previous stamp or the new one, never a half-written document (the checkpoint's own rule).
 * @param directory - the ledger directory.
 * @param body - the stamped facts.
 * @returns null on success, or the failure's message (a cache write never throws to its caller).
 */
function writeLedgerStamp(directory: string, body: LedgerStampBody): string | null {
  const path = join(directory, LEDGER_STAMP_FILE)
  stampSequence += 1
  const temporary = path + '.' + String(process.pid) + '.' + String(stampSequence) + '.tmp'
  try {
    writeFileSync(temporary, JSON.stringify({ ...body, checksum: ledgerStampChecksum(body), writtenAt: Date.now() }), 'utf8')
    renameSync(temporary, path)
    return null
  } catch (error) {
    try { rmSync(temporary, { force: true }) } catch { /* a temp file left by a failed write is reported, not thrown */ }
    return String((error as { message?: unknown })?.message ?? error)
  }
}

/** Delete one ledger's stamp: a stamp that failed a proof must not be believed again. */
function discardLedgerStamp(directory: string): void {
  try { rmSync(join(directory, LEDGER_STAMP_FILE), { force: true }) } catch { /* a cache that cannot be deleted is still refused */ }
}

/** The stamp writers of the open control logs: saveFoldCheckpoint refreshes the stamp it knows. */
const STAMP_WRITERS = new WeakMap<ControlLog, () => void>()

/**
 * Parse one block of control.jsonl text the way the reader always has: one JSON record per
 * non-empty line, damage reported rather than skipped.
 * @param text - the lines.
 * @param options - where this block starts in the file, and whether to hash it.
 * @returns the parsed records, absolute broken line numbers, counters and the digest.
 */
function parseControlText(text: string, options: { readonly firstLine?: number, readonly digest?: boolean } = {}): ParsedControlText {
  const firstLine = options.firstLine ?? 0
  const records: ControlRecord[] = []
  const brokenLines: number[] = []
  const lines = text.split(STAMP_NEWLINE)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line === '') continue
    try {
      const parsed = JSON.parse(line) as ControlRecord
      if (typeof parsed?.seq !== 'number' || !Number.isInteger(parsed.seq)) throw new Error('record without an integer sequence')
      records.push(parsed)
    } catch {
      brokenLines.push(firstLine + index + 1)
    }
  }
  records.sort((left, right) => left.seq - right.seq)
  const lastSeq = records.length > 0 ? records[records.length - 1]?.seq ?? 0 : 0
  return {
    records,
    brokenLines,
    lastSeq,
    lines: lines.length - 1,
    bytes: Buffer.byteLength(text),
    hash: options.digest === true ? createHash('sha1').update(text) : null,
  }
}

/** One parse of control.jsonl text, with the damage report and the digest as options. */
interface ParsedControlText {
  readonly records: ControlRecord[]
  /** Absolute 1-based line numbers that did not parse, offset by the lines before this text. */
  readonly brokenLines: number[]
  readonly lastSeq: number
  /** Newlines in this text. */
  readonly lines: number
  readonly bytes: number
  /** The running sha1 of this text, or null when no digest was asked for. */
  readonly hash: ReturnType<typeof createHash> | null
}

/** Count the newlines of a text without splitting it (the suffix line offset a stamp carries). */
function countNewlines(text: string): number {
  let lines = 0
  for (let index = text.indexOf(STAMP_NEWLINE); index !== -1; index = text.indexOf(STAMP_NEWLINE, index + 1)) lines += 1
  return lines
}

/**
 * Read a log file's records, reporting what could not be read instead of skipping it.
 *
 * The digest is computed only when the caller asks: hashing every open cost 1.48 ms at 10k rows and
 * 15.5 ms at 100k rows (5.5-7.5% of a full fold), which a default that never reads a checkpoint must
 * not pay (R507/Y4).
 * @param path - the log file.
 * @param digest - whether to hash the text (the fold checkpoint's prefix proof reads it).
 * @returns the records, the damage report or null, the digest when asked for, and the counters.
 */
function readControlLedger(path: string, digest = false): { records: ControlRecord[], damage: DamageReport | null, hash: ReturnType<typeof createHash> | null, lineCount: number, bytes: number } {
  if (!existsSync(path)) return { records: [], damage: null, hash: digest ? createHash('sha1') : null, lineCount: 0, bytes: 0 }
  const text = readFileSync(path, 'utf8')
  const parsed = parseControlText(text, digest ? { digest: true } : {})
  if (parsed.hash !== null) FOLD_STATS.digestsComputed += 1
  const damage = parsed.brokenLines.length > 0 ? { brokenLines: parsed.brokenLines, lastGoodSeq: parsed.lastSeq, bytes: parsed.bytes } : null
  return { records: parsed.records, damage, hash: parsed.hash, lineCount: parsed.lines, bytes: parsed.bytes }
}

/**
 * The ledger view a fold worker reads through (R507/Y5).
 *
 * Before R507 the worker carried its own copy of the JSONL reader: a second parse, a second damage
 * rule and a second digest. One frame therefore read the same file twice with two implementations,
 * and the only thing keeping their answers equal was a test. The worker now calls this function, so
 * the host and the worker cannot disagree about what the ledger says: there is one parser.
 *
 * The view is a plain FoldLedgerView plus the two operations a worker needs: absorbing the records a
 * sync frame carries (the host already appended them) and dropping the record array once folded (the
 * worker keeps state, not the ledger).
 */
export interface WorkerLedgerView extends FoldLedgerView {
  /** The parsed records, in sequence order. */
  readonly records: ControlRecord[]
  /** Fold rows the host already appended into this view's digest and tail. */
  absorb(rows: readonly ControlRecord[]): void
  /** Drop the record array after folding it: the worker keeps the accumulator, not the ledger. */
  releaseRecords(): void
  /** The parsed records, as a copy (the worker's whole-ledger fallback folds from it). */
  replay(): ControlRecord[]
}

/**
 * Read one ledger into the view a fold worker works from (R507/Y5).
 *
 * Deliberately the SAME reader function the host's own open uses (readControlLedger, digest
 * included), so a damaged row, a reordered sequence or a reversed ledger is classified identically
 * on both sides. The worker no longer carries a copy of that logic.
 * @param directory - the ledger directory.
 * @returns the readable view.
 */
export function readLedgerView(directory: string): WorkerLedgerView {
  const path = join(directory, 'control.jsonl')
  const ledger = readControlLedger(path, true)
  let records = ledger.records
  let lastSeq = records.length > 0 ? records[records.length - 1]?.seq ?? 0 : 0
  const digestHash = ledger.hash
  const damage = ledger.damage
  let instance = ''
  try { instance = readFileSync(join(directory, '.instance'), 'utf8').trim() } catch { /* a ledger without one is unnamed */ }
  const view: WorkerLedgerView = {
    directory,
    instance,
    get lastSeq() { return lastSeq },
    get digest() { return digestHash === null ? '' : digestHash.copy().digest('hex') },
    get damage() { return damage },
    get records() { return records },
    get recordsMaterialised() { return records.length > 0 },
    page(since = 0, limit = Number.MAX_SAFE_INTEGER) {
      const out: ControlRecord[] = []
      for (const record of records) {
        if (record.seq <= since) continue
        out.push(record)
        if (out.length >= limit) break
      }
      return out
    },
    replay() { return [...records] },
    absorb(rows: readonly ControlRecord[]): void {
      for (const row of rows) {
        if (typeof row?.seq !== 'number' || !Number.isInteger(row.seq)) continue
        records.push(row)
        if (row.seq > lastSeq) lastSeq = row.seq
        // The host wrote exactly JSON.stringify(row)+newline for these rows, so extending the digest
        // here keeps the worker's prefix proof byte-for-byte the host's.
        digestHash?.update(JSON.stringify(row) + STAMP_NEWLINE)
      }
    },
    releaseRecords(): void { records = [] },
  }
  return view
}

/** How an open read the ledger (R504): which tier answered, for a status row to say. */
export type LedgerOpenTier = 'empty' | 'stamp-trusted' | 'stream-verified' | 'full-parse'

/** What one open learned about a ledger, and how it learned it. */
interface OpenedControlLedger {
  /** The records the open holds, or null when the prefix was left unparsed (a trusted stamp). */
  records: ControlRecord[] | null
  /** Whether records is the whole ledger rather than only a suffix the open parsed. */
  complete: boolean
  /** The first sequence present in records when complete is false. */
  floor: number
  damage: DamageReport | null
  /** The running sha1 of every byte of the file, or null when no digest was computed now. */
  hash: ReturnType<typeof createHash> | null
  /** A digest already proven against these bytes at verifiedAt (a trusted stamp), or null. */
  digestHex: string | null
  /** When the digest was last proven against the file's bytes (epoch ms). */
  verifiedAt: number
  lastSeq: number
  lines: number
  bytes: number
  count: number
  tier: LedgerOpenTier
  stampReason: string | null
}

/** The open a composition that never asked for a checkpoint gets: the pre-R504 read, no digest. */
function openControlLedgerPlain(path: string): OpenedControlLedger {
  const ledger = readControlLedger(path, false)
  const lastSeq = ledger.records.length > 0 ? ledger.records[ledger.records.length - 1]?.seq ?? 0 : 0
  return {
    records: ledger.records,
    complete: true,
    floor: ledger.records.length > 0 ? ledger.records[0]?.seq ?? 1 : lastSeq + 1,
    damage: ledger.damage,
    hash: null,
    digestHex: null,
    verifiedAt: 0,
    lastSeq,
    lines: ledger.lineCount,
    bytes: ledger.bytes,
    count: ledger.records.length,
    tier: ledger.records.length === 0 && ledger.bytes === 0 ? 'empty' : 'full-parse',
    stampReason: null,
  }
}

/** What one streaming pass answered: the whole digest, the prefix digest, and the line counts. */
interface StreamedLedgerDigest {
  /** The running sha1 of every byte, still extendable by later appends. */
  readonly hash: ReturnType<typeof createHash>
  /** Its current hex value. */
  readonly whole: string
  /** sha1 (hex) of the first prefixBytes bytes. */
  readonly prefix: string
  /** Newlines before the prefix boundary. */
  readonly prefixLines: number
}

/**
 * Hash a ledger's bytes in one streaming pass, proving the prefix while paying one read.
 *
 * No JSON.parse happens here: R504 measured that the parse (90.9 ms at 100k rows) dwarfs reading and
 * hashing the bytes (11.5 ms streaming). The prefix hash is computed only when the stamp ends before
 * the file does, so the common case hashes the bytes once.
 * @param path - the ledger file.
 * @param prefixBytes - the stamped prefix's byte length.
 * @param size - the file's length right now.
 * @returns the digests and line counts, or null when the file could not be read.
 */
function streamLedgerDigest(path: string, prefixBytes: number, size: number): StreamedLedgerDigest | null {
  let fd: number
  try { fd = openSync(path, 'r') } catch { return null }
  const whole = createHash('sha1')
  const prefix = createHash('sha1')
  const wholeIsPrefix = prefixBytes === size
  const buffer = Buffer.allocUnsafe(1 << 20)
  let offset = 0
  let prefixLines = 0
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null)
      if (read <= 0) break
      const chunk = buffer.subarray(0, read)
      whole.update(chunk)
      // Count newlines without decoding: a suffix's line numbers are its offset in lines.
      for (let index = chunk.indexOf(10); index !== -1; index = chunk.indexOf(10, index + 1)) {
        if (offset + index < prefixBytes) prefixLines += 1
      }
      if (!wholeIsPrefix && offset < prefixBytes) {
        const take = Math.min(read, prefixBytes - offset)
        if (take > 0) prefix.update(chunk.subarray(0, take))
      }
      offset += read
    }
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
  const wholeHex = whole.copy().digest('hex')
  FOLD_STATS.digestsComputed += 1
  return {
    hash: whole,
    whole: wholeHex,
    prefix: wholeIsPrefix ? wholeHex : prefix.digest('hex'),
    prefixLines,
  }
}

/**
 * Read a ledger's suffix into one string, or refuse when it exceeds the bounded read.
 * @param path - the ledger file.
 * @param offset - the first suffix byte.
 * @param size - the file's length.
 * @returns the suffix text, or null when it cannot be read within the bound.
 */
function readLedgerSuffix(path: string, offset: number, size: number): string | null {
  if (offset >= size) return ''
  const length = size - offset
  if (length > STAMP_SUFFIX_MAX_BYTES) return null
  let fd: number
  try { fd = openSync(path, 'r') } catch { return null }
  try {
    const buffer = Buffer.allocUnsafe(length)
    let read = 0
    while (read < length) {
      const chunk = readSync(fd, buffer, read, length - read, offset + read)
      if (chunk <= 0) break
      read += chunk
    }
    if (read !== length) return null
    return buffer.toString('utf8')
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}

/**
 * Open a ledger the fold checkpoint can accelerate (R504).
 *
 * Three tiers, each one paying for exactly the integrity it claims:
 * 1. stamp-trusted (opt-in fold.fastOpen): the stamp's checksum, identity, byte length, line/seq
 *    counters and mtime all match a stat, and its digest is younger than the verification interval.
 *    No read; the threat boundary is in R496 section 8.3.
 * 2. stream-verified (default): the bytes are read and hashed once, the prefix digest in the stamp
 *    is proven, and ONLY the suffix is JSON-parsed. This keeps A1: a same-size in-place rewrite
 *    changes bytes the prefix hash covers, and the fallback below re-parses everything.
 * 3. full-parse: no believable stamp, or the prefix proof failed: the pre-R504 parse.
 * @param path - control.jsonl.
 * @param directory - the ledger directory (where the stamp lives).
 * @param instance - this ledger's instance identity.
 * @returns what the open holds and which tier answered.
 */
function openControlLedgerAccelerated(path: string, directory: string, instance: string): OpenedControlLedger {
  let size = 0
  let mtimeNs = '0'
  let identity = 'unavailable@' + resolve(path)
  try {
    const stats = statSync(path, { bigint: true })
    size = Number(stats.size)
    mtimeNs = String(stats.mtimeNs)
    identity = String(stats.dev) + ':' + String(stats.ino) + '@' + resolve(path)
  } catch {
    return {
      records: [], complete: true, floor: 1, damage: null, hash: createHash('sha1'), digestHex: null,
      verifiedAt: Date.now(), lastSeq: 0, lines: 0, bytes: 0, count: 0, tier: 'empty', stampReason: null,
    }
  }
  const reading = readLedgerStamp(directory)
  const stamp = reading.stamp
  if (stamp === null && reading.present) {
    FOLD_STATS.stampsIgnored += 1
    FOLD_STATS.lastStampReason = reading.reason
    FOLD_STATS.lastStampRefusal = reading.reason
  }
  const approvedAt = Date.now()
  const binding = ((): string | null => {
    if (stamp === null) return reading.reason
    if (stamp.instance !== instance) return 'stamp-instance-changed'
    if (stamp.identity !== identity) return 'stamp-identity-changed'
    if (stamp.bytes > size) return 'stamp-size-changed'
    return null
  })()
  // The A1-SAFE DEFAULT: one streaming hash, no whole-file parse. The zero-read tier is opt-in and
  // only reached after every cheap binding matched, including the OS timestamp the writer recorded.
  if (binding === null && stamp !== null && FOLD_SETTINGS_STATE.fastOpen
    && stamp.bytes === size && stamp.mtimeNs === mtimeNs && stamp.records === stamp.lastSeq
    && approvedAt - stamp.verifiedAt <= FOLD_SETTINGS_STATE.stampVerifyMs) {
    FOLD_STATS.stampTrusted += 1
    return {
      records: null,
      complete: false,
      floor: stamp.lastSeq + 1,
      damage: null,
      hash: null,
      digestHex: stamp.digest,
      verifiedAt: stamp.verifiedAt,
      lastSeq: stamp.lastSeq,
      lines: stamp.lines,
      bytes: stamp.bytes,
      count: stamp.records,
      tier: 'stamp-trusted',
      stampReason: 'trusted',
    }
  }
  if (binding === null && stamp !== null) {
    const streamed = streamLedgerDigest(path, stamp.bytes, size)
    if (streamed !== null && streamed.prefix === stamp.digest) {
      const suffixText = stamp.bytes === size ? '' : readLedgerSuffix(path, stamp.bytes, size)
      if (suffixText !== null) {
        const suffix = suffixText === '' ? null : parseControlText(suffixText, { firstLine: stamp.lines })
        const suffixRecords = suffix === null ? [] : suffix.records
        const broken = suffix === null ? [] : suffix.brokenLines
        const lastSeq = Math.max(stamp.lastSeq, suffix?.lastSeq ?? 0)
        FOLD_STATS.stampVerified += 1
        FOLD_STATS.lastStampReason = null
        return {
          records: suffixRecords,
          complete: false,
          floor: suffixRecords.length > 0 ? suffixRecords[0]?.seq ?? lastSeq + 1 : lastSeq + 1,
          damage: broken.length > 0 ? { brokenLines: broken, lastGoodSeq: lastSeq, bytes: size } : null,
          hash: streamed.hash,
          digestHex: null,
          verifiedAt: approvedAt,
          lastSeq,
          lines: stamp.lines + (suffix === null ? 0 : suffix.lines),
          bytes: size,
          count: stamp.records + suffixRecords.length,
          tier: 'stream-verified',
          stampReason: null,
        }
      }
    }
    FOLD_STATS.stampsIgnored += 1
    FOLD_STATS.lastStampReason = streamed === null ? 'stamp-unreadable-file' : 'stamp-content-changed'
    FOLD_STATS.lastStampRefusal = FOLD_STATS.lastStampReason
  } else if (stamp !== null) {
    FOLD_STATS.stampsIgnored += 1
    FOLD_STATS.lastStampReason = binding
    FOLD_STATS.lastStampRefusal = binding
  }
  const ledger = readControlLedger(path, true)
  const lastSeq = ledger.records.length > 0 ? ledger.records[ledger.records.length - 1]?.seq ?? 0 : 0
  return {
    records: ledger.records,
    complete: true,
    floor: ledger.records.length > 0 ? ledger.records[0]?.seq ?? 1 : lastSeq + 1,
    damage: ledger.damage,
    hash: ledger.hash,
    digestHex: null,
    verifiedAt: approvedAt,
    lastSeq,
    lines: ledger.lineCount,
    bytes: ledger.bytes,
    count: ledger.records.length,
    tier: 'full-parse',
    stampReason: FOLD_STATS.lastStampReason,
  }
}


/**
 * Open a control log in a directory.
 * @param options - where to write, and the data channel limits.
 * @returns the open log.
 */
export function openControlLog(options: LogOptions): ControlLog {
  const { dir, dataTtlMs = 30_000, dataCapacity = 256 } = options
  const now = options.now ?? (() => Date.now())
  mkdirSync(dir, { recursive: true })

  const path = join(dir, 'control.jsonl')
  const lockPath = join(dir, LOCK)
  const localWriter = options.writer ?? 'local'
  // The instance is minted once per directory and kept there. A peer that loses this file has, by
  // this log's own definition, become a different log: its sequences start again, and a receiver
  // that treated the name as identity would either drop its new records or splice them onto the old
  // tail. Keying by (name, instance) makes that visible instead of silent.
  const instancePath = join(dir, INSTANCE)
  const localInstance = ((): string => {
    if (existsSync(instancePath)) {
      const kept = readFileSync(instancePath, 'utf8').trim()
      if (kept !== '') return kept
    }
    const minted = randomUUID()
    writeFileSync(instancePath, minted + '\n', 'utf8')
    return minted
  })()

  // The flag exists for the same reason as the one above: it is the single line whose removal
  // makes two writers share a counter, which is how a ledger silently acquires duplicate keys.
  if (!attackFlag('DSH_LINK_COLLAB_NO_LOCK') && existsSync(lockPath)) {
    const raw = readFileSync(lockPath, 'utf8').trim()
    const holder = Number(raw)
    const holdsAPid = /^\d+$/.test(raw) && Number.isFinite(holder) && holder > 0
    // R386: the lock is a pid AND a heartbeat. A pid alone is not an identity on Windows: ids are
    // recycled, so a writer that died could be "alive" again as an unrelated process (measured:
    // a lock left by a killed kernel named pid 9740, which the OS had since given to ShellHost.exe,
    // and every later kernel refused to mount the ledger - NO_CAPABILITY for both the teams pane and
    // the LINK panel). The holder now touches the file every LOCK_HEARTBEAT_MS and close() removes
    // it; a lock older than LOCK_STALE_MS is stale whatever its pid now says.
    const lockAgeMs = ((): number => {
      try {
        return Date.now() - statSync(lockPath).mtimeMs
      } catch {
        return Number.POSITIVE_INFINITY
      }
    })()
    const beating = lockAgeMs < LOCK_STALE_MS
    if (holdsAPid && isProcessAlive(holder) && beating && options.reclaim !== true) {
      throw new Error('control log at ' + dir + ' is already open by process ' + String(holder)
        + ' (heartbeat ' + String(Math.round(lockAgeMs)) + ' ms old, stale after ' + String(LOCK_STALE_MS) + ' ms)')
    }
    if (holdsAPid && isProcessAlive(holder)) {
      // A live holder that is not this log's owner — a recycled id, or an unrelated process — is
      // taken only when the caller asks, and the line says which of the two happened.
      console.log('[dsh-link-collab] reclaiming writer lock ' + lockPath + ' held by live process '
        + String(holder) + ' because the caller asked for it (reclaim: true)')
    } else {
      // The lock names no live writer: either it never held a pid record (a truncated or foreign
      // file — the shell's own writer-lock recovery hit exactly that shape) or the process that
      // wrote it is gone. Refusing here would be permanent, and at load time it takes the whole
      // plugin row down over a file nobody can release, so the lock is reclaimed and the
      // adoption is announced rather than done quietly.
      console.log('[dsh-link-collab] reclaiming writer lock ' + lockPath + ' content ' + (raw === '' ? '<empty>' : raw) + ' names no live writer')
    }
  }
  writeFileSync(lockPath, String(process.pid), 'utf8')
  // The beat is what makes "alive" mean something a recycled pid cannot fake.
  const heartbeat = setInterval(() => {
    try {
      utimesSync(lockPath, new Date(), new Date())
    } catch {
      /* the lock is gone (a close, or a reclaim): the next close() reports the same thing */
    }
  }, LOCK_HEARTBEAT_MS)
  heartbeat.unref?.()

  // R507/Y4: a composition that never asked for a checkpoint must not pay for one. The digest,
  // the stamp and the lazy records are all part of the checkpoint path, so they gate on it here.
  const wantDigest = FOLD_SETTINGS_STATE.checkpoint === true
  const opened = wantDigest
    ? openControlLedgerAccelerated(path, dir, localInstance)
    : openControlLedgerPlain(path)
  // R504: records are materialised on demand. A checkpoint-enabled open can name the ledger's tail
  // without parsing its prefix, and every path that needs the rows calls ensureRecords().
  let records: ControlRecord[] | null = opened.records
  let recordsComplete = opened.complete
  let recordsFloor = opened.floor
  let damage: DamageReport | null = opened.damage
  let digestHash: ReturnType<typeof createHash> | null = opened.hash
  let digestHex: string | null = opened.digestHex
  let digestVerifiedAt = opened.verifiedAt
  let lineCount = opened.lines
  let ledgerBytes = opened.bytes
  let recordCount = opened.count
  // Re-seeding is what a log that forgets its own tail looks like. The flag exists so the
  // gate can prove it would catch that: a defect nobody can reproduce on demand is a defect
  // nobody can test for.
  let lastSeq = attackFlag('DSH_LINK_COLLAB_FORGET_SEQ') ? 0 : opened.lastSeq

  /**
   * Parse the whole ledger into records, once, the way every pre-R504 open did.
   *
   * Only a path that needs the rows calls this: the checkpoint's cold read answers from its state
   * file, so it must not pay the parse (R504). A damaged ledger's parse is the same one the reader
   * always did, damage report included.
   * @returns the whole ledger's records, in sequence order.
   */
  function ensureRecords(): ControlRecord[] {
    if (records !== null && recordsComplete) return records
    const ledger = readControlLedger(path, digestHash === null)
    if (digestHash === null && ledger.hash !== null) {
      digestHash = ledger.hash
      digestHex = null
      digestVerifiedAt = Date.now()
      FOLD_STATS.digestsComputed += 1
    }
    records = ledger.records
    recordsComplete = true
    recordsFloor = records.length > 0 ? records[0]?.seq ?? lastSeq + 1 : lastSeq + 1
    damage = ledger.damage
    lineCount = ledger.lineCount
    ledgerBytes = ledger.bytes
    recordCount = records.length
    rebuildMarks()
    return records
  }

  /** The digest, computed on first ask when the open had no reason to hash (R507/Y4). */
  function currentDigest(): string {
    if (digestHash !== null) return digestHash.copy().digest('hex')
    if (digestHex !== null) return digestHex
    const text = readFileSync(path, 'utf8')
    digestHash = createHash('sha1').update(text)
    lineCount = countNewlines(text)
    digestVerifiedAt = Date.now()
    FOLD_STATS.digestsComputed += 1
    return digestHash.copy().digest('hex')
  }

  let stampScheduled = false
  /**
   * Write the stamp that says where this log's tail is (R504).
   *
   * A cache write and nothing else: every failure is a reading (foldDiagnostics().lastStampReason)
   * and never touches the append that prompted it. A stamp is only written over bytes that already
   * reached the file, so a crash can leave it BEHIND the ledger but never ahead of it.
   */
  const writeStampNow = (): void => {
    if (!FOLD_SETTINGS_STATE.checkpoint || damage !== null) return
    if (digestHash === null && digestHex === null) return
    let size = -1
    let mtimeNs = '0'
    let identity = ''
    try {
      const stats = statSync(path, { bigint: true })
      size = Number(stats.size)
      mtimeNs = String(stats.mtimeNs)
      identity = String(stats.dev) + ':' + String(stats.ino) + '@' + resolve(path)
    } catch {
      return
    }
    // A write in flight has not reached the file yet; the next opportunity takes its bytes.
    if (size !== ledgerBytes) return
    const failure = writeLedgerStamp(dir, {
      format: LEDGER_STAMP_FORMAT,
      version: LEDGER_STAMP_VERSION,
      instance: localInstance,
      identity,
      bytes: size,
      lines: lineCount,
      records: recordCount,
      lastSeq,
      digest: currentDigest(),
      mtimeNs,
      verifiedAt: digestVerifiedAt,
    })
    if (failure === null) {
      FOLD_STATS.stampsWritten += 1
      FOLD_STATS.lastStampReason = null
    } else {
      FOLD_STATS.lastStampReason = 'stamp-write-failed: ' + failure
    }
  }

  /** Coalesce a burst of appends into one atomic stamp write (the batch the sidecar is updated per). */
  const scheduleStamp = (): void => {
    if (stampScheduled || !FOLD_SETTINGS_STATE.checkpoint) return
    stampScheduled = true
    const handle = setImmediate(() => {
      stampScheduled = false
      try { writeStampNow() } catch { /* a cache write cannot fail an append */ }
    })
    ;(handle as { unref?: () => void }).unref?.()
  }
  const stream: WriteStream = createWriteStream(path, { flags: 'a' })
  stream.on('error', () => {
    // The write path reports its own failures through the append promise; an unhandled
    // stream error would take the process down instead.
  })

  // The two channels share nothing: separate storage, separate schedule.
  const data = new Map<string, DataEntry[]>()
  let closed = false
  let closing = false
  let pending = 0

  // Appends are serialised through one promise chain: that is what makes a sequence reliable
  // without a lock on the hot path, and it keeps the write order equal to the sequence order.
  let queue: Promise<unknown> = Promise.resolve()
  const serialise = <T,>(work: () => T): Promise<T> => {
    const next = queue.then(work)
    queue = next.then(() => undefined, () => undefined)
    return next
  }

  /**
   * Accept work now and run it in order; refuse work offered once closing has begun.
   *
   * The decision is taken when the caller asks, not when the queued work happens to run, so "the
   * work already admitted finishes" is true of the code rather than only of the comment: a write
   * offered before `close()` lands before the stream is ended, and one offered after does not.
   *
   * @param work - the write to perform, once its turn in the queue arrives.
   * @returns the work's result, or a rejection when the log is closing or closed.
   */
  const admit = <T,>(work: () => Promise<T>): Promise<T> => {
    if (closed || closing) return Promise.reject(new Error('control log is closed'))
    return serialise(work)
  }

  /** Wait for every queued write to reach the stream, for the close path. */
  const drained = (): Promise<void> => new Promise((done) => {
    if (pending === 0) { done(); return }
    const check = (): void => { if (pending === 0) done(); else setTimeout(check, 1) }
    check()
  })

  const sweep = (): void => {
    const deadline = now() - dataTtlMs
    for (const [key, entries] of data) {
      const live = entries.filter((entry) => entry.at >= deadline)
      if (live.length === 0) data.delete(key)
      else if (live.length !== entries.length) data.set(key, live)
    }
  }

  // Per-writer high-water marks, rebuilt from the file. A relay resumes from these and a reader
  // folds the same records, so the two cannot disagree about what has been applied.
  // DSH_LINK_COLLAB_RELAY_SEQ_ONLY arms the defect this bookkeeping prevents: collapsing every
  // writer into one key, so two devices that both number their records from 1 swallow each other's
  // work and the receiver reports it as already applied.
  const seqOnly = attackFlag('DSH_LINK_COLLAB_RELAY_SEQ_ONLY')
  const nameOnly = attackFlag('DSH_LINK_COLLAB_RELAY_NAME_ONLY')
  const keyOf = (name: string, instance: string): string => (seqOnly ? '' : nameOnly ? name : name + '\u0000' + instance)
  // Detecting a rewritten peer reads the marks themselves, so the fault flag that arms "name only"
  // collapses this check exactly as it collapses the keys: an attack has to be able to defeat the
  // code the gate claims to measure, or the gate is measuring the attack instead.
  const marks = new Map<string, WriterMark & { lastSeq: number }>()
  // Every instance ever seen per writer name. Adopting a rebuilt log adds to this set instead of
  // deleting the superseded mark, so the old instance's stream stays idempotent and alternating
  // adoptions cannot re-append history.
  const identOf = (instance: string): string => (nameOnly ? '*' : instance)
  const knownInstances = new Map<string, Set<string>>()
  const know = (name: string, instance: string): void => {
    knownInstances.set(name, (knownInstances.get(name) ?? new Set<string>()).add(identOf(instance)))
  }
  /** Rebuild the per-writer high-water marks from the records now held. */
  const rebuildMarks = (): void => {
    marks.clear()
    knownInstances.clear()
    for (const record of records ?? []) {
      const name = record.writer ?? localWriter
      const instance = record.instance ?? localInstance
      const key = keyOf(name, instance)
      know(name, instance)
      const previous = marks.get(key)
      const seq = record.originSeq ?? record.seq
      marks.set(key, { writer: name, instance, lastSeq: Math.max(previous?.lastSeq ?? 0, seq), records: (previous?.records ?? 0) + 1 })
    }
  }
  // A fully parsed open (the default composition, and every fallback) has its marks now; a
  // checkpoint-accelerated open builds them the moment a path first needs the rows.
  if (recordsComplete) rebuildMarks()

  /**
   * The number a record this log produces takes in its own stream: one past the highest number this
   * log has already handed out under that name.
   *
   * The own stream counts what this log **produced**, not what it holds: a log that ingested three of
   * a peer's records and then writes one has produced one record, so that record is its first. `marks`
   * already counts per (writer, instance) — this log's own key counts exactly its own work — and the
   * larger of that count and the highest number already used keeps a ledger written by an older build
   * monotone instead of reusing a number it handed out long ago.
   */
  const ownNext = (writer: string, instance: string): number => {
    const mark = marks.get(keyOf(writer, instance))
    return Math.max(mark?.records ?? 0, mark?.lastSeq ?? 0) + 1
  }

  /**
   * Append one record under a writer's name.
   *
   * `originSeq` is the record's number in the stream of the log that produced it; null means this log
   * is the producer and the record takes the next number in its **own** stream (see {@link ownNext}),
   * not the next local sequence. A write that never landed leaves both the sequence and the marks
   * untouched, so a failed relay cannot skip a record silently.
   *
   * @param record - the record, without a sequence or a writer.
   * @param writer - the log the record belongs to.
   * @param originSeq - the record's number in that log, or null for a locally produced record.
   * @returns the sequence this log assigned.
   */
  const writeNow = (
    record: { kind: string, actor?: string, subject?: string, payload?: unknown, at?: number },
    writer: string,
    instance: string,
    originSeq: number | null,
  ): Promise<number> => new Promise<number>((done, fail) => {
    if (closed) { fail(new Error('control log is closed')); return }
    lastSeq += 1
    const entry: ControlRecord = {
      seq: lastSeq,
      channel: 'control',
      at: record.at ?? now(),
      kind: record.kind,
      writer,
      instance,
      originSeq: originSeq ?? ownNext(writer, instance),
      ...(record.actor === undefined ? {} : { actor: record.actor }),
      ...(record.subject === undefined ? {} : { subject: record.subject }),
      ...(record.payload === undefined ? {} : { payload: record.payload }),
    }
    // The line is serialised BEFORE anything counts as in flight. A payload JSON cannot represent
    // throws here, synchronously: with `pending` already incremented and the failure arriving after
    // the write call returned, the decrement never ran, `close()` waited on a counter that could not
    // move, and the consumed sequence left a hole in the file that made the log unrelayable.
    let line: string
    try {
      line = JSON.stringify(entry) + '\n'
    } catch (error) {
      lastSeq -= 1
      fail(error)
      return
    }
    pending += 1
    stream.write(line, (error) => {
      pending -= 1
      if (error) {
        lastSeq -= 1
        fail(error)
      } else {
        if (records !== null) records.push(entry)
        if (digestHash !== null) digestHash.update(line)
        lineCount += 1
        ledgerBytes += Buffer.byteLength(line)
        recordCount += 1
        const key = keyOf(writer, instance)
        know(writer, instance)
        const previous = marks.get(key)
        marks.set(key, { writer, instance, lastSeq: Math.max(previous?.lastSeq ?? 0, entry.originSeq ?? entry.seq), records: (previous?.records ?? 0) + 1 })
        scheduleStamp()
        done(entry.seq)
      }
    })
  })

  const record: ControlLog = {
    append(record) {
      return admit(() => {
        ensureRecords()
        return writeNow(record, localWriter, localInstance, null)
      })
    },
    ingest(batch) {
      return admit(async () => {
        const held = ensureRecords()
        if (typeof batch?.writer !== 'string' || batch.writer === ''
          || typeof batch?.instance !== 'string' || batch.instance === '') {
          throw new RelayError('RELAY_WRITER_MISSING', 'a relay batch must name its writer and its instance')
        }
        if (batch.writer === localWriter && batch.instance === localInstance) {
          throw new RelayError('RELAY_IMPERSONATION', 'a batch from ' + batch.writer + '/' + batch.instance
            + ' claims this log\'s own identity; a peer must relay under its own name and instance')
        }
        // The same refusal applies to a batch that carries this log's OWN writer name under another
        // instance, `adopt` or not: adoption is how a peer announces that IT rebuilt ITS ledger, and that
        // cannot be true of the name this log writes under. Two live ends writing one name is exactly the
        // configuration `LogOptions.writer` exists to separate, and merging the second end's history into
        // this log's own stream would leave "who wrote this" unanswerable. R57 measured the hole: this
        // path answered 200 while the identity check above refused the same name byte for byte.
        if (batch.writer === localWriter) {
          throw new RelayError('RELAY_IMPERSONATION', 'a batch from ' + batch.writer + '/' + batch.instance
            + ' carries this log\'s own writer name under another instance; adopting it would merge a second'
            + ' end\'s history into this log\'s own stream')
        }
        const known = knownInstances.get(batch.writer) ?? new Set<string>()
        const seen = known.has(identOf(batch.instance))
        if (!seen && known.size > 0 && batch.adopt !== true) {
          throw new RelayError('RELAY_REWRITTEN', 'writer ' + batch.writer + ' is already held as instance '
            + [...known].join(', ') + '; a log that starts over must be adopted explicitly (adopt: true)')
        }
        if (!seen && known.size > 0) {
          console.log('[dsh-link-collab] adopting a rebuilt log: ' + batch.writer + ' ' + [...known].join(', ')
            + ' -> ' + batch.instance + '; earlier records stay, and the old stream stays idempotent')
        }
        know(batch.writer, batch.instance)
        // R183-E: one row, one writer. An end/manifest row may only be written by the end it names, and
        // the relay is the face that sees the writer on the wire. A batch header is a claim, not a proof
        // (the page's section five-two), so this log refuses on it only where it can tell which end that
        // writer is: the writer declared a manifest about itself - in this batch, or in the rows this log
        // already holds. A writer with no such declaration is taken at its word and the row lands, which
        // is why this is a rule about who may speak and not a rule about what the payload says. The
        // refusal happens before the first append, so a refused batch leaves the ledger byte for byte as
        // it was.
        const manifestRows = batch.records.filter((row) => row?.kind === MANIFEST_KIND)
        if (manifestRows.length > 0 && (declaresItself(held, batch.writer) || manifestRows.some((row) => manifestEndOf(row) === batch.writer))) {
          const speaking = manifestRows.find((row) => manifestEndOf(row) !== null && manifestEndOf(row) !== batch.writer) ?? null
          if (speaking !== null) {
            throw new ManifestRefusal('MANIFEST_NOT_AUTHORIZED', 'batch from ' + batch.writer + ' carries an end/manifest row for '
              + describeValue(manifestEndOf(speaking)) + ', and ' + describeValue(batch.writer) + ' declared a manifest of its own; a manifest row may only be written by the end it names, so an end may declare itself and nobody else (nothing was appended)')
          }
        }
        // A record without a usable sequence used to fall through every check and be reported as
        // already applied: `row.seq > have` is false for undefined, so the batch appended nothing
        // and said nothing. Non-integers, missing sequences and repeats now have one answer, and it
        // is not silence.
        for (const row of batch.records) {
          if (!Number.isInteger(row?.seq) || row.seq < 1) {
            throw new RelayError('RELAY_MALFORMED', 'batch from ' + batch.writer
              + ' carries a record whose seq is ' + JSON.stringify(row?.seq ?? null) + ', not a positive integer')
          }
        }
        const incoming = [...batch.records].sort((left, right) => left.seq - right.seq)
        for (let index = 1; index < incoming.length; index += 1) {
          if (incoming[index].seq === incoming[index - 1].seq) {
            throw new RelayError('RELAY_MALFORMED', 'batch from ' + batch.writer + ' carries sequence '
              + String(incoming[index].seq) + ' twice')
          }
          if (incoming[index].seq !== incoming[index - 1].seq + 1) {
            throw new RelayError('RELAY_HOLE', 'batch from ' + batch.writer + ' skips from '
              + String(incoming[index - 1].seq) + ' to ' + String(incoming[index].seq))
          }
        }
        const have = marks.get(keyOf(batch.writer, batch.instance))?.lastSeq ?? 0
        // The overlap is compared by content, not assumed: a position that already holds a
        // different record is a conflict, and reporting it as already-applied would hide it.
        const applied = new Map<string, ControlRecord>()
        // R346 (perf): the overlap check used `.find` over the WHOLE log for every incoming row, i.e.
        // Theta(overlap x L) - the research measured ~250 ms of synchronous work for 1,000 overlapping rows at L=30k.
        // One index for this batch turns every lookup into a map hit. FIRST match wins, exactly like `.find` did, so a
        // log that somehow holds two rows at one position keeps answering with the one it answered with before.
        const positionKey = (candidate: ControlRecord): string => String(candidate.writer ?? localWriter) + '\u0000'
          + String(candidate.instance ?? localInstance) + '\u0000' + String(candidate.originSeq ?? candidate.seq)
        const byPosition = new Map<string, ControlRecord>()
        for (const candidate of held) {
          const key = positionKey(candidate)
          if (byPosition.has(key) === false) byPosition.set(key, candidate)
        }
        for (const row of incoming) {
          if (row.seq > have) break
          if (!applied.has(String(row.seq))) {
            const stored = byPosition.get(positionKey({ writer: batch.writer, instance: batch.instance, originSeq: row.seq } as ControlRecord))
            if (stored !== undefined) applied.set(String(row.seq), stored)
          }
          const stored = applied.get(String(row.seq))
          if (stored === undefined) continue
          const same = stored.kind === row.kind && String(stored.actor ?? '') === String(row.actor ?? '')
            && String(stored.subject ?? '') === String(row.subject ?? '')
            && canonical(stored.payload) === canonical(row.payload)
          if (!same) {
            throw new RelayError('RELAY_CONFLICT', 'record ' + String(row.seq) + ' from ' + batch.writer
              + '/' + batch.instance + ' contradicts the record this log already applied at that position')
          }
        }
        const fresh = incoming.filter((row) => row.seq > have)
        if (fresh.length === 0) return { writer: batch.writer, appended: 0, skipped: incoming.length }
        // A batch that resumes above the mark leaves a hole this log would never see again: the
        // missing records are not coming back, and folding over the gap reports a state no writer
        // produced. Refusing is the only answer that keeps the fold honest.
        if (fresh[0].seq !== have + 1) {
          throw new RelayError('RELAY_GAP', 'batch from ' + batch.writer + ' starts at '
            + String(fresh[0].seq) + ' but this log holds up to ' + String(have))
        }
        let appended = 0
        for (const row of fresh) {
          await writeNow({ kind: row.kind, ...(row.actor === undefined ? {} : { actor: row.actor })
            , ...(row.subject === undefined ? {} : { subject: row.subject })
            , ...(row.payload === undefined ? {} : { payload: row.payload })
            , ...(row.at === undefined ? {} : { at: row.at }) }, seqOnly ? localWriter : batch.writer,
            seqOnly ? localInstance : batch.instance, row.seq)
          appended += 1
        }
        return { writer: batch.writer, appended, skipped: incoming.length - fresh.length }
      })
    },
    marks() {
      ensureRecords()
      return [...marks.values()].map((mark) => ({ ...mark }))
    },
    ownPage(since = 0, limit = Number.MAX_SAFE_INTEGER) {
      ensureRecords()
      const out: ControlRecord[] = []
      for (const record of records ?? []) {
        if ((record.writer ?? localWriter) !== localWriter) continue
        if ((record.instance ?? localInstance) !== localInstance) continue
        if ((record.originSeq ?? record.seq) <= since) continue
        out.push(record)
        if (out.length >= limit) break
      }
      return out
    },
    writer: localWriter,
    instance: localInstance,
    page(since = 0, limit = Number.MAX_SAFE_INTEGER) {
      if (!recordsComplete) {
        if (records === null) {
          // Nothing after the tail can be in the unparsed prefix or the absent suffix.
          if (since >= lastSeq) return []
          ensureRecords()
        } else if (since < recordsFloor - 1) {
          // The page reaches into the prefix this open left unparsed.
          ensureRecords()
        }
      }
      const out: ControlRecord[] = []
      for (const record of records ?? []) {
        if (record.seq <= since) continue
        out.push(record)
        if (out.length >= limit) break
      }
      return out
    },
    replay() {
      ensureRecords()
      return [...(records ?? [])]
    },
    get lastSeq() {
      return lastSeq
    },
    get digest() {
      return currentDigest()
    },
    directory: dir,
    get damage() {
      return damage
    },
    get recordsMaterialised() {
      return recordsComplete
    },
    get openTier() {
      return opened.tier
    },
    put(key, entry) {
      if (closed) throw new Error('control log is closed')
      const list = data.get(key) ?? []
      list.push({ channel: 'data', at: entry.at ?? now(), kind: entry.kind, ...(entry.payload === undefined ? {} : { payload: entry.payload }) })
      // The cap applies to the stream as a whole, oldest first, so a stream that never
      // expires cannot grow without bound.
      if (list.length > dataCapacity) list.splice(0, list.length - dataCapacity)
      data.set(key, list)
      sweep()
    },
    take(key) {
      sweep()
      return [...(data.get(key) ?? [])]
    },
    dataSize() {
      sweep()
      let total = 0
      for (const entries of data.values()) total += entries.length
      return total
    },
    async close() {
      // Closing is announced first so no new work is admitted, then the work already admitted is
      // allowed to finish before the drain: setting `closed` first let a half-applied batch be cut
      // off by its own shutdown, turning a recoverable failure into a permanent one.
      closing = true
      await queue.catch(() => undefined)
      closed = true
      await drained()
      // The stamp is flushed only after every admitted write reached the file, so it can never
      // describe bytes the ledger does not hold. A crash between an append and this flush leaves
      // the stamp BEHIND the ledger, which the next open handles: it hashes the prefix the stamp
      // covers and parses the suffix it does not.
      if (FOLD_SETTINGS_STATE.checkpoint) {
        try { writeStampNow() } catch { /* a cache write cannot fail a shutdown */ }
      }
      STAMP_WRITERS.delete(record)
      await new Promise<void>((done) => { stream.end(done) })
      try {
        clearInterval(heartbeat)
    rmSync(lockPath, { force: true })
      } catch {
        // A lock that will not delete is not worth failing a shutdown over: the next open
        // checks whether the recorded process is still alive.
      }
    },
  }
  STAMP_WRITERS.set(record, writeStampNow)
  // A checkpoint-enabled open that read the ledger leaves the next cold read a stamp; a damaged
  // ledger gets none, because no later reader may believe a prefix the writer could not parse.
  if (FOLD_SETTINGS_STATE.checkpoint) {
    if (damage === null && recordCount > 0 && opened.tier !== 'stamp-trusted') writeStampNow()
    else if (damage !== null) discardLedgerStamp(dir)
  }
  return record
}


/* ------------------------------------------------------------------------------------------------
 * The projection: what the ledger says the team looked like.
 *
 * A ledger that cannot be folded back into a state is a log file, not a control channel. The
 * acceptance bar the recognition docs set for this layer is exactly that — replay the control
 * records and rebuild the task board — so the projection is part of this plugin rather than a
 * reader's private business.
 *
 * It folds only this plugin's records. It is deliberately not wired to `ctx.agentTeams`: that
 * service publishes no events and its interception is config merging rather than method
 * wrapping, so observing it would mean either polling it or wrapping it, and both would tie
 * this projection to a service shape the compatibility layer exists to survive. What the fold
 * does own is the part that has to be right: given the same records, it always produces the
 * same state, and it never invents a task no record mentioned.
 *
 * Records are facts, not commands. A fold of the first N records is the state after N facts,
 * which is what makes a cursor meaningful: a reader can page the ledger and hold a state
 * without reading the whole file.
 * ---------------------------------------------------------------------------------------------- */

/** One task as the ledger describes it. */
export interface ProjectedTask {
  /** The task's id, as the writer named it. */
  readonly id: string
  /**
   * The team the record attributed it to, or null when the record named none.
   *
   * Two teams may both have a task "1", and nothing in the kernel makes task ids unique across
   * teams. Without this field the fold keys by id alone, so the second team's update overwrites the
   * first team's task and the state reports one task where two exist — a loss the folded count
   * cannot show, because both records were folded.
   */
  readonly team: string | null
  /** The last status a record gave it, or 'open' when none did. */
  readonly status: string
  /** The last owner a record gave it, or null. */
  readonly owner: string | null
  /** How many records have touched it. */
  readonly records: number
  /** The sequence of the record that last changed it. */
  readonly at: number
  /** The claim the projection used, with the fields of the record that made it. */
  readonly claim: ProjectedClaim
  /** Which rule chose the winner: the records' own clocks, or arrival order when they cannot. */
  readonly resolvedBy: 'at' | 'arrival'
  /** True when another claim on this task disagreed with the winner and was superseded. */
  readonly contested: boolean
  /** The claims this one superseded, newest first. A folded record is kept, never dropped. */
  readonly losers: readonly ProjectedClaim[]
}

/**
 * One claim on a task's status: the fields of the record that made it.
 *
 * A claim is kept as a value rather than folded away, because two records can describe the same
 * task and disagree. The projection has to say which claim it used and what rule decided.
 */
export interface ProjectedClaim {
  /** The status this claim asserted. */
  readonly status: string
  /** The owner this claim asserted, or null. */
  readonly owner: string | null
  /** The record's own clock, when the writer stamped one. */
  readonly at: number | null
  /** The record's sequence: arrival order, always known. */
  readonly seq: number
  /** The writer that made the claim, when the record named one. */
  readonly writer: string | null
}

/** One member as the ledger describes it. */
export interface ProjectedMember {
  /** The member's identity, which is what the kernel's Team service keys a member by. */
  readonly id: string
  /** The team the record attributed it to, or null when the record named none. */
  readonly team: string | null
  /** The member's name, when a record carried one. */
  readonly name: string | null
  /** The last state a record gave it, or 'joined' when none did. */
  readonly state: string
  /** The member's role, when a record carried one. */
  readonly role: string | null
  /** The sequence of the record that last changed it. */
  readonly at: number
  /** The claim the projection used, with the fields of the record that made it. */
  readonly claim: ProjectedMemberClaim
  /** Which rule chose the winner: the records' own clocks, or arrival order when they cannot. */
  readonly resolvedBy: 'at' | 'arrival'
  /** True when another claim on this member disagreed with the winner and was superseded. */
  readonly contested: boolean
  /** The claims this one superseded, newest first. A folded record is kept, never dropped. */
  readonly losers: readonly ProjectedMemberClaim[]
}

/**
 * One claim on a member's state: the fields of the record that made it.
 *
 * Members carry the same ambiguity tasks do. Two records can describe one member and disagree, and
 * a ledger delivered out of order must still project one answer that says how it chose — deciding
 * by arrival order alone made the projection depend on the network rather than on the facts.
 */
export interface ProjectedMemberClaim {
  /** The name this claim asserted. */
  readonly name: string | null
  /** The state this claim asserted. */
  readonly state: string
  /** The role this claim asserted. */
  readonly role: string | null
  /** The writer's own clock for the claim, when the record carried one. */
  readonly at: string | null
  /** Arrival order, which decides when the clocks cannot. */
  readonly seq: number
  /** The writer that made the claim. */
  readonly writer: string | null
}

/** What the control records add up to. */
export interface TeamState {
  /** Tasks keyed by id, in the order their ids were first mentioned. */
  readonly tasks: readonly ProjectedTask[]
  /** Members in the order their names were first mentioned. */
  readonly members: readonly ProjectedMember[]
  /** The last sequence folded. */
  readonly through: number
  /**
   * Records the fold recognized, records it did not, and the entities it produced.
   *
   * `folded` counts records and `tasks`/`members` count distinct entities, so a reader can tell
   * "five records about two tasks" from "five records about five tasks". `teams` counts the team
   * buckets, including the unnamed one, which is how a caller sees that it is looking at two teams.
   */
  readonly counts: {
    readonly folded: number
    readonly unknown: number
    readonly tasks: number
    readonly members: number
    readonly teams: number
    readonly unattributed: number
  }
  /**
   * What members declared about themselves, folded from `capability/state` records.
   *
   * Capability is this layer's own concept, not a projection of a kernel one: no kernel Team event
   * carries it, so it is a fact only because a member wrote it down here. Keeping it in the same
   * fold as task and member state is what makes "who can do X" a question about the ledger rather
   * than about whichever service happens to be mounted.
   */
  readonly registry: RegistryState
  /**
   * Last heartbeat per member, folded from `member/heartbeat` records.
   *
   * Liveness is a ledger fact for the same reason capability is: nothing in the kernel beats, and a
   * verdict that lives in a timer cannot be replayed. The fold stores instants; the decisions
   * (`livenessOf`, `recoverable`, `isQuarantined`) are pure functions of those instants and a
   * `now` the caller supplies.
   */
  readonly liveness: LivenessState
  /**
   * The members this ledger has isolated, folded from `member/quarantine` records.
   *
   * Beside the liveness fold and independent of it, like the registry: a member can be isolated by a
   * reclaim while the liveness fold still reports it `unknown` (it never beat), and the two facts
   * belong to different questions — who spoke, and who is being kept out of new work.
   */
  readonly quarantine: readonly QuarantineRow[]
  /**
   * Capability each task demands, by task id, when the task's own record names one.
   *
   * Folded here rather than carried on the task projection: adding a field to `tasks` would change
   * a reading other consumers already depend on, and the demand is needed by exactly one query.
   */
  readonly taskDemands: Readonly<Record<string, string>>
  /** The team tree, folded from `team/state` declarations. */
  readonly teams: TeamTreeState
  /** Lead-to-lead handshakes, folded from `peer/state` records. */
  readonly peers: PeerState
  /** The dependency graph folded from `task/state` records. */
  readonly board: BoardState
  /** The last lock record per task, folded from `lock/state` records. */
  readonly locks: readonly BoardLock[]
  /**
   * Who may write each session, folded from `session/claim` and `session/handoff` records.
   *
   * One author per session, at one generation. It sits beside the board and the lock table rather
   * than on top of them, because it answers a different question: the board says who is doing the
   * work, this says who may write the conversation the work is being done in. {@link mayWrite} is
   * the boolean the rest of the system asks; a session nobody claimed yields an empty state, never
   * a missing field.
   */
  readonly sessions: SessionsState
  /**
   * Where each member runs and how this end reaches it, folded from member/host records.
   *
   * A member with no row here runs on this end: the absence of the fact is the historical reading,
   * not a missing answer, and {@link routes} resolves it to a zero-hop path rather than to a failure.
   */
  readonly hosting: HostingState
  /**
   * The adapters this ledger has declared, folded from adapter/state records.
   *
   * Beside the rest and independent of them: no adapter record means no adapters, never a missing
   * field. An adapter is a member as well, so its heartbeats, capabilities and host facts are read
   * from the folds that already exist rather than from a second identity.
   */
  readonly adapters: AdaptersState
  /**
   * Work handed to members that run elsewhere, folded from `task/dispatch` and `task/result`.
   *
   * Beside the rest and independent of them: no dispatch record means no dispatches, never a missing
   * field. "Did the work run" is a question about the ledger, answered by folding the answer the
   * member wrote, not by reaching for the member.
   */
  readonly dispatches: DispatchState
  /**
   * Claims on retrying a root, folded from `task/retry-lease` records.
   *
   * Retrying is coordinated by the ledger and not by a timer: two ends can each decide the same work
   * waited too long, and the merged history has to crown exactly one of them from the records alone.
   * The fold stores the claims; {@link retryOwner} is the one place that decides who holds one.
   */
  readonly retryLeases: readonly RetryLease[]
  /**
   * What each end declared it can do, folded from `end/manifest` records (R183, md:374).
   *
   * Beside the hosting facts and independent of them: no manifest means no end said anything about
   * itself, never a missing field. {@link effectiveCapabilities} is the decay along the chains these
   * rows describe; {@link brokerKeys} is the key space built from it.
   */
  readonly manifests: ManifestState
  /**
   * Recruiting and being recruited, folded from `team/merge` records (R183, md:229/274).
   *
   * The tree itself is {@link TeamState.teams}; this is the agreement that explains one change to it,
   * kept beside it rather than inside it, because only the party being merged in writes a parent and
   * the record of who authorized that is a different fact from the parent itself.
   */
  readonly merges: MergeState
}

/** One lock record's effect, as folded. */
export interface BoardLock {
  /** The {@link boardKey} of the task being locked, which is what the lock is held on. */
  readonly key: string
  /** The task's id, as the writer named it. */
  readonly id: string
  /** The team the lock was taken in, or null when the record named none. */
  readonly team: string | null
  /** The holder, or null when the record released it. */
  readonly holder: string | null
  /** The instant the record was written, in milliseconds. */
  readonly at: number
  /** Sequence of the record this row came from. */
  readonly seq: number
}

/** What one task's lock means at one instant. */
export interface LockReading {
  /** The address asked about: the {@link boardKey} of the task, echoed back. */
  readonly task: string
  /** The holder when the lock is live, else null. */
  readonly holder: string | null
  /** Milliseconds since the lock was taken, or null when nobody ever locked it. */
  readonly sinceMs: number | null
  /** Whether the lock is past its time to live. Reported even when nobody holds it, so a reader can
   * tell "nobody ever locked this" from "the lock went stale". */
  readonly expired: boolean
}

/**
 * The key one board entity is addressed by: its team, a NUL, then its id.
 *
 * One rule, exported, because a board is only usable when a caller can build the same key the fold
 * built. Two teams may both have a task "1" and nothing in the kernel makes task ids unique across
 * them, so an id alone is not an address: the team is half of the primary key. What a record says
 * its team is comes from {@link teamOf}, so a task, a member and a lock of one team key alike.
 *
 * DSH_LINK_COLLAB_DROP_TEAM_KEY drops the team half, which is the defect this exists to prevent.
 * It is the same switch `projectTeamState` answers to, so an armed attack proves the board loses
 * the same fact the task fold loses instead of proving the board alone is broken.
 * @param team - the team the record attributed the entity to, or null when it named none.
 * @param id - the id the writer named.
 * @returns the key.
 */
export function boardKey(team: string | null, id: string): string {
  return attackFlag('DSH_LINK_COLLAB_DROP_TEAM_KEY') ? id : (team ?? '') + '\u0000' + id
}

/**
 * The team one control record attributes its entity to, or null when it names none.
 *
 * The team id lives on the record's actor today: a control record is written per team, and the
 * kernel's team events carry the team id there. A writer that puts it in the payload instead — a
 * future kernel, another producer, a backfilled row — must not silently fold into the unnamed
 * bucket, because that is the same merge defect under another field name. Both payload spellings
 * are read: `payload.teamId` is what the kernel's own event shapes use and `payload.team` is
 * what this layer's lock record carries. The actor wins when it is present, so that the task fold,
 * the board and the lock table can never disagree about a record's team — a disagreement would key
 * one fact two ways, which is how one fold came to say `completed` while another said `pending`.
 * @param record - the record to read.
 * @returns the team id, or null.
 */
function teamOf(record: ControlRecord): string | null {
  const payload = record.payload as { teamId?: unknown, team?: unknown } | undefined
  const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
  return text(record.actor) ?? text(payload?.teamId) ?? text(payload?.team)
}

/**
 * Which of two claims about one entity wins, and whether the writers' clocks decided it.
 *
 * One implementation of one rule: when both claims carry a clock, the later clock wins and an equal
 * clock is broken by arrival order; when either claim carries none, arrival order decides. A
 * missing clock is never read as "the oldest instant", because that would make the board disagree
 * with the task fold. Both the task fold and the board call this, and that is the point: with two
 * copies of the rule, the board crowned the highest sequence while `state.tasks` crowned the
 * latest clock, so one fold answered `completed` and the other `pending` for the same key and
 * `claimable` said `ready` on the strength of the wrong one.
 * @param previous - the claim already held.
 * @param incoming - the claim arriving now.
 * @returns who wins, and whether the clocks — not arrival order — chose.
 */
export function foldClaim(previous: { at: number | null, seq: number }, incoming: { at: number | null, seq: number }): { incomingWins: boolean, byAt: boolean } {
  if (previous.at !== null && incoming.at !== null) {
    return {
      incomingWins: incoming.at > previous.at || (incoming.at === previous.at && incoming.seq > previous.seq),
      byAt: incoming.at !== previous.at,
    }
  }
  return { incomingWins: incoming.seq > previous.seq, byAt: false }
}

/** Order board rows by key, so a table's order never depends on when its rows arrived. */
const byKey = (left: { key: string }, right: { key: string }): number => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)

/**
 * Resolve one declared dependency to the key it names.
 *
 * A declaration that already carries the separator IS a key and is used verbatim — that is the only
 * way to depend on another team's task. Anything else is a bare id, and a bare id can only mean the
 * team that declared it: completing it against every team that happens to share the id is how one
 * team's "d1" came to satisfy another team's dependency. So a cross-team edge has to be spelled out,
 * and a bare id never leaks across teams.
 *
 * The declaration itself is kept beside this, in `declaredDeps`: a reader has to be able to tell
 * "the writer wrote a key" from "the team was supplied for it", and this function is where the
 * difference is made.
 * @param team - the team of the task that declared the dependency.
 * @param declared - the declared value, verbatim.
 * @returns the key it names.
 */
function resolveDep(team: string | null, declared: string): string {
  return declared.includes('\u0000') ? declared : boardKey(team, declared)
}

/**
 * The record kind that carries a lock.
 *
 * A null holder is a release, not an absence: "this task is free" is a fact somebody asserted, and a
 * reader must be able to tell it from "nobody has said anything about this task".
 */
export const LOCK_KIND = 'lock/state'

/**
 * Build a lock record.
 * @param taskId - the task to lock, or release.
 * @param holder - the holder, or null to release.
 * @param at - the instant, in milliseconds. Passed in; no clock is read here.
 * @returns the record to append, without a sequence.
 */
export function lockRecord(taskId: string, holder: string | null, at: number, team?: string | null): { kind: string, subject: string, payload: Record<string, unknown> } {
  if (typeof taskId !== 'string' || taskId === '') throw new TypeError('lockRecord: taskId must be a non-empty string')
  if (holder !== null && (typeof holder !== 'string' || holder === '')) throw new TypeError('lockRecord: holder must be null or a non-empty string')
  if (!Number.isFinite(at)) throw new TypeError('lockRecord: at must be a finite number of milliseconds')
  if (team !== undefined && team !== null && (typeof team !== 'string' || team === '')) throw new TypeError('lockRecord: team must be omitted, null, or a non-empty string')
  // The team is written down rather than inferred from the writer, because a lock is taken on a
  // task id and task ids are not unique across teams: without it the lock would land on whichever
  // team's task happened to share the id.
  return { kind: LOCK_KIND, subject: taskId, payload: { task: taskId, holder, at, team: team === undefined || team === null ? null : team } }
}

/**
 * The records in ascending sequence order, computed at most once per array.
 *
 * Every projection folds from sequence order - the ledger's order, not the caller's. Each one used to
 * open with `[...records].sort(...)`, and projectDispatches/projectManifests also call other
 * projections internally, so one fold copied and sorted the whole ledger EIGHTEEN times: R487 measured
 * 2.8 ms per 100k-row sort, about 17% of a cold fold. The array `log.replay()` hands over is already
 * in that order, so this returns it unchanged after one ascending pass and no allocation. A genuinely
 * unordered array is still copied and sorted exactly as before, which keeps every projection's
 * documented "records in any order" contract.
 *
 * The memo is keyed by array identity and guarded by (length, last sequence): an array that grew in
 * place since it was last seen is re-checked instead of trusted. The result is read-only; no fold
 * writes to it.
 *
 * @param records - control records, in any order.
 * @returns the same records in ascending sequence order; the caller's own array when it already is.
 */
const ORDERED = new WeakMap<object, { readonly length: number, readonly lastSeq: number | undefined, readonly ordered: readonly ControlRecord[] }>()

function orderedRecords(records: readonly ControlRecord[]): readonly ControlRecord[] {
  const last = records[records.length - 1]
  const lastSeq = last === undefined ? undefined : last.seq
  const cached = ORDERED.get(records)
  if (cached !== undefined && cached.length === records.length && cached.lastSeq === lastSeq) return cached.ordered
  let ordered: readonly ControlRecord[] = records
  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1]
    const current = records[index]
    if (previous === undefined || current === undefined) continue
    if (previous.seq > current.seq) {
      ordered = [...records].sort((left, right) => left.seq - right.seq)
      break
    }
  }
  ORDERED.set(records, { length: records.length, lastSeq, ordered })
  return ordered
}

/**
 * Fold lock records to the last one per task.
 *
 * By `seq`, never by arrival: the same records arranged differently fold to the same table, and a
 * release that came later in the log wins over an earlier lock no matter how the lines are ordered.
 * @param records - every record read from the log, in any order.
 * @returns one row per task that was ever locked, ordered by task id.
 */
/** The mutable state of {@link projectLocks}: the winning row per lock key, folded so far. */
interface LocksFoldState {
  latest: Map<string, BoardLock>
}

function emptyLocksFold(): LocksFoldState {
  return { latest: new Map() }
}

/** Step the lock fold over one batch of records, in sequence order. */
function foldLocks(state: LocksFoldState, records: readonly ControlRecord[]): void {
  for (const record of orderedRecords(records)) {
    if (record.kind !== LOCK_KIND) continue
    const payload = record.payload as { task?: unknown, holder?: unknown, at?: unknown } | undefined
    const id = typeof payload?.task === 'string' && payload.task !== '' ? payload.task : record.subject
    if (typeof id !== 'string' || id === '') continue
    if (typeof payload?.at !== 'number' || !Number.isFinite(payload.at)) continue
    const raw = payload?.holder
    const holder = typeof raw === 'string' && raw !== '' ? raw : null
    const team = teamOf(record)
    const key = boardKey(team, id)
    state.latest.set(key, { key, id, team, holder, at: payload.at, seq: record.seq })
  }
}

function finishLocks(state: LocksFoldState): BoardLock[] {
  return [...state.latest.values()].sort(byKey)
}

export function projectLocks(records: readonly ControlRecord[]): BoardLock[] {
  const state = emptyLocksFold()
  foldLocks(state, records)
  return finishLocks(state)
}

/**
 * Who holds one task's lock at one instant.
 *
 * `now` is a parameter and no clock is read here, for the same reason `livenessOf` takes one: a
 * verdict that depends on wall time cannot be reproduced. The boundary is the same convention
 * written once: the lock is **expired once its age reaches the ttl**, so `now - at === ttlMs` is
 * already expired. An expired or released lock reports `holder: null` while still reporting
 * `expired`, so a caller can distinguish the two.
 * @param state - a folded state.
 * @param task - the task to ask about.
 * @param now - the instant, in milliseconds.
 * @param options - the lock's time to live.
 * @returns the reading.
 */
export function lockHolder(state: TeamState, key: string, now: number, options: { ttlMs: number }): LockReading {
  const row = state.locks.find((lock) => lock.key === key)
  if (row === undefined) return { task: key, holder: null, sinceMs: null, expired: false }
  const sinceMs = Math.max(0, now - row.at)
  const expired = sinceMs >= options.ttlMs
  return { task: key, holder: expired || row.holder === null ? null : row.holder, sinceMs, expired }
}

/** One task on the board, addressed by its {@link boardKey}. */
export interface BoardTask {
  /** The (team, id) key this row is addressed by. Every board map and array uses it. */
  readonly key: string
  /** Task id, as the writer named it. */
  readonly id: string
  /** The team the task belongs to, as recorded, or null when no record named one. */
  readonly team: string | null
  /** The status of the claim that won, by the same rule `state.tasks` uses. */
  readonly status: string
  /** The owner of the claim that won, by the same rule `state.tasks` uses. */
  readonly owner: string | null
  /**
   * The dependencies the writer declared, sorted and deduplicated, **verbatim**.
   *
   * This is the audit reading: it says what was written, not what it resolved to. A later record
   * that carries no `deps` field leaves it alone instead of erasing the graph, which is what
   * happened when a kernel update (whose payload has no `deps`) was read as "no dependencies".
   */
  readonly declaredDeps: readonly string[]
  /**
   * The dependencies as keys — the one spelling every other reading uses.
   *
   * Each declaration is resolved through {@link resolveDep}: one that carries the separator is
   * already a key and is used as-is (the only way to depend on another team's task), and a bare id
   * is completed with **this task's own team**, never with another team that shares the id.
   */
  readonly deps: readonly string[]
  /** How many records mention it. */
  readonly records: number
  /**
   * Which rule chose the winning claim: the writers' clocks, or arrival order.
   *
   * `at` when the clocks decided, or when the winning claim is the only claim of the pair that
   * carries a clock — there the clock is the only evidence in play. `seq` when arrival order chose
   * between claims that carry no clock or identical clocks.
   */
  readonly resolvedBy: 'at' | 'seq'
  /** True when the winning claim and a claim it superseded disagree on status or owner. */
  readonly contested: boolean
  /** True when more than one writer (log name) has written about it. */
  readonly multiWriter: boolean
}

/** One edge that closes a dependency cycle, and the loop it closes. */
export interface BoardCycle {
  /** The dependency edge that closes the loop, as board keys. */
  readonly edge: readonly [string, string]
  /** The loop's keys, sorted from the smallest. */
  readonly loop: readonly string[]
}

/** The board the fold produces. Every key it names is a {@link boardKey}. */
export interface BoardState {
  /** Every task with a record, ordered by key. */
  readonly tasks: readonly BoardTask[]
  /** Key to its dependencies, exactly the row's `deps`: keys, one spelling per relation. */
  readonly edges: Readonly<Record<string, readonly string[]>>
  /** Keys that may be claimed: not done, not a tombstone, not in a cycle, nothing unmet. */
  readonly ready: readonly string[]
  /** Key to the dependencies that are not done (tombstones included). */
  readonly blocked: Readonly<Record<string, readonly string[]>>
  /** Key to the dependencies that have no record at all. */
  readonly missing: Readonly<Record<string, readonly string[]>>
  /** Keys whose status says they are done. */
  readonly done: readonly string[]
  /** Every dependency cycle found. */
  readonly cycles: readonly BoardCycle[]
  /** Every dependency named but never declared, as keys. */
  readonly orphans: readonly string[]
  /**
   * Keys whose status is `deleted`: the kernel's terminal tombstone.
   *
   * A deleted task is finished with rather than unfinished, so it is never `ready` and it never
   * completes a dependency. Reporting it separately is what stops "this will never finish" from
   * reading like "this is still owed" — before this field, a task waiting on a tombstone was
   * reported as `blocked` forever with nothing saying why, and the tombstone itself was `ready`.
   */
  readonly removed: readonly string[]
  /**
   * Key to the dependencies whose status is `deleted`: dependants that can never proceed.
   *
   * Kept apart from `blocked` because the two answer different questions: `blocked` deps may still
   * complete, while these never will.
   */
  readonly unreachable: Readonly<Record<string, readonly string[]>>
  /** Task records whose status is not one this build knows. Counted, never treated as done. */
  readonly unknown: number
}

const DONE_STATUSES = ['completed', 'done']
const KNOWN_STATUSES = ['pending', 'in_progress', 'pending-claim', ...DONE_STATUSES, 'deleted']

/**
 * Fold the dependency graph.
 *
 * The winner for one key is chosen by {@link foldClaim}, the same rule the task fold uses, so the
 * board and `state.tasks` cannot crown different claims for one task — with two rules the board said
 * `pending` while `state.tasks` said `completed`, and `claimable` answered `ready` on the strength
 * of the wrong one. Every map and array here is addressed by {@link boardKey}, and `deps` holds
 * keys rather than the declared text: a dependency written as a bare id is resolved against the team
 * that declared it and no other, so team B's "d1" never satisfies team A's dependency on "d1", while
 * a dependency written as a key addresses exactly the team it names.
 *
 * Dependencies are read from `payload.deps`, where the recorder copies the kernel's own `blockedBy`
 * list; only an explicit array replaces the graph, and a record that carries no `deps` keeps the
 * previous declaration instead of silently erasing it. A dependency is satisfied only by a status
 * this build recognises as done (`done` or `completed`), because treating an unreadable status as
 * satisfied would let a misspelling silently unlock a task. A `deleted` dependency is reported in
 * `unreachable`: it is the kernel's terminal tombstone, so it will never complete, which is not the
 * same answer as "still owed". Cycles are found with an explicit stack, a real path stack and
 * per-node colour, and report the closing edge; a task on a cycle is never ready, which is a
 * definite answer rather than a timeout. A task with no dependencies and no done status is ready:
 * "no dependencies" is not "unknown dependencies".
 * @param records - every record read from the log, in any order.
 * @returns the board.
 */
/** One task as the board fold holds it while folding; the published row is built from it. */
interface BoardFoldRow {
  key: string
  id: string
  team: string | null
  claim: { status: string, owner: string | null, at: number | null, seq: number }
  declaredDeps: string[]
  records: number
  resolvedBy: 'at' | 'seq'
  contested: boolean
  writers: Set<string>
}

/** The mutable state of {@link projectBoard}: the winning claim per key, folded so far. */
interface BoardFoldState {
  latest: Map<string, BoardFoldRow>
  unknown: number
}

function emptyBoardFold(): BoardFoldState {
  return { latest: new Map(), unknown: 0 }
}

function foldBoard(state: BoardFoldState, records: readonly ControlRecord[]): void {
  const order = orderedRecords(records)
  for (const record of order) {
    if (record.kind !== TASK_KIND) continue
    const payload = record.payload as { id?: unknown, state?: unknown, owner?: unknown, deps?: unknown } | undefined
    const id = typeof payload?.id === 'string' && payload.id !== '' ? payload.id : record.subject
    if (typeof id !== 'string' || id === '') continue
    const status = typeof payload?.state === 'string' && payload.state !== '' ? payload.state : 'unknown'
    if (!KNOWN_STATUSES.includes(status)) state.unknown += 1
    const team = teamOf(record)
    const key = boardKey(team, id)
    const previous = state.latest.get(key)
    // Only an explicit array replaces the graph; a missing or non-array field leaves it alone.
    const declared = Array.isArray(payload?.deps)
      ? [...new Set(payload.deps.filter((dep): dep is string => typeof dep === 'string' && dep !== ''))].sort()
      : null
    const declaredDeps = declared ?? previous?.declaredDeps ?? []
    const incoming = {
      status,
      owner: typeof payload?.owner === 'string' && payload.owner !== '' ? payload.owner : null,
      at: record.at ?? null,
      seq: record.seq,
    }
    const writers = new Set(previous?.writers ?? [])
    writers.add(String((record as { writer?: unknown }).writer ?? ''))
    if (previous === undefined) {
      state.latest.set(key, { key, id, team, claim: incoming, declaredDeps, records: 1, resolvedBy: 'seq', contested: false, writers })
      continue
    }
    const folded = foldClaim({ at: previous.claim.at, seq: previous.claim.seq }, { at: incoming.at, seq: incoming.seq })
    const winner = folded.incomingWins ? incoming : previous.claim
    const loser = folded.incomingWins ? previous.claim : incoming
    const disagrees = winner.status !== loser.status || winner.owner !== loser.owner
    state.latest.set(key, {
      key,
      id,
      team,
      claim: winner,
      declaredDeps,
      records: previous.records + 1,
      // The clocks decided, or the winning claim is the only one of the pair carrying a clock — in
      // which case the clock is the only evidence in play rather than an appeal to arrival order.
      resolvedBy: folded.byAt || (winner.at !== null && winner.at !== loser.at) ? 'at' : 'seq',
      contested: previous.contested || disagrees,
      writers,
    })
  }
}

function finishBoard(state: BoardFoldState): BoardState {
  const latest = state.latest
  const keys = [...latest.keys()].sort()
  const tasks: BoardTask[] = keys.map((key) => {
    const row = latest.get(key) as BoardFoldRow
    return {
      key,
      id: row.id,
      team: row.team,
      status: row.claim.status,
      owner: row.claim.owner,
      declaredDeps: [...row.declaredDeps],
      deps: row.declaredDeps.map((dep) => resolveDep(row.team, dep)),
      records: row.records,
      resolvedBy: row.resolvedBy,
      contested: row.contested,
      multiWriter: row.writers.size > 1,
    }
  })
  const statusOf = (key: string): string => (latest.get(key) as BoardFoldRow).claim.status
  const doneSet = new Set(keys.filter((key) => DONE_STATUSES.includes(statusOf(key))))
  const removedSet = new Set(keys.filter((key) => statusOf(key) === 'deleted'))
  const edges: Record<string, readonly string[]> = {}
  const blocked: Record<string, readonly string[]> = {}
  const missing: Record<string, readonly string[]> = {}
  const unreachable: Record<string, readonly string[]> = {}
  const orphans = new Set<string>()
  for (const task of tasks) {
    const deps = [...task.deps]
    edges[task.key] = deps
    const unmet = deps.filter((dep) => !doneSet.has(dep))
    if (unmet.length > 0) blocked[task.key] = unmet
    const absent = deps.filter((dep) => !latest.has(dep))
    if (absent.length > 0) {
      missing[task.key] = absent
      for (const dep of absent) orphans.add(dep)
    }
    const tombstones = deps.filter((dep) => removedSet.has(dep))
    if (tombstones.length > 0) unreachable[task.key] = tombstones
  }

  // Iterative depth-first search with per-node colour and a REAL path stack (see the fold's docs).
  const cycles: BoardCycle[] = []
  const seenLoops = new Set<string>()
  const color = new Map<string, 'white' | 'gray' | 'black'>(keys.map((key) => [key, 'white']))
  const depsOf = (key: string): readonly string[] => (doneSet.has(key) || removedSet.has(key) ? [] : (edges[key] ?? []))
  for (const root of keys) {
    if (color.get(root) !== 'white') continue
    color.set(root, 'gray')
    const stack: { key: string, at: number }[] = [{ key: root, at: 0 }]
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as { key: string, at: number }
      const deps = depsOf(frame.key)
      if (frame.at < deps.length) {
        const dep = deps[frame.at] as string
        frame.at += 1
        if (!latest.has(dep)) continue
        const seen = color.get(dep) ?? 'white'
        if (seen === 'gray') {
          const start = stack.findIndex((entry) => entry.key === dep)
          const loop = stack.slice(start).map((entry) => entry.key)
          const signature = [...loop].sort().join('|')
          if (!seenLoops.has(signature)) {
            seenLoops.add(signature)
            cycles.push({ edge: [frame.key, dep], loop: [...loop].sort() })
          }
        } else if (seen === 'white') {
          color.set(dep, 'gray')
          stack.push({ key: dep, at: 0 })
        }
      } else {
        color.set(frame.key, 'black')
        stack.pop()
      }
    }
  }
  const inCycle = new Set<string>()
  for (const cycle of cycles) for (const key of cycle.loop) inCycle.add(key)

  const ready = keys.filter((key) => !doneSet.has(key) && !removedSet.has(key) && !inCycle.has(key) && (blocked[key] ?? []).length === 0)

  return {
    tasks,
    edges,
    ready,
    blocked,
    missing,
    done: [...doneSet].sort(),
    cycles,
    orphans: [...orphans].sort(),
    removed: [...removedSet].sort(),
    unreachable,
    unknown: state.unknown,
  }
}

export function projectBoard(records: readonly ControlRecord[]): BoardState {
  const state = emptyBoardFold()
  foldBoard(state, records)
  return finishBoard(state)
}

/**
 * Every board row that carries one id, across every team, ordered by key.
 *
 * A caller that has an id and no team cannot build a {@link boardKey}, so it must be able to ask
 * which rows share that id rather than have the fold guess a team for it — guessing is how one
 * team's `d1` came to satisfy another team's dependency.
 * @param state - a folded state.
 * @param id - the id, as a writer named it.
 * @returns the matching rows, which may come from more than one team.
 */
export function boardTasksNamed(state: TeamState, id: string): readonly BoardTask[] {
  return state.board.tasks.filter((task) => task.id === id)
}

/* ------------------------------------------------------------------------------------------------
 * The frontier: what the ledger says may be started NOW.
 *
 * The board above answers "where does each task stand and what does it wait on" as a table. The
 * question a scheduler actually asks is one step on from that — not "what is blocked" but "what is
 * NOT blocked, what is holding the rest, and which blocker the ledger has never heard of". That is
 * a different reading of the same fold, so it is a pure function OF the fold rather than a second
 * fold: one set of rules, and no way for the frontier to disagree with the board it came from.
 * ---------------------------------------------------------------------------------------------- */

/** One member of the ready frontier: a task the ledger says may be started now. */
export interface ReadyTask {
  /** The task id, as the writer named it — or its {@link boardKey}, when the caller asked for keys. */
  readonly id: string
  /** The team the task belongs to, or null when no record named one. */
  readonly team: string | null
  /** The title the task's own latest row carried, or null when no row carried one. */
  readonly title: string | null
}

/** One task that cannot be started yet, and the tasks it is waiting on. */
export interface BlockedTask {
  /** The task id, as the writer named it — or its {@link boardKey}, when the caller asked for keys. */
  readonly id: string
  /**
   * The dependencies whose latest state is not done, sorted.
   *
   * A dependency the ledger never declares appears here too, and again in {@link ReadySet.unknown}:
   * "somebody must finish this" and "nobody ever declared this" are two facts about one edge, and a
   * caller that needs the second can read it without losing the first.
   */
  readonly waitingOn: readonly string[]
}

/** One task held back by a dependency no record declares. */
export interface UnknownTask {
  /** The task id, as the writer named it — or its {@link boardKey}, when the caller asked for keys. */
  readonly id: string
  /** The dependency ids no record declares, sorted. The task is not ready: absent is not done. */
  readonly missing: readonly string[]
}

/** The five answers {@link readySet} gives about one ledger. */
export interface ReadySet {
  /** Every task that may be started now: not done, on no cycle, and every dependency done. */
  readonly ready: readonly ReadyTask[]
  /** Every task that is not done and waits on a dependency that is not done, in board-key order. */
  readonly blocked: readonly BlockedTask[]
  /** The ids whose latest state row says done, sorted. */
  readonly done: readonly string[]
  /** Every task with at least one dependency no record declares, in board-key order. */
  readonly unknown: readonly UnknownTask[]
  /**
   * Every dependency cycle found, each named as the ids on it rather than left un-ready.
   *
   * The members are reported here AND in {@link ReadySet.blocked} (their own `waitingOn` names the
   * dependency that closes the loop), but never in {@link ReadySet.ready}. Naming the loop is what
   * separates "waiting for work that may yet finish" from "waiting forever", which is what a reader
   * saw before cycles were named.
   */
  readonly cycles: readonly (readonly string[])[]
}

/** Options for {@link readySet}. */
export interface ReadySetOptions {
  /**
   * Answer with board keys (`team` NUL `id`, see {@link boardKey}) instead of bare task ids.
   *
   * Off by default, because the question "what may I start" is asked in ids. A caller that already
   * holds a key — a lock row, a dispatch row, a claim verdict — asks for keys, and every id field in
   * the answer is then spelled the way the rest of the module spells it.
   * @default false
   */
  readonly asKeys?: boolean
}

/**
 * The records {@link readySet} accepts: the ledger's own rows, a page that carries them, or a fold.
 *
 * Three spellings of one input, because three readers already hold one of them and none of them
 * should have to re-read the log to ask a question the fold has answered: `rows` is what
 * {@link ControlRecord} arrays are, `records` is what a `records()` page calls the same array, and
 * `board` is what {@link projectTeamState} (or `records().state`) already folded. Nothing here is
 * read from disk, so a caller can hand over the page it was given.
 */
export interface ReadyRecordSource {
  /** A page's rows. */
  readonly rows?: readonly ControlRecord[]
  /** The same rows under the ledger's own name for them. */
  readonly records?: readonly ControlRecord[]
  /** A folded state, whose {@link BoardState} is then read directly. */
  readonly board?: BoardState
}

/** The id half of a board key, for a dependency that has no row to ask. */
function keyId(key: string): string {
  const at = key.lastIndexOf('\u0000')
  return at === -1 ? key : key.slice(at + 1)
}

/**
 * The title each task's own latest row carried.
 *
 * Read from the records rather than from the fold because the board keeps no title — the same reason
 * `lastTaskRow` reads the raw ledger for the revision a release has to continue. A row that carries
 * no title leaves the previous one alone, so a release row that forgot to repeat it cannot blank the
 * task's name, and the LAST row to carry one wins.
 * @param records - every record read from the log, in any order.
 * @returns board key to title.
 */
function latestTitles(records: readonly ControlRecord[]): Map<string, string> {
  const titles = new Map<string, string>()
  for (const record of orderedRecords(records)) {
    if (record.kind !== TASK_KIND) continue
    const payload = record.payload as { id?: unknown, title?: unknown } | undefined
    if (typeof payload?.title !== 'string' || payload.title === '') continue
    const id = typeof payload?.id === 'string' && payload.id !== '' ? payload.id : record.subject
    if (typeof id !== 'string' || id === '') continue
    titles.set(boardKey(teamOf(record), id), payload.title)
  }
  return titles
}

/**
 * Turn one folded board into the five answers.
 *
 * The rules live in {@link projectBoard} and are only REARRANGED here: `ready` and `done` are the
 * board's own, `blocked` is its unmet map, `unknown` is its missing map and `cycles` is its cycle
 * search. The two boundaries this function draws about that material are:
 *
 * - a task on a cycle is reported as a cycle as well as in `blocked` — the contract's definition of
 *   blocked is "at least one dependency is not done", and a loop member meets it — but it is never
 *   `ready`, so the loop is the named reason rather than a silent wait;
 * - a tombstone (`deleted`) is reported in none of the five: it is not done, it is not owed, and
 *   this answer has no sixth bucket for "finished with". The board's own `removed` is where a reader
 *   asks that question.
 * @param board - a folded board.
 * @param titleOf - the title for one board key, or null.
 * @param asKeys - whether to spell every id as a board key.
 * @returns the five answers, each in a deterministic order.
 */
function readySetOf(board: BoardState, titleOf: (key: string) => string | null, asKeys: boolean): ReadySet {
  const byKey = new Map<string, BoardTask>(board.tasks.map((task): [string, BoardTask] => [task.key, task]))
  // A key that has no row is a dependency nobody declared; its id is the half after the separator,
  // which is exactly the id the row would have carried had somebody declared it.
  const ref = (key: string): string => (asKeys ? key : (byKey.get(key)?.id ?? keyId(key)))
  const doneKeys = new Set(board.done)
  const removedKeys = new Set(board.removed)

  const ready: ReadyTask[] = []
  for (const key of board.ready) {
    const task = byKey.get(key)
    if (task === undefined) continue
    ready.push({ id: ref(key), team: task.team, title: titleOf(key) })
  }

  const blocked: BlockedTask[] = []
  const unknown: UnknownTask[] = []
  for (const task of board.tasks) {
    const missing = board.missing[task.key] ?? []
    if (missing.length > 0) unknown.push({ id: ref(task.key), missing: [...missing].map(ref).sort() })
    if (doneKeys.has(task.key) || removedKeys.has(task.key)) continue
    const unmet = board.blocked[task.key] ?? []
    if (unmet.length === 0) continue
    blocked.push({ id: ref(task.key), waitingOn: [...unmet].map(ref).sort() })
  }

  const done = [...new Set(board.done.map(ref))].sort()

  const seenLoops = new Set<string>()
  const cycles: string[][] = []
  for (const cycle of board.cycles) {
    const ids = [...new Set(cycle.loop.map(ref))].sort()
    const signature = ids.join('\u0000')
    if (seenLoops.has(signature)) continue
    seenLoops.add(signature)
    cycles.push(ids)
  }
  cycles.sort((left, right) => (left.join('\u0000') < right.join('\u0000') ? -1 : left.join('\u0000') > right.join('\u0000') ? 1 : 0))

  return { ready, blocked, done, unknown, cycles }
}

/**
 * What the ledger says may be started now, what is holding the rest, and what it has never heard of.
 *
 * This is the scheduler's question, answered from the records alone: `done` is the set whose LATEST
 * state row says done (the fold's own winning claim, so a later row that flips a task back to pending
 * is obeyed, not the first row that ever said completed); `ready` is every task that is not done,
 * on no cycle, and whose every declared dependency is done; `blocked` names the dependencies that
 * are not; `unknown` names the dependency ids no record declares, and such a task is never ready;
 * `cycles` names each loop instead of leaving its members un-ready for no stated reason. A task with
 * no `deps` at all is ready — "declares nothing" is not "declares something undeclared" — and an
 * EMPTY `deps` array clears an earlier graph, so a task whose latest row carries `deps: []` is ready
 * again.
 *
 * **It is pure.** It reads no clock, no file, no environment and no clock-bearing option: identical
 * input answers identically, in the same order, and it does not mutate the records it is given. The
 * one switch that can change a key spelling is this module's own fault-injection arm
 * (`DSH_LINK_COLLAB_ATTACKS`), which must be explicitly armed and is not read here.
 * @param records - the ledger's records, a page that carries them, or a fold that already holds the board.
 * @param options - how to spell the ids.
 * @returns the five answers.
 */
export function readySet(records: readonly ControlRecord[] | ReadyRecordSource, options: ReadySetOptions = {}): ReadySet {
  const asKeys = options !== null && typeof options === 'object' && options.asKeys === true
  if (Array.isArray(records)) {
    const titles = latestTitles(records)
    return readySetOf(projectBoard(records), (key) => titles.get(key) ?? null, asKeys)
  }
  if (records !== null && typeof records === 'object') {
    const source = records as ReadyRecordSource
    const rows = Array.isArray(source.rows) ? source.rows : Array.isArray(source.records) ? source.records : null
    if (rows !== null) {
      const titles = latestTitles(rows)
      return readySetOf(projectBoard(rows), (key) => titles.get(key) ?? null, asKeys)
    }
    const board = source.board
    if (board !== null && board !== undefined && Array.isArray(board.tasks)) {
      return readySetOf(board, () => null, asKeys)
    }
  }
  throw new TypeError('readySet: records must be the ledger\'s records (an array, a records() page, or a folded state)')
}

/** Why a task can or cannot be claimed. */
export type ClaimReason = 'ready' | 'blocked' | 'done' | 'locked' | 'unknown' | 'cycle' | 'removed' | 'unreachable'

/** One claim verdict, with everything it was decided from. */
export interface ClaimVerdict {
  /** Whether the claim may proceed. True only for `ready`. */
  readonly ok: boolean
  /** Why. */
  readonly reason: ClaimReason
  /**
   * The holder of a live lock on this key, whatever the reason is, else null.
   *
   * Orthogonal to `reason` on purpose: a lock is a fact about the task, and a task that is done,
   * blocked or on a cycle can still be held. Reporting the holder only for `locked` is what made a
   * live lock invisible in four of the eight answers.
   */
  readonly holder: string | null
  /**
   * The dependencies that are not done, as board keys, when blocked/on a cycle/unreachable, else
   * empty. Keys rather than ids, so the caller can ask about them directly instead of guessing a
   * team — which is how one team's dependency came to satisfy another's.
   */
  readonly blockers: readonly string[]
  /**
   * The holder whose lock this verdict overruled, or null when none was.
   *
   * **Always present.** "This verdict ignored nobody's lock" is a definite answer, not a missing one,
   * so it is `null` rather than an absent key: a field whose type says `string | null` must not be
   * `undefined` at run time, or every reader has to ask which of the two it is looking at. Without
   * `timeoutMs` nothing about liveness is read and this is always `null` — the readings that existed
   * before this option are byte-for-byte what they were, and this is the one key added beside them.
   * `holder` alone cannot answer it: `holder` says whose lock is on the task, `reclaimedFrom` says
   * whether this verdict was allowed to ignore it.
   */
  readonly reclaimedFrom: string | null
}

/**
 * Why a task may or may not be claimed, with the lock left out.
 *
 * One implementation of the precedence, shared by {@link claimable} and {@link reclaimable}: a
 * reclaimer has to know what the answer would be *without* the lock, or it cannot tell "the lock is
 * all that stands in the way" from "there is nothing to hand out even if the lock goes".
 * @param state - a folded state.
 * @param key - the {@link boardKey} of the task.
 * @returns the reason and the dependencies that stand in the way.
 */
function claimReasonOf(state: TeamState, key: string): { reason: ClaimReason, blockers: readonly string[] } {
  const board = state.board
  const row = board.tasks.find((entry) => entry.key === key)
  if (row === undefined) return { reason: 'unknown', blockers: [] }
  if (row.status === 'deleted') return { reason: 'removed', blockers: [] }
  if (DONE_STATUSES.includes(row.status)) return { reason: 'done', blockers: [] }
  if ((board.unreachable[key] ?? []).length > 0) return { reason: 'unreachable', blockers: board.blocked[key] ?? [] }
  const onCycle = board.cycles.some((cycle) => cycle.loop.includes(key))
  if (onCycle) return { reason: 'cycle', blockers: board.blocked[key] ?? [] }
  const unmet = board.blocked[key] ?? []
  if (unmet.length > 0) return { reason: 'blocked', blockers: unmet }
  return { reason: 'ready', blockers: [] }
}

/**
 * Decide whether a task may be claimed right now.
 *
 * The precedence is fixed and total: unknown, removed, done, unreachable, cycle, blocked, locked,
 * ready. `ok` is true only for `ready`, so no other reason can quietly pass for permission. The two
 * tombstone reasons come before the others because they are the answers a reader cannot recover
 * from: a task whose own status is `deleted` is finished with, and a dependency that is `deleted`
 * will never complete, so neither can be reported as merely unfinished. An expired lock is not a
 * lock, which is what makes "claim after the holder went quiet" work.
 *
 * Passing `timeoutMs` adds one more way a lock can stop being a lock: a **live** lock whose holder
 * is quarantined — it beat and has been silent past the threshold — may be overruled, and the verdict
 * then says `ready` with `reclaimedFrom` naming the dead holder while `holder` still reports whose
 * lock is on the task. Silence alone is not death: a member that never beat is `unknown`, not
 * `unhealthy`, and its lock stays a lock. Without this option nothing about liveness is read, every
 * reading that existed before is byte-for-byte unchanged, and `reclaimedFrom` is `null` — a reclaimer
 * that hands work out while this answers `locked` has two readings that contradict each other, which
 * is what R40 exists to remove.
 * @param state - a folded state.
 * @param key - the {@link boardKey} of the task to claim.
 * @param now - the instant, in milliseconds.
 * @param options - the lock's time to live, and optionally the liveness threshold.
 * @returns the verdict.
 */
export function claimable(state: TeamState, key: string, now: number, options: { ttlMs: number, timeoutMs?: number }): ClaimVerdict {
  const holder = lockHolder(state, key, now, options).holder
  const blind = claimReasonOf(state, key)
  const dead = options.timeoutMs === undefined || holder === null || !isQuarantined(state, holder, now, { timeoutMs: options.timeoutMs })
    ? null
    : holder
  // One place decides the shape. `reclaimedFrom` is what this verdict actually overruled, so it is
  // null on every branch that did not get past the lock — a blocked task whose holder happens to be
  // dead was not reclaimed, it was refused for the dependency — and it is always there, because
  // "nothing was overruled" is an answer rather than an absence.
  const verdict = (ok: boolean, reason: ClaimReason, blockers: readonly string[], reclaimed: string | null): ClaimVerdict => ({
    ok,
    reason,
    holder,
    blockers,
    reclaimedFrom: reclaimed,
  })
  if (blind.reason !== 'ready') return verdict(false, blind.reason, blind.blockers, null)
  if (holder !== null && dead === null) return verdict(false, 'locked', [], null)
  return verdict(true, 'ready', [], dead)
}

/**
 * Whether one task's lock can be taken away from whoever holds it, right now.
 *
 * The one judgement about reclaiming a lock, called by {@link reclaimable} and by
 * {@link recoverable}: an expired lock is nobody's, and a live lock whose holder is quarantined may
 * be overruled because that holder is not coming back. Both are needed, and needed in the same shape,
 * or the two readings answer the same question differently — "a lock is not in the way" and "this
 * lock can be taken" have to be the same predicate wherever a caller meets them.
 *
 * A task nobody ever locked is **not** reclaimable: it is simply claimable, and calling that
 * reclaimable sends a reclaimer looking for a lock that is not there.
 * @param state - a folded state.
 * @param key - the {@link boardKey} of the task.
 * @param now - the instant, in milliseconds.
 * @param options - the lock's time to live and the liveness threshold.
 * @returns whether the lock can be taken.
 */
function lockReclaimable(state: TeamState, key: string, now: number, options: ReclaimOptions): boolean {
  const lock = lockHolder(state, key, now, { ttlMs: options.ttlMs })
  const lastHolder = state.locks.find((entry) => entry.key === key)?.holder ?? null
  return (lock.expired && lastHolder !== null)
    || (lock.holder !== null && isQuarantined(state, lock.holder, now, { timeoutMs: options.timeoutMs }))
}

/** How long a member may go without a beat, and how long a lock may live. */
export interface ReclaimOptions {
  /** The lock's time to live, as {@link lockHolder} reads it. */
  readonly ttlMs: number
  /** How long a member may go without a beat before it is quarantined. */
  readonly timeoutMs: number
}

/**
 * What one task's lock means to a reclaimer at one instant.
 *
 * Every field is a reading of its own, because the decision has more than one cause: a lock can be
 * gone because it expired, or because the holder died, or because there never was one — and a task
 * whose lock could be taken away may still be impossible to hand out.
 */
export interface ReclaimReading {
  /** The {@link boardKey} asked about. */
  readonly key: string
  /** The live lock's holder, by {@link lockHolder}'s reading: null when released or expired. */
  readonly holder: string | null
  /**
   * The last holder the lock table records, reported **even when the lock has expired**.
   *
   * Null means no lock was ever taken (or the last record released it): there is nothing to reclaim,
   * which is a different answer from "there is a lock and its holder is gone".
   */
  readonly lastHolder: string | null
  /** Whether that live holder is quarantined: it beat, and it has been silent past the threshold. */
  readonly holderUnhealthy: boolean
  /** Whether the lock is past its time to live. */
  readonly expired: boolean
  /**
   * Why the task could be claimed **with the lock left out of the question**.
   *
   * So a reader can tell "the lock is all that stands in the way" from "there is nothing to hand out
   * even if the lock goes": when this is not `ready`, taking the lock away buys nothing.
   */
  readonly reason: ClaimReason
  /**
   * Whether reclaiming buys something: the task would be claimable without the lock, **and** there is
   * a lock to take away — either an expired one, or a live one whose holder is quarantined.
   *
   * A task nobody ever locked is not reclaimable: it is simply claimable, and calling that
   * "reclaimable" would send a reclaimer looking for a lock that is not there.
   */
  readonly reclaimable: boolean
}

/**
 * Decide what one task's lock is worth to a reclaimer, without touching the ledger.
 *
 * This is the reading that removes the contradiction R40 was raised for: {@link recoverable} hands
 * out a task whose holder stopped answering while {@link claimable} answered `locked` — the lock of
 * the very member that was being replaced. Here the two facts are separated instead of averaged: who
 * holds the lock, whether that holder is dead, and whether there is anything to hand out once the
 * lock is gone.
 *
 * Only `unhealthy` counts as dead. A member that never beat reads `unknown`, and silence is not
 * death: reclaiming from it would move work away from a member that has simply not started talking.
 * @param state - a folded state.
 * @param key - the {@link boardKey} of the task.
 * @param now - the instant, in milliseconds.
 * @param options - the lock's time to live and the liveness threshold.
 * @returns the reading.
 */
export function reclaimable(state: TeamState, key: string, now: number, options: ReclaimOptions): ReclaimReading {
  const lock = lockHolder(state, key, now, { ttlMs: options.ttlMs })
  const lastHolder = state.locks.find((entry) => entry.key === key)?.holder ?? null
  const holder = lock.holder
  const holderUnhealthy = holder !== null && isQuarantined(state, holder, now, { timeoutMs: options.timeoutMs })
  const blind = claimReasonOf(state, key)
  return {
    key,
    holder,
    lastHolder,
    holderUnhealthy,
    expired: lock.expired,
    reason: blind.reason,
    reclaimable: blind.reason === 'ready' && lockReclaimable(state, key, now, options),
  }
}

/** One ordered handshake pair. */
export interface PeerPair {
  /** Asking lead. */
  readonly from: string
  /** Answering lead. */
  readonly to: string
  /** What was asked for; carried so an answer can be read without the request row. */
  readonly request: string
  /** `requested` until answered, then `granted` or `denied`. */
  readonly state: 'requested' | 'granted' | 'denied'
  /** Sequence of the record this row came from. */
  readonly seq: number
}

/** The handshake table the fold produces. */
export interface PeerState {
  /** One row per ordered pair, ordered by (from, to). */
  readonly pairs: readonly PeerPair[]
}

/**
 * The record kind that carries a handshake.
 *
 * Order matters and is part of the key: `t1 -> t2` granted says nothing about `t2 -> t1`. The
 * permission is a ledger state rather than a question asked of the other lead at call time, because
 * a per-call question has no answer when the asking side is the one that is unhealthy, and it cannot
 * be audited after the fact.
 */
export const PEER_KIND = 'peer/state'

/**
 * Build a handshake record.
 * @param from - the asking lead.
 * @param to - the answering lead.
 * @param request - what is being asked for.
 * @param state - `requested`, `granted` or `denied`.
 * @returns the record to append, without a sequence.
 */
export function peerRecord(from: string, to: string, request: string, state: 'requested' | 'granted' | 'denied'): { kind: string, subject: string, payload: Record<string, unknown> } {
  if (typeof from !== 'string' || from === '') throw new TypeError('peerRecord: from must be a non-empty string')
  if (typeof to !== 'string' || to === '') throw new TypeError('peerRecord: to must be a non-empty string')
  if (typeof request !== 'string' || request === '') throw new TypeError('peerRecord: request must be a non-empty string')
  if (state !== 'requested' && state !== 'granted' && state !== 'denied') throw new TypeError('peerRecord: state must be requested, granted or denied')
  return { kind: PEER_KIND, subject: from + '->' + to, payload: { from, to, request, state } }
}

/**
 * Fold handshakes into one row per ordered pair.
 *
 * By `seq`, like every other fold here: the highest sequence for a pair wins, so a later
 * `denied` clears an earlier `granted` and the same records arranged differently give the same
 * table. The pair is ordered, so no direction is folded onto its reverse.
 * @param records - every record read from the log, in any order.
 * @returns one row per ordered pair, ordered by (from, to).
 */
/** The mutable state of {@link projectPeers}: the winning row per ordered pair, folded so far. */
interface PeersFoldState {
  latest: Map<string, PeerPair>
}

function emptyPeersFold(): PeersFoldState {
  return { latest: new Map() }
}

function foldPeers(state: PeersFoldState, records: readonly ControlRecord[]): void {
  for (const record of orderedRecords(records)) {
    if (record.kind !== PEER_KIND) continue
    const payload = record.payload as { from?: unknown, to?: unknown, request?: unknown, state?: unknown } | undefined
    const from = typeof payload?.from === 'string' ? payload.from : ''
    const to = typeof payload?.to === 'string' ? payload.to : ''
    const stateOfPair = payload?.state
    if (from === '' || to === '') continue
    if (stateOfPair !== 'requested' && stateOfPair !== 'granted' && stateOfPair !== 'denied') continue
    const request = typeof payload?.request === 'string' ? payload.request : ''
    state.latest.set(from + '->' + to, { from, to, request, state: stateOfPair, seq: record.seq })
  }
}

function finishPeers(state: PeersFoldState): PeerState {
  return {
    pairs: [...state.latest.values()].sort((left, right) => {
      if (left.from !== right.from) return left.from < right.from ? -1 : 1
      return left.to < right.to ? -1 : left.to > right.to ? 1 : 0
    }),
  }
}

export function projectPeers(records: readonly ControlRecord[]): PeerState {
  const state = emptyPeersFold()
  foldPeers(state, records)
  return finishPeers(state)
}

/**
 * Whether one lead may exchange with another. Only a granted pair allows it, in that direction.
 * @param state - a folded state.
 * @param from - the asking lead.
 * @param to - the answering lead.
 * @returns true only when that ordered pair is granted.
 */
export function mayExchange(state: TeamState, from: string, to: string): boolean {
  return state.peers.pairs.find((pair) => pair.from === from && pair.to === to)?.state === 'granted'
}

/**
 * The requests still waiting on one lead, ordered by asking lead.
 * @param state - a folded state.
 * @param to - the lead that has not answered.
 * @returns one row per unanswered request.
 */
export function pendingRequests(state: TeamState, to: string): readonly PeerPair[] {
  return state.peers.pairs.filter((pair) => pair.to === to && pair.state === 'requested').sort((left, right) => (left.from < right.from ? -1 : left.from > right.from ? 1 : 0))
}

/** One team in the tree. */
export interface TeamNode {
  /** Team id. */
  readonly id: string
  /** Parent team id, or null for a root. */
  readonly parent: string | null
  /** That team's own lead, when declared. */
  readonly lead: string | null
  /** Sequence of the declaration this row came from. */
  readonly seq: number
  /** True when more than one declaration claimed this team's parent. */
  readonly contested: boolean
  /** The losing parent claims, newest first, so a contested tree stays visible instead of being flattened. */
  readonly losers: readonly TeamParentClaim[]
}

/** One losing parent claim on a contested team, kept for audit. */
export interface TeamParentClaim {
  /** The parent that lost. */
  readonly parent: string | null
  /** Arrival time of the losing declaration. */
  readonly at: number
  /** Sequence of the losing declaration. */
  readonly seq: number
}

/** One edge that closes a cycle, and the loop it closes. */
export interface TeamCycle {
  /** The parent-to-child edge that would close the loop, as declared. */
  readonly edge: readonly [string, string]
  /** The teams in the loop. */
  readonly loop: readonly string[]
}

/** The team tree the fold produces. */
export interface TeamTreeState {
  /** Every declared team, ordered by id. */
  readonly teams: readonly TeamNode[]
  /** Children by parent, each list sorted. */
  readonly children: Readonly<Record<string, readonly string[]>>
  /** Teams whose parent is null. */
  readonly roots: readonly string[]
  /** Teams whose declared parent was never declared. Visible rather than dropped. */
  readonly orphans: readonly string[]
  /** Cycles found. A cycle is reported, never walked into. */
  readonly cycles: readonly TeamCycle[]
}

/**
 * The record kind that carries a team declaration.
 *
 * A sub-team is a team whose parent is declared, not a runtime object nested inside another: the
 * tree is a shape of the ledger, so it survives a restart and can be read by a member that never
 * held the parent in memory.
 */
export const TEAM_KIND = 'team/state'

/**
 * The kind this layer writes for a message whose flow it recorded.
 *
 * R235: it wrote `team.message` and then did not list it among the kinds it reads, so a live DRSS run with
 * 48 records reported `unknown: 11` - the bus calling its OWN message records unreadable. The count is a
 * statement about the reader, and a reader that cannot read what it just wrote is wrong about itself.
 */
export const MESSAGE_KIND = 'team.message'

/**
 * R98 (P43 contract, rule 2): arbitrate the parent of one team subject across all of its records.
 *
 * The ledger keeps every record, so one subject can arrive with two different parents. The winner is a
 * rule, not arrival order: more specific wins (a named parent beats null), and with equal specificity
 * the earlier record wins (by at, then seq). Losers are returned instead of dropped, because a fold that
 * only shows the winner hides that the tree was contested.
 * @param rows - one row per team/state record, in arrival order, mapped to plain values
 * @returns the winning parent per subject plus every losing fact, for callers that must show contention
 */
/** The mutable state of {@link arbitrateTeamParents}: what each subject currently declares. */
interface TeamParentArbitrationState {
  parents: Map<string, string | null>
  seen: Map<string, { parent: string | null, at: number, seq: number }>
  contested: { subject: string, winner: string | null, loser: string | null, at: number, seq: number }[]
}

function emptyTeamParentArbitration(): TeamParentArbitrationState {
  return { parents: new Map(), seen: new Map(), contested: [] }
}

/** Apply one declaration to the arbitration state, in arrival (sequence) order. */
function stepTeamParentArbitration(state: TeamParentArbitrationState, row: { subject: string, parent: string | null, at: number, seq: number }): void {
  const current = state.seen.get(row.subject)
  if (current === undefined) {
    state.seen.set(row.subject, { parent: row.parent, at: row.at, seq: row.seq })
    state.parents.set(row.subject, row.parent)
    return
  }
  if (current.parent === row.parent) return
  const candidateMoreSpecific = row.parent !== null && current.parent === null
  const equalSpecificityEarlier = (row.parent === null) === (current.parent === null) && (row.at < current.at || (row.at === current.at && row.seq < current.seq))
  if (candidateMoreSpecific || equalSpecificityEarlier) {
    state.contested.push({ subject: row.subject, winner: row.parent, loser: current.parent, at: row.at, seq: row.seq })
    state.seen.set(row.subject, { parent: row.parent, at: row.at, seq: row.seq })
    state.parents.set(row.subject, row.parent)
    return
  }
  state.contested.push({ subject: row.subject, winner: current.parent, loser: row.parent, at: row.at, seq: row.seq })
}

export function arbitrateTeamParents(rows: readonly { subject: string; parent: string | null; at: number; seq: number }[]): { parents: Map<string, string | null>; contested: readonly { subject: string; winner: string | null; loser: string | null; at: number; seq: number }[] } {
  const state = emptyTeamParentArbitration()
  for (const row of rows) stepTeamParentArbitration(state, row)
  return { parents: state.parents, contested: state.contested }
}

/**
 * Build a team declaration.
 * @param team - the team id.
 * @param parent - its parent team id, or null for a root.
 * @param lead - that team's lead, when it has one.
 * @returns the record to append, without a sequence.
 */
export function teamRecord(team: string, parent: string | null, lead?: string): { kind: string, subject: string, payload: Record<string, unknown> } {
  if (typeof team !== 'string' || team === '') throw new TypeError('teamRecord: team must be a non-empty string')
  if (parent !== null && (typeof parent !== 'string' || parent === '')) throw new TypeError('teamRecord: parent must be null or a non-empty string')
  return { kind: TEAM_KIND, subject: team, payload: { team, parent, ...(lead === undefined ? {} : { lead }) } }
}

/**
 * Fold team declarations into a tree.
 *
 * Last declaration per team wins, by sequence. Cycles are found by walking each team up towards a
 * root with a visited set, so a loop is reported as an edge rather than followed: recursion would
 * either hang or need a depth limit, and a depth limit would silently truncate a legitimate deep
 * tree (acceptance D builds one 200 levels down).
 * @param records - every record read from the log, in any order.
 * @returns the tree, its roots, its orphans, and every cycle found.
 */
/** The mutable state of {@link projectTeams}: the last declaration per team, folded so far. */
interface TeamsFoldState {
  latest: Map<string, TeamNode>
  arbitration: TeamParentArbitrationState
}

function emptyTeamsFold(): TeamsFoldState {
  return { latest: new Map(), arbitration: emptyTeamParentArbitration() }
}

function foldTeams(state: TeamsFoldState, records: readonly ControlRecord[]): void {
  for (const record of orderedRecords(records)) {
    if (record.kind !== TEAM_KIND) continue
    const payload = record.payload as { team?: unknown, parent?: unknown, lead?: unknown } | undefined
    const id = typeof payload?.team === 'string' && payload.team !== '' ? payload.team : record.subject
    if (typeof id !== 'string' || id === '') continue
    const parent = payload?.parent === null || payload?.parent === undefined
      ? null
      : (typeof payload.parent === 'string' && payload.parent !== '' ? payload.parent : null)
    const lead = typeof payload?.lead === 'string' && payload.lead !== '' ? payload.lead : null
    const declaration = { subject: id, parent, at: typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : 0, seq: record.seq }
    stepTeamParentArbitration(state.arbitration, declaration)
    state.latest.set(id, { id, parent, lead, seq: record.seq })
  }
}

function finishTeams(state: TeamsFoldState): TeamTreeState {
  const arbitrated = { parents: state.arbitration.parents, contested: state.arbitration.contested }
  const latest = new Map(state.latest)
  const lost = new Map<string, { parent: string | null, at: number, seq: number }[]>()
  for (const claim of arbitrated.contested) {
    lost.set(claim.subject, [...(lost.get(claim.subject) ?? []), { parent: claim.loser, at: claim.at, seq: claim.seq }])
  }
  for (const [id, node] of [...latest.entries()]) {
    const losers = (lost.get(id) ?? []).sort((left, right) => right.seq - left.seq)
    latest.set(id, {
      ...node,
      parent: arbitrated.parents.has(id) ? (arbitrated.parents.get(id) ?? null) : node.parent,
      contested: losers.length > 0,
      losers,
    })
  }

  const teams = [...latest.values()].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  const children: Record<string, string[]> = {}
  for (const team of teams) {
    if (team.parent === null) continue
    children[team.parent] = [...(children[team.parent] ?? []), team.id]
  }
  for (const key of Object.keys(children)) children[key].sort()

  const roots = teams.filter((team) => team.parent === null).map((team) => team.id)
  const orphans = teams.filter((team) => team.parent !== null && !latest.has(team.parent)).map((team) => team.id)

  const cycles: TeamCycle[] = []
  const seen = new Set<string>()
  for (const team of teams) {
    const walked: string[] = [team.id]
    const onPath = new Set<string>([team.id])
    let cursor = team.parent
    while (cursor !== null) {
      if (onPath.has(cursor)) {
        const loop = walked.slice(walked.indexOf(cursor))
        const key = [...loop].sort().join('|')
        if (!seen.has(key)) {
          seen.add(key)
          cycles.push({ edge: [walked[walked.length - 1], cursor], loop: [...loop] })
        }
        break
      }
      walked.push(cursor)
      onPath.add(cursor)
      cursor = latest.get(cursor)?.parent ?? null
    }
  }

  return { teams, children, roots, orphans, cycles }
}

export function projectTeams(records: readonly ControlRecord[]): TeamTreeState {
  const state = emptyTeamsFold()
  foldTeams(state, records)
  return finishTeams(state)
}

/** The path from a root down to and including one team. Stops at a cycle instead of looping. */
function walkUp(state: TeamTreeState, teamId: string): string[] {
  const by = new Map(state.teams.map((team) => [team.id, team]))
  if (!by.has(teamId)) return []
  const path = [teamId]
  const onPath = new Set([teamId])
  let cursor = by.get(teamId)?.parent ?? null
  while (cursor !== null && by.has(cursor)) {
    if (onPath.has(cursor)) break
    path.push(cursor)
    onPath.add(cursor)
    cursor = by.get(cursor)?.parent ?? null
  }
  return path.reverse()
}

/**
 * A team's ancestors, root first.
 * @param state - a folded state.
 * @param teamId - the team to look up.
 * @returns ancestor ids from the root down, excluding the team itself; empty for a root or an unknown team.
 */
export function ancestorsOf(state: TeamState, teamId: string): readonly string[] {
  const path = walkUp(state.teams, teamId)
  return path.slice(0, Math.max(0, path.length - 1))
}

/**
 * A team's own path, root first and including itself.
 * @param state - a folded state.
 * @param teamId - the team to look up.
 * @returns the path; `[teamId]` for a root; empty for an unknown team.
 */
export function pathOf(state: TeamState, teamId: string): readonly string[] {
  return walkUp(state.teams, teamId)
}

/**
 * Every team below one team, nearest first.
 * @param state - a folded state.
 * @param teamId - the team to look up.
 * @returns descendant ids, excluding the team itself; a cycle is not entered.
 */
export function descendantsOf(state: TeamState, teamId: string): readonly string[] {
  const out: string[] = []
  const queue = [...(state.teams.children[teamId] ?? [])]
  const seen = new Set<string>([teamId])
  while (queue.length > 0) {
    const next = queue.shift() as string
    if (seen.has(next)) continue
    seen.add(next)
    out.push(next)
    queue.push(...(state.teams.children[next] ?? []))
  }
  return out
}

/** Every root team, ordered by id. */
export function rootsOf(state: TeamState): readonly string[] {
  return state.teams.roots
}

/** One member's declared capabilities. */
export interface RegistryMember {
  /** Member id as declared. */
  readonly id: string
  /** Capability names, deduplicated and sorted, as of that member's last declaration. */
  readonly capabilities: readonly string[]
  /** Sequence of the declaration this row came from. */
  readonly seq: number
}

/** The capability registry the fold produces. */
export interface RegistryState {
  /** One row per declaring member, ordered by member id so a reader is not reading arrival order. */
  readonly members: readonly RegistryMember[]
  /**
   * Capability name to the member ids that declared it, both sorted.
   *
   * Stated as a plain record rather than a Map so the state stays lossless JSON, which is what a
   * caller that logs or compares a fold needs.
   */
  readonly byCapability: Readonly<Record<string, readonly string[]>>
  /** How many declarations were folded. */
  readonly declarations: number
  /** Declarations that carried no usable payload and were therefore ignored. */
  readonly malformed: number
}

/** The record kind that carries a task's state. */
const TASK_KIND = 'task/state'
/** The record kind that carries a member's state. */
const MEMBER_KIND = 'member/state'

/**
 * The record kind that carries a capability declaration.
 *
 * A member writes one of these to say what it can do; nothing else produces it, which is the point
 * — the registry is a ledger fact rather than a mapping of some kernel concept.
 */
export const CAPABILITY_KIND = 'capability/state'

/**
 * Build the record a member appends to declare its capabilities.
 *
 * Sorted and deduplicated here, so the ledger row itself is canonical: two writers declaring the
 * same set produce the same bytes, and a reader comparing rows does not see writer order as a
 * difference.
 * @param memberId - the declaring member.
 * @param capabilities - the capability names it offers.
 * @returns the record to append, without a sequence.
 */
export function capabilityRecord(memberId: string, capabilities: readonly string[]): { kind: string, subject: string, payload: { id: string, capabilities: string[] } } {
  if (typeof memberId !== 'string' || memberId === '') throw new TypeError('capabilityRecord: memberId must be a non-empty string')
  const unique = [...new Set(capabilities.filter((name) => typeof name === 'string' && name !== ''))].sort()
  return { kind: CAPABILITY_KIND, subject: memberId, payload: { id: memberId, capabilities: unique } }
}

/**
 * Read one capability declaration, or null when the record does not carry a usable one.
 *
 * Two shapes are accepted, because both are how a member can say it: a **full declaration** in
 * `payload.capabilities` (the member's set, replacing whatever it said before) and an
 * **incremental declaration** in `payload.capability` (one row per capability, as a producer
 * naturally writes them one at a time). A reader that accepted only one of them would report an
 * empty registry for a member that had declared, which is the silent-emptiness failure this
 * project keeps finding — so both are read, and `replace` travels with the row to say which it is.
 * @param record - the record to read.
 * @returns the declaring member, the names, and whether they replace or extend its set.
 */
function declarationOf(record: ControlRecord): { id: string, capabilities: string[], replace: boolean } | null {
  if (record.kind !== CAPABILITY_KIND) return null
  const payload = record.payload as { id?: unknown, capabilities?: unknown, capability?: unknown } | undefined
  const id = payload?.id ?? record.subject
  if (typeof id !== 'string' || id === '') return null
  const named = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
  if (Array.isArray(payload?.capabilities)) {
    const listed = payload.capabilities.filter((name): name is string => named(name) !== null)
    return { id, capabilities: [...new Set(listed)], replace: true }
  }
  const single = named(payload?.capability)
  if (single !== null) return { id, capabilities: [single], replace: false }
  return null
}

/**
 * Fold capability declarations into the registry.
 *
 * The fold is by **sequence, not arrival**: records are ordered by `seq` before folding, so the
 * same set of declarations produces the same registry however the lines happen to be arranged, and
 * a member that declares twice ends up with the declaration whose `seq` is highest. Order
 * independence is the property a caller relies on when it compares two folds or replays a log that
 * was spliced differently.
 * @param records - every record read from the log, in any order.
 * @returns the registry: last declaration per member, capability to members, and how many
 * declarations were folded or ignored.
 */
/** The mutable state of {@link projectRegistry}: the last declaration per member, folded so far. */
interface RegistryFoldState {
  latest: Map<string, { capabilities: string[], seq: number }>
  declarations: number
  malformed: number
}

function emptyRegistryFold(): RegistryFoldState {
  return { latest: new Map(), declarations: 0, malformed: 0 }
}

/** Step the registry fold. Sequence order is what decides a member's last declaration. */
function foldRegistry(state: RegistryFoldState, records: readonly ControlRecord[]): void {
  for (const record of orderedRecords(records)) {
    if (record.kind !== CAPABILITY_KIND) continue
    const declaration = declarationOf(record)
    if (declaration === null) {
      state.malformed += 1
      continue
    }
    state.declarations += 1
    const previous = state.latest.get(declaration.id)
    const merged = declaration.replace
      ? declaration.capabilities
      : [...new Set([...(previous?.capabilities ?? []), ...declaration.capabilities])]
    state.latest.set(declaration.id, { capabilities: merged, seq: record.seq })
  }
}

function finishRegistry(state: RegistryFoldState): RegistryState {
  const members: RegistryMember[] = [...state.latest.entries()]
    .map(([id, entry]) => ({ id, capabilities: [...entry.capabilities].sort(), seq: entry.seq }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))

  const byCapability: Record<string, string[]> = {}
  for (const member of members) {
    for (const capability of member.capabilities) {
      byCapability[capability] = [...(byCapability[capability] ?? []), member.id]
    }
  }
  for (const capability of Object.keys(byCapability)) byCapability[capability].sort()

  const registry: RegistryState = { members, byCapability, declarations: state.declarations, malformed: state.malformed }
  Object.defineProperties(registry, {
    membersWith: {
      value: (capability: string): readonly string[] => registry.byCapability[capability] ?? [],
      enumerable: false,
    },
    capabilitiesOf: {
      value: (memberId: string): readonly string[] => registry.members.find((member) => member.id === memberId)?.capabilities ?? [],
      enumerable: false,
    },
  })
  return registry
}

export function projectRegistry(records: readonly ControlRecord[]): RegistryState {
  const state = emptyRegistryFold()
  foldRegistry(state, records)
  return finishRegistry(state)
}

/**
 * The members that declared one capability.
 * @param state - a folded state.
 * @param capability - the capability name to look up.
 * @returns member ids, sorted; an empty list when nobody declared it or the name is unknown.
 */
export function membersWith(state: TeamState, capability: string): readonly string[] {
  return state.registry.byCapability[capability] ?? []
}

/**
 * The capabilities one member declared.
 * @param state - a folded state.
 * @param memberId - the member to look up.
 * @returns capability names, sorted; an empty list when the member never declared or is unknown.
 */
export function capabilitiesOf(state: TeamState, memberId: string): readonly string[] {
  return state.registry.members.find((member) => member.id === memberId)?.capabilities ?? []
}

/**
 * Fold the capability each task demands, when its record names one.
 * @param records - every record read from the log, in any order.
 * @returns task id to demanded capability.
 */
/** The mutable state of {@link projectTaskDemands}. */
interface TaskDemandsFoldState {
  demands: Record<string, string>
}

function emptyTaskDemandsFold(): TaskDemandsFoldState {
  return { demands: {} }
}

function foldTaskDemands(state: TaskDemandsFoldState, records: readonly ControlRecord[]): void {
  for (const record of orderedRecords(records)) {
    if (record.kind !== TASK_KIND) continue
    const payload = record.payload as { id?: unknown, capability?: unknown } | undefined
    const id = payload?.id ?? record.subject
    if (typeof id !== 'string' || id === '') continue
    if (typeof payload?.capability === 'string' && payload.capability !== '') state.demands[id] = payload.capability
  }
}

function finishTaskDemands(state: TaskDemandsFoldState): Record<string, string> {
  return { ...state.demands }
}

export function projectTaskDemands(records: readonly ControlRecord[]): Record<string, string> {
  const state = emptyTaskDemandsFold()
  foldTaskDemands(state, records)
  return finishTaskDemands(state)
}

/** The record kind that carries a heartbeat. Written by this layer: no kernel Team event beats. */
export const HEARTBEAT_KIND = 'member/heartbeat'

/**
 * Build the record a member appends to say it is alive.
 * @param memberId - the beating member.
 * @param at - the instant it beat, in milliseconds. Passed in, never read from a clock here.
 * @returns the record to append, without a sequence.
 */
export function heartbeatRecord(memberId: string, at: number): { kind: string, subject: string, payload: { id: string, at: number } } {
  if (typeof memberId !== 'string' || memberId === '') throw new TypeError('heartbeatRecord: memberId must be a non-empty string')
  if (!Number.isFinite(at)) throw new TypeError('heartbeatRecord: at must be a finite number of milliseconds')
  return { kind: HEARTBEAT_KIND, subject: memberId, payload: { id: memberId, at } }
}

/** Last heartbeat per member. */
export interface LivenessState {
  /** Member id to the latest heartbeat instant (milliseconds). */
  readonly lastHeartbeat: Readonly<Record<string, number>>
  /**
   * Member id to the **sequence** that heartbeat was written at.
   *
   * The instant says when a member spoke, the sequence says where in the ledger it spoke — and the
   * second is the only one that can be compared with another record's position. Isolation is cleared
   * by a beat that came after it (`isIsolated`), which is a question about order, not about clocks.
   */
  readonly beatSeq: Readonly<Record<string, number>>
  /** How many heartbeats were folded. */
  readonly beats: number
  /** Heartbeat records that carried no usable instant. */
  readonly malformed: number
}

/**
 * Fold heartbeats into the last instant per member.
 *
 * By `seq`, like every other fold here: the same beats arranged differently give the same answer,
 * and a member's latest beat is the one with the highest sequence rather than the last line read.
 * @param records - every record read from the log, in any order.
 * @returns the last heartbeat per member.
 */
/** The mutable state of {@link projectLiveness}: the latest beat per member, folded so far. */
interface LivenessFoldState {
  lastHeartbeat: Record<string, number>
  beatSeq: Record<string, number>
  beats: number
  malformed: number
}

function emptyLivenessFold(): LivenessFoldState {
  return { lastHeartbeat: {}, beatSeq: {}, beats: 0, malformed: 0 }
}

/**
 * Step the liveness fold, in sequence order.
 *
 * Sequence order is what makes the result and its key order independent of how a caller arranged
 * the rows: the last beat in that order is each member's latest, and a member first appears where
 * its earliest beat is.
 */
function foldLiveness(state: LivenessFoldState, records: readonly ControlRecord[]): void {
  for (const record of orderedRecords(records)) {
    if (record.kind !== HEARTBEAT_KIND) continue
    const payload = record.payload as { id?: unknown, at?: unknown } | undefined
    const id = payload?.id ?? record.subject
    if (typeof id !== 'string' || id === '' || typeof payload?.at !== 'number' || !Number.isFinite(payload.at)) {
      state.malformed += 1
      continue
    }
    state.beats += 1
    state.lastHeartbeat[id] = payload.at
    state.beatSeq[id] = record.seq
  }
}

function finishLiveness(state: LivenessFoldState): LivenessState {
  return { lastHeartbeat: { ...state.lastHeartbeat }, beatSeq: { ...state.beatSeq }, beats: state.beats, malformed: state.malformed }
}

export function projectLiveness(records: readonly ControlRecord[]): LivenessState {
  const state = emptyLivenessFold()
  foldLiveness(state, records)
  return finishLiveness(state)
}

/** `healthy`: beat recently. `unhealthy`: beat, but too long ago. `unknown`: never beat. */
export type Liveness = 'healthy' | 'unhealthy' | 'unknown'

/** One member's verdict, with the numbers it was decided from. */
export interface LivenessReading {
  /** The member. */
  readonly memberId: string
  /** The verdict. */
  readonly liveness: Liveness
  /** Last heartbeat instant, or null when the member never beat. */
  readonly lastHeartbeat: number | null
  /** The instant the question was asked at, as passed in. */
  readonly now: number
  /** The threshold used. */
  readonly timeoutMs: number
  /** Milliseconds since the last beat, or null when the member never beat. */
  readonly sinceMs: number | null
}

/** How long a member may go without a beat. */
export interface LivenessOptions {
  /** Threshold in milliseconds. */
  readonly timeoutMs: number
}

/**
 * Decide every member's liveness at one instant.
 *
 * `now` is a parameter and no clock is read in here: a verdict that depends on wall time cannot be
 * reproduced, and a failure-handling path nobody can reproduce is a path nobody can test. The
 * boundary is stated rather than left to chance: a member is **unhealthy once the time since its
 * last beat reaches the threshold**, so `now - lastHeartbeat === timeoutMs` is already unhealthy.
 * @param state - a folded state.
 * @param now - the instant to decide at, in milliseconds.
 * @param options - the threshold.
 * @returns one reading per member known to the ledger, ordered by member id.
 */
export function livenessOf(state: TeamState, now: number, options: LivenessOptions): readonly LivenessReading[] {
  const { timeoutMs } = options
  const ids = [...new Set([...Object.keys(state.liveness.lastHeartbeat), ...state.members.map((member) => member.id)])].sort()
  return ids.map((memberId) => {
    const last = state.liveness.lastHeartbeat[memberId] ?? null
    if (last === null) return { memberId, liveness: 'unknown' as Liveness, lastHeartbeat: null, now, timeoutMs, sinceMs: null }
    const sinceMs = now - last
    return { memberId, liveness: (sinceMs >= timeoutMs ? 'unhealthy' : 'healthy') as Liveness, lastHeartbeat: last, now, timeoutMs, sinceMs }
  })
}

/** Whether one member is quarantined at this instant: it beat, and it has been silent too long. */
export function isQuarantined(state: TeamState, memberId: string, now: number, options: LivenessOptions): boolean {
  return livenessOf(state, now, options).find((reading) => reading.memberId === memberId)?.liveness === 'unhealthy'
}

/* ------------------------------------------------------------------------------------------------
 * R181: releasing the work a silent owner is holding.
 *
 * 《DSH LINK.md》§2.4 "故障隔离与任务重调度" (md:208-218) names four steps: notice a heartbeat that
 * timed out, release the work that member was holding back onto the board, hand it out again, and
 * keep the failed member out of new work until it recovers. The first step is the one this module
 * could not take: `claimable`, `reclaimable` and `lockReclaimable` count only `unhealthy` as dead,
 * and a member that never beat reads `unknown` — on a ledger with `beats: 0`, which is what this
 * project's own live ledger reads, no member is ever `unhealthy`, so nothing is ever reclaimable.
 *
 * Silence is not death, and that rule stays: a member nobody has heard from and that holds no work
 * is not a failure. A member that **holds work** and has never said it is alive is a different fact,
 * and it is the one the timeout was written for. `RECLAIM_SILENT_OWNER` is that second rule, named:
 * only `in_progress` is in question, and the three ways a holder can be silent are named apart —
 * never beat, beat and stopped, and no owner recorded at all.
 *
 * Everything here is a reading: no clock is read, `now` and `timeoutMs` are the caller's, and the
 * only other fact consulted is the latest heartbeat the ledger holds. The writer that acts on a
 * reading is `reclaimTask`, and the boundary between "beat at exactly the threshold" and "beat one
 * millisecond later" is the same one `livenessOf` states: the threshold reached is already past.
 * ---------------------------------------------------------------------------------------------- */

/**
 * The name of the rule that decides whether work held by a silent owner may be reclaimed.
 *
 * Named so a reading, a refusal and an isolation can be talked about without re-deriving them: the
 * code in a {@link ReclaimReading} is this rule's answer, and the isolation row a reclaim writes
 * carries the same code as its reason.
 */
export const RECLAIM_RULE = 'RECLAIM_SILENT_OWNER'

/**
 * How long a member may hold a task without beating before its work may be reclaimed.
 *
 * A default rather than a constant of the rule: the rule takes `timeoutMs` from its caller, and this
 * is what the plugin's tool passes when a composition names none. Fifteen minutes is longer than any
 * container of work here takes to say it is alive, and short enough that a member that dies holding a
 * task does not hold it for a day.
 */
export const RECLAIM_DEFAULT_TTL_MS = 15 * 60 * 1000

/**
 * The named answers this rule gives.
 *
 * One code per fact, so no two situations collapse into one word: the two reclaimable ones
 * (`NEVER_BEAT`, `HEARTBEAT_STALE`) are different evidence for the same verdict, `NO_OWNER` is the
 * third way a row can be held by nobody, and the two refusals a reader will meet most
 * (`OWNER_ALIVE`, `NOT_IN_PROGRESS`) say which rule declined. `UNKNOWN_TASK` belongs to the
 * board-level reading only: a {@link ReclaimSubject} always exists, so the subject rule cannot
 * report it.
 */
export type ReclaimCode =
  /** No task with that key is on the board: a board-level answer only. */
  | 'UNKNOWN_TASK'
  /** The row is not `in_progress`: nothing is being held, so there is nothing to release. */
  | 'NOT_IN_PROGRESS'
  /** The row is `in_progress` and names no owner: nobody is holding it. */
  | 'NO_OWNER'
  /** The owner holds the task and the ledger holds no heartbeat for it at all. */
  | 'NEVER_BEAT'
  /** The owner beat, and the time since that beat has reached the threshold. */
  | 'HEARTBEAT_STALE'
  /** The owner beat within the threshold. Refused: this is the control arm of the rule. */
  | 'OWNER_ALIVE'

/** One task, as {@link reclaimVerdict} reads it: what is held, by whom, and when that member spoke. */
export interface ReclaimSubject {
  /** The task id. Carried through so a refusal can name the task it refused. */
  readonly id: string
  /** The status the board holds for it. */
  readonly status: string
  /** The owner the winning claim names, or null/absent when no record named one. */
  readonly ownerId?: string | null
  /**
   * The owner's latest heartbeat instant, or null/absent when it never beat.
   *
   * A caller that has no heartbeat for the owner passes null — the same fact as a heartbeat the
   * ledger never received, which is why `NEVER_BEAT` is a definite answer rather than a missing one.
   */
  readonly heartbeatAt?: number | null
}

/** How long a member may go without a beat before the work it holds may be taken. */
export interface ReclaimVerdictOptions {
  /** The threshold in milliseconds. A positive integer; the rule refuses to guess one. */
  readonly timeoutMs: number
}

/**
 * One task's answer, with the numbers it was decided from.
 *
 * `deadlineMs` is the instant the threshold is reached — the beat plus the threshold — so a reader
 * can see how long the owner has left rather than only whether it is out of time. A member that
 * never beat has no deadline to count from, and it is already out of time, so the deadline is the
 * instant of the question itself.
 */
export interface ReclaimVerdict {
  /** The rule that answered: {@link RECLAIM_RULE}, so a reader never has to guess which one spoke. */
  readonly rule: typeof RECLAIM_RULE
  /** The task id this verdict is about. */
  readonly taskId: string
  /** The status the verdict was read against. */
  readonly status: string
  /** The owner the verdict was read against, or null. */
  readonly owner: string | null
  /** The heartbeat the verdict was read against, or null when there was none. */
  readonly heartbeatAt: number | null
  /** Milliseconds since that beat, or null when there was no beat. */
  readonly sinceMs: number | null
  /** The instant the threshold is reached, or `now` when there is no beat to count from. */
  readonly deadlineMs: number
  /** Whether the task may be released back to `pending`. */
  readonly reclaimable: boolean
  /** Which named answer this is. */
  readonly code: ReclaimCode
  /** The answer in words, with the numbers it was decided from. */
  readonly reason: string
}

/**
 * Decide whether the work one subject describes may be reclaimed, without touching the ledger.
 *
 * The precedence is total and ordered:
 *
 * 1. not `in_progress` — `NOT_IN_PROGRESS`: a `pending` task is already free and a `completed` one
 *    is finished with, so releasing either would be a write that changes nothing;
 * 2. `in_progress` with no owner — `NO_OWNER`, **reclaimable**: the row is holding a slot against
 *    nobody, and the kernel will not hand it out either (`claim` requires `pending`,
 *    `agent-team/src/task-board.ts:133`), so leaving it alone is how one dead row blocks a board
 *    forever. This project's live ledger holds exactly this row (`task-7`, 41.9 h in `in_progress`
 *    with no owner recorded);
 * 3. the owner never beat — `NEVER_BEAT`, **reclaimable**. This is the arm this round exists for:
 *    the previous rule counted only `unhealthy` as dead, and a ledger with no heartbeats at all
 *    (`beats: 0`, which is what the live ledger reads) makes every holder `unknown`, so nothing was
 *    ever reclaimable. A member that holds work and has never once said it is alive is not the
 *    member "silence is not death" was written for;
 * 4. the owner beat, and `now - heartbeatAt >= timeoutMs` — `HEARTBEAT_STALE`, **reclaimable**;
 * 5. the owner beat within the threshold — `OWNER_ALIVE`, refused, and nothing is written.
 *
 * The comparison in step 4 is the one `livenessOf` makes (`sinceMs >= timeoutMs`), so a beat exactly
 * at the threshold is already past it here too: one boundary, stated once, in two readers.
 *
 * **The clock is not read here.** `now` and `timeoutMs` are the caller's, and the only other fact
 * consulted is the latest heartbeat the caller passes in, so the same three arguments always give the
 * same answer. Note what step 3 deliberately does **not** require: a holding duration. A claim
 * written one millisecond ago by a member that has never beaten is still work held by nobody who has
 * ever reported for it, and requiring a duration would make the rule wait for a second fact that, by
 * hypothesis, never arrives.
 *
 * @param subject - the task as the caller reads it: status, owner, latest heartbeat.
 * @param now - the instant to decide at, in milliseconds.
 * @param options - the threshold.
 * @returns the verdict, with a named code.
 */
export function reclaimVerdict(subject: ReclaimSubject, now: number, options: ReclaimVerdictOptions): ReclaimVerdict {
  const timeoutMs = options?.timeoutMs
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('reclaimVerdict: timeoutMs must be a positive integer of milliseconds; got ' + describeValue(timeoutMs))
  }
  const owner = typeof subject?.ownerId === 'string' && subject.ownerId !== '' ? subject.ownerId : null
  const status = typeof subject?.status === 'string' ? subject.status : 'unknown'
  const taskId = typeof subject?.id === 'string' ? subject.id : ''
  const last = typeof subject?.heartbeatAt === 'number' && Number.isFinite(subject.heartbeatAt) ? subject.heartbeatAt : null
  const verdict = (sinceMs: number | null, deadlineMs: number, reclaimable: boolean, code: ReclaimCode, reason: string): ReclaimVerdict => ({
    rule: RECLAIM_RULE,
    taskId,
    status,
    owner,
    heartbeatAt: last,
    sinceMs,
    deadlineMs,
    reclaimable,
    code,
    reason,
  })
  if (status !== 'in_progress') {
    return verdict(null, now, false, 'NOT_IN_PROGRESS', 'this task is ' + describeValue(status) + ', not in_progress: nothing is being held')
  }
  if (owner === null) {
    return verdict(null, now, true, 'NO_OWNER', 'this task is in_progress and no owner was recorded on it: no member is holding it, and nobody can claim it while it stays in flight')
  }
  if (last === null) {
    return verdict(null, now, true, 'NEVER_BEAT', 'owner ' + describeValue(owner) + ' holds this task and the ledger holds no heartbeat for it at all')
  }
  const sinceMs = now - last
  const deadlineMs = last + timeoutMs
  if (sinceMs >= timeoutMs) {
    return verdict(sinceMs, deadlineMs, true, 'HEARTBEAT_STALE', 'owner ' + describeValue(owner) + ' last beat ' + String(sinceMs) + ' ms ago, which reaches the ' + String(timeoutMs) + ' ms threshold')
  }
  return verdict(sinceMs, deadlineMs, false, 'OWNER_ALIVE', 'owner ' + describeValue(owner) + ' beat ' + String(sinceMs) + ' ms ago, inside the ' + String(timeoutMs) + ' ms threshold')
}

/** One board row's verdict, with the key and team it was read from. */
export interface ReclaimReading extends ReclaimVerdict {
  /** The {@link boardKey} the verdict is about. */
  readonly key: string
  /** The team the row is attributed to, or null. */
  readonly team: string | null
}

/**
 * Read one board row and decide, without touching the ledger.
 *
 * The subject is folded out of the board and the liveness fold, and the decision itself is
 * {@link reclaimVerdict}'s: one rule, two doors, so a caller holding a key and a caller holding a
 * subject cannot be told different things. A key that is not on the board answers
 * `UNKNOWN_TASK` — a definite "this board does not hold that task", not a refusal to look.
 * @param state - a folded state.
 * @param key - the {@link boardKey} of the task.
 * @param now - the instant to decide at, in milliseconds. Never read from a clock in here.
 * @param options - the threshold.
 * @returns the reading, with the key and team it came from.
 */
export function reclaimReading(state: TeamState, key: string, now: number, options: ReclaimVerdictOptions): ReclaimReading {
  const row = state.board.tasks.find((entry) => entry.key === key)
  if (row === undefined) {
    return {
      rule: RECLAIM_RULE,
      key,
      taskId: key,
      team: null,
      status: 'unknown',
      owner: null,
      heartbeatAt: null,
      sinceMs: null,
      deadlineMs: now,
      reclaimable: false,
      code: 'UNKNOWN_TASK',
      reason: 'no task is on the board under this key',
    }
  }
  const verdict = reclaimVerdict({
    id: row.id,
    status: row.status,
    ownerId: row.owner,
    heartbeatAt: row.owner === null ? null : (state.liveness.lastHeartbeat[row.owner] ?? null),
  }, now, options)
  return { ...verdict, key, team: row.team }
}

/**
 * Every in-flight task on the board, one reading each.
 *
 * The name is about what it returns rather than about the rule, on purpose: a reader that wants
 * "what is held right now" should not have to have already decided that reclaiming is the question.
 * This is also the table to compare before and after a reclaim: it lists the held tasks whatever the
 * verdict is, so "nothing was reclaimed" and "nothing was reclaimable" are told apart by the codes
 * rather than by an empty list.
 * @param state - a folded state.
 * @param now - the instant to decide at, in milliseconds.
 * @param options - the threshold.
 * @returns the readings, ordered by board key.
 */
export function inFlightReadings(state: TeamState, now: number, options: ReclaimVerdictOptions): readonly ReclaimReading[] {
  return state.board.tasks
    .filter((row) => row.status === 'in_progress')
    .map((row) => reclaimReading(state, row.key, now, options))
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
}

/**
 * The record kind that carries one member's isolation.
 *
 * A separate kind rather than a `member/state` row, because an isolation is not a phase the member
 * declared about itself: it is a fact this layer's tool wrote, with an author, an instant and the
 * rule that justified it. Folding it into the member's own state would put words in the member's
 * mouth and would overwrite what the kernel's Team service said about its phase.
 *
 * A reclaim that has an owner to isolate appends one of these beside its release row, so the member
 * whose work was taken back shows up in the isolation table rather than only inside a task row:
 * md:218's "kept out of new work until it recovers" is a fact about the member, so it is recorded
 * about the member.
 */
export const QUARANTINE_KIND = 'member/quarantine'

/** One member's isolation, as the ledger holds it. */
export interface QuarantineRow {
  /** The isolated member. */
  readonly memberId: string
  /** The instant the isolation was written at. */
  readonly at: number
  /** The sequence of the record that put it there, which is also what a later beat is compared to. */
  readonly seq: number
  /** The code of the rule that justified it, e.g. `HEARTBEAT_STALE` or `NEVER_BEAT`. */
  readonly reason: string
  /** The task id whose reclaim isolated this member, or null when the fact names none. */
  readonly task: string | null
  /** Who wrote the fact, when the writer named anyone. */
  readonly by: string | null
}

/**
 * Build the record that isolates one member.
 * @param memberId - the member being kept out of new work.
 * @param at - the instant of the isolation, in milliseconds; passed in, never read from a clock here.
 * @param detail - the rule that justified it, the task it came from, and the writer.
 * @returns the record to append, without a sequence.
 */
export function quarantineRecord(memberId: string, at: number, detail: { reason: string, task?: string | null, by?: string | null }): { kind: string, subject: string, payload: Record<string, unknown> } {
  if (typeof memberId !== 'string' || memberId === '') throw new TypeError('quarantineRecord: memberId must be a non-empty string')
  if (!Number.isFinite(at)) throw new TypeError('quarantineRecord: at must be a finite number of milliseconds')
  return {
    kind: QUARANTINE_KIND,
    subject: memberId,
    payload: {
      id: memberId,
      at,
      reason: detail.reason,
      task: detail.task ?? null,
      by: detail.by ?? null,
    },
  }
}

/**
 * Fold isolation facts into one row per member.
 *
 * By `seq`, like every other fold here: a member isolated twice holds the latest fact, and the same
 * records arranged differently give the same table.
 * @param records - every record read from the log, in any order.
 * @returns one row per isolated member, ordered by member id.
 */
function quarantineFact(record: ControlRecord): { memberId: string, at: number, reason: string, task: string | null, by: string | null } | null {
  const payload = record.payload as { id?: unknown, at?: unknown, reason?: unknown, task?: unknown, by?: unknown, reclaimed?: unknown } | undefined
  const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
  // A member/state row saying 'quarantined' is read too: that is the shape this layer's own vocabulary
  // already has for a member fact, and a writer that spells an isolation that way must not produce an
  // isolation table nobody folds. Two spellings, one table.
  if (record.kind === MEMBER_KIND && text(payload?.state) === 'quarantined') {
    const id = text(payload?.id) ?? text(record.subject)
    if (id !== null) {
      return {
        memberId: id,
        at: typeof payload?.at === 'number' && Number.isFinite(payload.at) ? payload.at : (record.at ?? 0),
        reason: text(payload?.reason) ?? '',
        task: text(payload?.task),
        by: text(payload?.by),
      }
    }
  }
  if (record.kind === QUARANTINE_KIND) {
    const id = text(payload?.id) ?? text(record.subject)
    if (id === null) return null
    return {
      memberId: id,
      at: typeof payload?.at === 'number' && Number.isFinite(payload.at) ? payload.at : (record.at ?? 0),
      reason: text(payload?.reason) ?? '',
      task: text(payload?.task),
      by: text(payload?.by),
    }
  }
  return null
}

/** The mutable state of {@link projectQuarantine}: the latest isolation fact per member. */
interface QuarantineFoldState {
  latest: Map<string, QuarantineRow>
}

function emptyQuarantineFold(): QuarantineFoldState {
  return { latest: new Map() }
}

function foldQuarantine(state: QuarantineFoldState, records: readonly ControlRecord[]): void {
  for (const record of orderedRecords(records)) {
    const fact = quarantineFact(record)
    if (fact === null) continue
    state.latest.set(fact.memberId, { ...fact, seq: record.seq })
  }
}

function finishQuarantine(state: QuarantineFoldState): readonly QuarantineRow[] {
  return [...state.latest.values()].sort((left, right) => (left.memberId < right.memberId ? -1 : left.memberId > right.memberId ? 1 : 0))
}

export function projectQuarantine(records: readonly ControlRecord[]): readonly QuarantineRow[] {
  const state = emptyQuarantineFold()
  foldQuarantine(state, records)
  return finishQuarantine(state)
}

/**
 * Whether one member is isolated right now, read from the ledger alone.
 *
 * Isolation lasts until the isolated member says it is alive again: a heartbeat with a **later
 * sequence** than the isolation clears it, which is the only evidence of recovery this ledger has
 * (md:218's "until it recovers health"). No clock is read: the answer is a comparison of two sequence
 * numbers, so the same ledger always gives the same verdict. A member that was isolated and then
 * went quiet again is not re-isolated by this function — the beat cleared the fact, and a second
 * isolation would be a second record, which the table would then hold.
 * @param state - a folded state.
 * @param memberId - the member to ask about.
 * @returns whether the member is isolated.
 */
export function isIsolated(state: TeamState, memberId: string): boolean {
  const row = state.quarantine.find((entry) => entry.memberId === memberId)
  if (row === undefined) return false
  const beat = state.liveness.beatSeq[memberId] ?? null
  return beat === null || beat < row.seq
}

/** How long a member may go without a beat, and optionally how long a lock may live. */
export interface RecoverOptions {
  /** How long a member may go without a beat before it is quarantined. */
  readonly timeoutMs: number
  /**
   * The lock's time to live. **When omitted, the lock table is not read at all** and `heldLocks`
   * is null: a reading nobody asked for must not be reported as "there are no locks".
   */
  readonly ttlMs?: number
}

/** One task whose holder is not healthy, with the members that could take it. */
export interface RecoverableTask {
  /** The task. */
  readonly id: string
  /** The holder that stopped answering. */
  readonly owner: string | null
  /** The capability the task needs, when the task says so. */
  readonly capability: string | null
  /** Healthy members able to take it: those with the capability when one is named, else all healthy members. */
  readonly candidates: readonly string[]
  /**
   * The keys of the locks this task's owner took on it, sorted — including a lapsed one, because a
   * lapsed lock is still a lock that was taken and must be cleared before another claim can be
   * believed. `[]` when the lock table was read and holds no lock of this owner; **`null` when no
   * `ttlMs` was given, so the lock table was not read at all**.
   *
   * Null and empty are kept apart because a caller that cannot tell "nobody holds this" from "I did
   * not look" will hand the task to somebody who then finds the lock still in place.
   */
  readonly heldLocks: readonly string[] | null
  /**
   * Whether the lock the owner holds on this task can be taken **now**: the lock has expired, or its
   * holder is quarantined. The same predicate `reclaimable()` runs, from the same function.
   *
   * **This asks about the lock, and only about the lock.** It is deliberately not the same question
   * as `reclaimable().reclaimable`, which also asks whether the task could be handed out at all once
   * the lock is gone — so a `blocked` task whose dead owner's lock can be taken reports
   * `lockReclaimable: true` there while `reclaimable()` says `false`. Two questions, two names: a
   * single field called `reclaimable` answering both was the last way this round could have produced
   * two readings that look like they disagree.
   *
   * The name has to mean what it says here too: a task whose owner holds a live lock that cannot be
   * taken — a member that never beat, so it is `unknown` rather than dead — reports
   * `heldLocks: [key]` with `lockReclaimable: false`, which reads as "there is a lock, and you are
   * not entitled to take it yet".
   */
  readonly lockReclaimable: boolean
}

/**
 * The tasks that need recovering, and who could take each one.
 *
 * A task needs recovering when it is still in flight and its holder is quarantined. Candidates come
 * through the capability registry, never from the member list: a healthy member that cannot do the
 * work is not a candidate, and offering it would move a stuck task somewhere it stays stuck while
 * looking assigned.
 *
 * Handing a task out is not the same as being able to take it: the departing holder may still hold a
 * **live** lock on it, and that lock has to be reclaimed first. Given `ttlMs`, this reports which
 * locks stand in the way — `heldLocks` is the raw fact, `lockReclaimable` says whether that lock can
 * actually be taken now — so a reclaimer does not have to discover the contradiction between this list
 * and {@link claimable} by trying. Two members can be named on one task: a **quarantined** one, whose
 * live lock may be overruled, and one that merely never beat (`unknown`), whose live lock is reported
 * as held and **not** reclaimable, because silence is not death.
 * @param state - a folded state.
 * @param now - the instant to decide at, in milliseconds.
 * @param options - the liveness threshold, and the lock's time to live when locks are to be read.
 * @returns the tasks to recover, ordered by task id.
 */
export function recoverable(state: TeamState, now: number, options: RecoverOptions): readonly RecoverableTask[] {
  const readings = new Map(livenessOf(state, now, { timeoutMs: options.timeoutMs }).map((reading) => [reading.memberId, reading.liveness]))
  const healthy = [...readings.entries()].filter(([, liveness]) => liveness === 'healthy').map(([id]) => id).sort()
  const ttlMs = options.ttlMs
  return state.tasks
    .filter((task) => {
      const inFlight = task.state !== 'completed' && task.state !== 'deleted'
      const holder = task.owner ?? null
      return inFlight && holder !== null && readings.get(holder) !== 'healthy'
    })
    .map((task) => {
      const named = state.taskDemands[task.id] ?? null
      const able = named === null ? healthy : membersWith(state, named).filter((id) => readings.get(id) === 'healthy')
      const owner = task.owner ?? null
      // The locks this owner took on this task: rows whose holder is the owner, lapsed ones included.
      // A lapsed lock is still a lock that was taken and has to be cleared before anybody else's
      // claim can be believed, and leaving it out would make `lockReclaimable` false for a task whose
      // lock `reclaimable()` calls reclaimable — the two readings disagreeing about one task, which
      // is the contradiction this round exists to remove.
      const heldLocks = ttlMs === undefined
        ? null
        : state.locks
          .filter((lock) => lock.key === boardKey(task.team, task.id) && lock.holder === owner)
          .map((lock) => lock.key)
          .sort()
      // `heldLocks` is what the ledger says; `lockReclaimable` is whether a reclaimer may act on it.
      // Same predicate as `reclaimable()` runs, from the same function, so the lock question has one
      // answer wherever it is asked — while the *other* question ("is there anything to hand out once
      // the lock is gone?") keeps its own name, `reclaimable().reclaimable`.
      const takenNow = heldLocks !== null && heldLocks.some((key) => lockReclaimable(state, key, now, { ttlMs: ttlMs as number, timeoutMs: options.timeoutMs }))
      return {
        id: task.id,
        owner,
        capability: named,
        candidates: [...able].sort(),
        heldLocks,
        lockReclaimable: takenNow,
      }
    })
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
}

/* ------------------------------------------------------------------------------------------------
 * Sessions: one author at a time.
 *
 * 《DSH LINK.md》§3 ①, "attach to B's conversation and manage it like your own", has one decidable
 * core: a session has at most one author at any instant. Two ends that both write half a
 * conversation produce two conversations, and neither end can tell — so ownership is a fact in the
 * ledger, not a convention in a client. Nothing here moves a conversation between devices: this is
 * the ownership protocol (who owns, who may write, how it is handed over, how long silence buys a
 * takeover), and the content itself is not part of it.
 */

/**
 * The record kind one end appends to claim a session.
 *
 * A claim names an end and a generation. Whether it was legitimate is not decided here: the fold
 * accepts claims in ledger order, and {@link mayContinue} answers whether a caller may make one —
 * the same separation the lock table and {@link claimable} keep.
 */
export const SESSION_KIND = 'session/claim'

/** The record kind one end appends to hand a session to another end. */
export const HANDOFF_KIND = 'session/handoff'

/**
 * Build a session claim.
 *
 * The epoch is the session's authorship generation: every accepted change moves it, and a claim at
 * or below the generation the ledger already holds is stale. It is written down rather than derived
 * from the record's `seq`, because a sequence is one log's arrival counter — two devices holding
 * the same session have two counters and no common order between them.
 * @param session - the session being claimed. Non-empty.
 * @param end - the end claiming it. Non-empty.
 * @param epoch - the generation claimed. A positive safe integer.
 * @param at - the instant, in milliseconds. Passed in; no clock is read here.
 * @returns the record to append, without a sequence.
 */
export function sessionClaim(session: string, end: string, epoch: number, at: number): { kind: string, subject: string, payload: { session: string, end: string, epoch: number, at: number } } {
  if (typeof session !== 'string' || session === '') throw new TypeError('sessionClaim: session must be a non-empty string')
  if (typeof end !== 'string' || end === '') throw new TypeError('sessionClaim: end must be a non-empty string')
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new TypeError('sessionClaim: epoch must be a positive safe integer')
  if (!Number.isFinite(at)) throw new TypeError('sessionClaim: at must be a finite number of milliseconds')
  return { kind: SESSION_KIND, subject: session, payload: { session, end, epoch, at } }
}

/**
 * Build a session handoff.
 *
 * A handoff is the polite form of a transfer: the current author names the end taking over, and the
 * generation moves by exactly one. An end that takes over from a silent author writes a
 * {@link sessionClaim} instead, because the departing author is by definition not there to sign.
 * @param session - the session being handed over. Non-empty.
 * @param from - the end handing it over. Non-empty.
 * @param to - the end taking it. Non-empty.
 * @param epoch - the generation being transferred to. A positive safe integer.
 * @param at - the instant, in milliseconds. Passed in; no clock is read here.
 * @returns the record to append, without a sequence.
 */
export function sessionHandoff(session: string, from: string, to: string, epoch: number, at: number): { kind: string, subject: string, payload: { session: string, from: string, to: string, epoch: number, at: number } } {
  if (typeof session !== 'string' || session === '') throw new TypeError('sessionHandoff: session must be a non-empty string')
  if (typeof from !== 'string' || from === '') throw new TypeError('sessionHandoff: from must be a non-empty string')
  if (typeof to !== 'string' || to === '') throw new TypeError('sessionHandoff: to must be a non-empty string')
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new TypeError('sessionHandoff: epoch must be a positive safe integer')
  if (!Number.isFinite(at)) throw new TypeError('sessionHandoff: at must be a finite number of milliseconds')
  return { kind: HANDOFF_KIND, subject: session, payload: { session, from, to, epoch, at } }
}

/**
 * The record kind one author appends to speak in a session.
 *
 * A turn carries who spoke, at which generation, and the payload itself. The payload is opaque
 * here: this layer answers "who was entitled to write this, and when", not what it says.
 */
export const TURN_KIND = 'session/turn'

/** One turn as a caller asks for it to be written. */
export interface SessionTurn {
  /** The session being spoken in. */
  readonly session: string
  /** The end speaking. */
  readonly end: string
  /** The authorship generation it speaks at. */
  readonly epoch: number
  /** The payload. Opaque to this layer: never parsed, only carried and attributed. */
  readonly text: string
}

/**
 * Build a turn record.
 *
 * The generation is written down beside the speaker rather than looked up at fold time, for the
 * same reason the claim carries one: a reader has to be able to judge the turn against the author
 * that held the session when it was written, not against whoever holds it now.
 * @param turn - who spoke, in which session, at which generation, saying what.
 * @param at - the instant, in milliseconds. Passed in; no clock is read here.
 * @returns the record to append, without a sequence.
 */
export function turnRecord(turn: SessionTurn, at: number): { kind: string, subject: string, payload: { session: string, end: string, epoch: number, text: string, at: number } } {
  if (typeof turn?.session !== 'string' || turn.session === '') throw new TypeError('turnRecord: session must be a non-empty string')
  if (typeof turn?.end !== 'string' || turn.end === '') throw new TypeError('turnRecord: end must be a non-empty string')
  if (!Number.isSafeInteger(turn?.epoch) || turn.epoch < 1) throw new TypeError('turnRecord: epoch must be a positive safe integer')
  if (typeof turn?.text !== 'string') throw new TypeError('turnRecord: text must be a string')
  if (!Number.isFinite(at)) throw new TypeError('turnRecord: at must be a finite number of milliseconds')
  return { kind: TURN_KIND, subject: turn.session, payload: { session: turn.session, end: turn.end, epoch: turn.epoch, text: turn.text, at } }
}
/** One session's current author, as the fold read it. */
export interface SessionOwner {
  /** The session. */
  readonly session: string
  /** The end that may write it. */
  readonly end: string
  /** The authorship generation. */
  readonly epoch: number
  /** The instant the accepted record carried, in milliseconds. */
  readonly at: number
  /** Sequence of the accepted record. */
  readonly seq: number
  /** How the author got it: its own claim, or a handoff from the previous author. */
  readonly by: 'claim' | 'handoff'
}

/** One accepted authorship change. The audit chain behind {@link SessionOwner}. */
export interface SessionStep {
  /** The session. */
  readonly session: string
  /** The end that became the author. */
  readonly end: string
  /** The generation it took. */
  readonly epoch: number
  /** The instant the accepted record carried, in milliseconds. */
  readonly at: number
  /** Sequence of the accepted record. */
  readonly seq: number
  /** How the author got it. */
  readonly by: 'claim' | 'handoff'
}

/**
 * One claim that was refused, and why.
 *
 * A refusal is a reading, not a discard: "the other end tried and was turned away" is exactly what
 * an operator needs when two ends disagree, and a ledger that keeps only the winners cannot answer
 * it. `end` is the end this record would have made the author — the same column
 * {@link SessionOwner.end} and {@link SessionStep.end} hold, so the rows join — and null when the
 * record did not carry a usable one. `by` says which of the two things that column means here: on
 * a claim the end asked for the session, on a handoff it was being handed it.
 */
export interface SessionRefusal {
  /**
   * The session the refused record addressed, or null when it addressed none at all.
   *
   * Null and the empty string are kept apart, the same way `heldLocks: null` and `heldLocks: []`
   * are: an empty string would be an address this fold invented and attributed to a session that no
   * record named, while null says what happened — "this record carried no usable session address".
   * A refusal is visible either way; being unable to say *which* session is not a reason to drop it.
   */
  readonly session: string | null
  /** The end the record would have made the author, or null when it named none. */
  readonly end: string | null
  /** The generation the record claimed, or 0 when it carried none this fold could read. */
  readonly epoch: number
  /** Sequence of the refused record. */
  readonly seq: number
  /** Why it was refused. */
  readonly reason: 'stale-epoch' | 'not-owner' | 'epoch-gap' | 'malformed'
  /**
   * Which record kind made the refusal: the end's own claim, or a handoff.
   *
   * {@link end} alone cannot say which one it is — on a claim that end asked for the session, on a
   * handoff it was being handed it — and a column whose meaning depends on a second column has to
   * name that second column instead of leaving the reader to infer it from the ledger. The record
   * itself is still there to be joined by `seq` when the rest of the payload is wanted.
   */
  readonly by: 'claim' | 'handoff'
}

/** What the session records add up to. */
export interface SessionsState {
  /** The current author per session, ordered by session id. */
  readonly owners: readonly SessionOwner[]
  /** Every accepted authorship change, in sequence order. */
  readonly steps: readonly SessionStep[]
  /** Every refused record, in sequence order. Visible, never dropped. */
  readonly refused: readonly SessionRefusal[]
  /** How many records were unusable as a session fact at all. */
  readonly malformed: number
  /** Every accepted turn, ordered by (session, seq). */
  readonly turns: readonly AdoptedTurn[]
  /**
   * Every turn the ledger holds that was not accepted, ordered by (session, seq).
   *
   * Visible on purpose, and for the same reason the refused authorship changes are: a turn that got
   * in without the guard, or that was written at a generation that had moved on, is exactly what an
   * operator has to see. A reader that only showed the accepted turns could not tell a quiet session
   * from a divided one.
   */
  readonly rejectedTurns: readonly RejectedTurn[]
}

/** One turn the fold accepted. */
export interface AdoptedTurn {
  /** The session spoken in. */
  readonly session: string
  /** The end that spoke. */
  readonly end: string
  /** The generation it spoke at. */
  readonly epoch: number
  /** The payload, carried verbatim. Opaque to this layer. */
  readonly text: string
  /** The instant the turn was written, in milliseconds. */
  readonly at: number
  /** Sequence of the record. */
  readonly seq: number
}

/** One turn the fold did not accept, and why. */
export interface RejectedTurn {
  /**
   * The session the turn was written in, or null when the record named none at all.
   *
   * Null and the empty string are kept apart here for the same reason {@link SessionRefusal.session}
   * keeps them apart: an empty string would be an address this fold invented, while null says what
   * happened — this record carried no usable session address. Being unable to say which session it
   * was is not a reason to drop the row.
   */
  readonly session: string | null
  /** The end that claimed to speak, or null when the record named none this fold could read. */
  readonly end: string | null
  /** The generation the turn was written at, or 0 when the record carried none this fold read. */
  readonly epoch: number
  /** Sequence of the record. */
  readonly seq: number
  /**
   * Why it was not accepted.
   *
   * `no-author`, `stale-epoch`, `not-author` and `unrecorded-epoch` are the four judgements about a
   * turn this build can read; `malformed` is the one for a record that is not a turn fact at all.
   * `unrecorded-epoch` is deliberately the word {@link appendTurn} refuses with: the author claiming
   * a generation the ledger never recorded is one fact, and one fact gets one name on both faces —
   * a second word for it is how two readings come to look like they disagree.
   */
  readonly reason: 'no-author' | 'stale-epoch' | 'not-author' | 'unrecorded-epoch' | 'malformed'
}

/**
 * Why one turn may not be accepted at one generation, or null when it may.
 *
 * The author passed in is the one that held the session **when the turn was written**, not the one
 * that holds it at the end of the ledger: a turn is judged against the authority of its own instant,
 * which is what makes a handoff change future turns and not past ones.
 * @param held - the author at the turn's instant, or null when nobody had claimed the session yet.
 * @param end - the end that spoke.
 * @param epoch - the generation it spoke at.
 * @returns the reason it is refused, or null when it is accepted.
 */
function turnReason(held: SessionOwner | null, end: string, epoch: number): 'no-author' | 'stale-epoch' | 'not-author' | 'unrecorded-epoch' | null {
  if (held === null) return 'no-author'
  // The one write the guard produces: the author speaking at the generation the ledger holds. The
  // contract states its stale rule the other way round (`epoch <= the generation held then` is
  // stale), which read literally makes exactly this write stale - and then no guarded write could
  // ever be accepted, while the contract's own gate requires the ordinary write to be accepted.
  // This is the order the Lead froze in task-77 ruling 1; everything below it is the literal rule.
  if (end === held.end && epoch === held.epoch) return null
  // At or below the generation held then is stale, whoever is speaking: the end that held the
  // session before a handoff, and the author's own older generation. The generation moves when the
  // session does, and a turn written at the old one belongs to whoever held it then.
  if (epoch <= held.epoch) return 'stale-epoch'
  // Above the generation held then it depends on who speaks, and neither refusal invents a word: a
  // stranger at a higher generation is `not-author`, and the author claiming a generation the ledger
  // never recorded is `unrecorded-epoch` - the same word the write face refuses it with.
  if (end !== held.end) return 'not-author'
  return 'unrecorded-epoch'
}

/** Order turns by session, then by sequence, so a table's order is a fact and not an arrival. */
const bySessionThenSeq = (left: { session: string, seq: number }, right: { session: string, seq: number }): number => {
  if (left.session !== right.session) return left.session < right.session ? -1 : 1
  return left.seq - right.seq
}
/**
 * Fold session records into one author per session.
 *
 * By `seq`, never by arrival: the same records arranged differently fold to the same author, and
 * that is the whole point — two ends reading one ledger must not disagree about who may write.
 *
 * The rules, in the order they are applied to one record. The order is written once, here, because
 * a total order is what makes the answers reproducible:
 *   1 a record that is not usable as a session fact — no addressable session, no end, an `at` or
 *     `epoch` that is not the number the shape declares — is counted `malformed` and never
 *     becomes an author;
 *   2 a session's first record must claim epoch >= 1, else `malformed`: there is no generation
 *     zero to continue, and it must not become the author of anything;
 *   3 a claim at or below the generation already held is `stale-epoch`, and the author does not
 *     move — a later line in the log does not win by arriving later;
 *   4 a handoff is accepted only from the current author (`not-owner`) at exactly the next
 *     generation (`epoch-gap`); a handoff with no current author is `not-owner` too, because
 *     there is nobody to hand it from. A claim may skip generations, since taking over from a
 *     silent author is spelled as a higher generation and nothing says by how much;
 *   5 every refusal is kept in `refused` with its reason, its sequence and the kind that made it;
 *     only accepted changes enter `steps`.
 *
 * A `session/turn` is judged in the same pass, against the author **at that point in the
 * sequence** — the one the session records before it produced — and never against the author the
 * whole ledger ends with:
 *   1 a turn under a session nobody had claimed yet is `no-author`;
 *   2 a turn at an older generation than the one held then is `stale-epoch`, the author’s own
 *     older generation included;
 *   3 a turn from a different end at a higher generation is `not-author`;
 *   4 otherwise it is accepted, payload and all.
 * So the guard the writer runs and the fold the reader runs answer the same question about the
 * same instant from the same facts, and a turn that got past the guard anyway does not vanish: it
 * lands in `rejectedTurns` with its reason.
 * @param records - every record read from the log, in any order.
 * @returns the current author per session, the accepted chain, the refusals, and the turns.
 */
/** The mutable state of {@link projectSessions}: the authors, refusals and turns folded so far. */
interface SessionsFoldState {
  owners: Map<string, SessionOwner>
  steps: SessionStep[]
  refused: SessionRefusal[]
  turns: AdoptedTurn[]
  rejectedTurns: RejectedTurn[]
  malformed: number
}

function emptySessionsFold(): SessionsFoldState {
  return { owners: new Map(), steps: [], refused: [], turns: [], rejectedTurns: [], malformed: 0 }
}

function foldSessions(state: SessionsFoldState, records: readonly ControlRecord[]): void {
  // A session is addressed by the id its payload carries, with the subject as the fallback: our own
  // builders write both, and a producer that writes only one of them must still land on the session
  // it named rather than in a bucket of its own. Same reading the lock table gives its task id.
  const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
  for (const record of orderedRecords(records)) {
    if (record.kind === TURN_KIND) {
      const said = record.payload as { session?: unknown, end?: unknown, epoch?: unknown, at?: unknown, text?: unknown } | undefined
      const session = text(said?.session) ?? text(record.subject)
      const end = text(said?.end)
      const rawEpoch = said?.epoch
      const rawAt = said?.at
      const spoken = said?.text
      // A turn whose own fields this build cannot read is not a turn fact: it is counted, not
      // attributed. `text` is the one field that may legitimately be empty.
      const usableTurn = session !== null && end !== null && typeof rawEpoch === 'number' && Number.isSafeInteger(rawEpoch) && typeof rawAt === 'number' && Number.isFinite(rawAt) && typeof spoken === 'string'
      if (!usableTurn) {
        state.malformed += 1
        state.rejectedTurns.push(session === null
          ? { session: null, end: null, epoch: 0, seq: record.seq, reason: 'malformed' }
          : { session, end, epoch: typeof rawEpoch === 'number' && Number.isSafeInteger(rawEpoch) ? rawEpoch : 0, seq: record.seq, reason: 'malformed' })
        continue
      }
      const epoch = rawEpoch as number
      const reason = turnReason(state.owners.get(session) ?? null, end, epoch)
      if (reason !== null) state.rejectedTurns.push({ session, end, epoch, seq: record.seq, reason })
      else state.turns.push({ session, end, epoch, text: spoken as string, at: rawAt as number, seq: record.seq })
      continue
    }
    if (record.kind !== SESSION_KIND && record.kind !== HANDOFF_KIND) continue
    const by: 'claim' | 'handoff' = record.kind === HANDOFF_KIND ? 'handoff' : 'claim'
    const payload = record.payload as { session?: unknown, end?: unknown, from?: unknown, to?: unknown, epoch?: unknown, at?: unknown } | undefined
    const session = text(payload?.session) ?? text(record.subject)
    const end = by === 'claim' ? text(payload?.end) : text(payload?.to)
    const from = by === 'handoff' ? text(payload?.from) : null
    const rawEpoch = payload?.epoch
    const rawAt = payload?.at
    const usable = session !== null && end !== null && typeof rawEpoch === 'number' && Number.isSafeInteger(rawEpoch) && typeof rawAt === 'number' && Number.isFinite(rawAt) && (by === 'claim' || from !== null)
    if (!usable) {
      state.malformed += 1
      state.refused.push(session === null
        ? { session: null, end: null, epoch: 0, seq: record.seq, reason: 'malformed', by }
        : { session, end, epoch: typeof rawEpoch === 'number' && Number.isSafeInteger(rawEpoch) ? rawEpoch : 0, seq: record.seq, reason: 'malformed', by })
      continue
    }
    const epoch = rawEpoch as number
    const at = rawAt as number
    const held = state.owners.get(session) ?? null
    if (held === null && epoch < 1) {
      state.malformed += 1
      state.refused.push({ session, end, epoch, seq: record.seq, reason: 'malformed', by })
      continue
    }
    if (held !== null && epoch <= held.epoch) {
      state.refused.push({ session, end, epoch, seq: record.seq, reason: 'stale-epoch', by })
      continue
    }
    if (by === 'handoff') {
      if (held === null || from !== held.end) {
        state.refused.push({ session, end, epoch, seq: record.seq, reason: 'not-owner', by })
        continue
      }
      if (epoch !== held.epoch + 1) {
        state.refused.push({ session, end, epoch, seq: record.seq, reason: 'epoch-gap', by })
        continue
      }
    }
    const step: SessionStep = { session, end, epoch, at, seq: record.seq, by }
    state.steps.push(step)
    state.owners.set(session, step)
  }
}

function finishSessions(state: SessionsFoldState): SessionsState {
  return {
    owners: [...state.owners.values()].sort((left, right) => (left.session < right.session ? -1 : left.session > right.session ? 1 : 0)),
    steps: state.steps,
    refused: state.refused,
    malformed: state.malformed,
    turns: [...state.turns].sort(bySessionThenSeq),
    rejectedTurns: [...state.rejectedTurns].sort(bySessionThenSeq),
  }
}

export function projectSessions(records: readonly ControlRecord[]): SessionsState {
  const state = emptySessionsFold()
  foldSessions(state, records)
  return finishSessions(state)
}

/**
 * The author of one session, or null when nobody ever claimed it.
 * @param state - a folded state.
 * @param session - the session to ask about.
 * @returns the current author, or null.
 */
export function sessionOwner(state: TeamState, session: string): SessionOwner | null {
  return state.sessions.owners.find((row) => row.session === session) ?? null
}

/** Whether one end may continue one session, with everything it was decided from. */
export interface ContinueVerdict {
  /** Whether the caller may write. */
  readonly ok: boolean
  /** Why. */
  readonly reason: 'none' | 'ok' | 'owned-by-other' | 'stale-epoch' | 'silent-owner'
  /** The ledger's current author, or null when there is none. Always present. */
  readonly owner: string | null
  /** The ledger's current generation, or null when there is none. Always present. */
  readonly epoch: number | null
}

/**
 * Decide whether one end may continue one session at one instant.
 *
 * The precedence is fixed and total, and it is the same shape the fold applies: nothing owned means
 * the first claim is legitimate; a generation at or below the held one is stale whatever else is
 * true; the current author continuing at a higher generation is the ordinary case; and a different
 * end may take over **only** from an author that is silent — which needs the caller to name how long
 * silence has to last. Silence alone is not death: an end that never beat reads `unknown`, not
 * `unhealthy`, and its session is not for the taking. That is the same rule, from the same
 * function, that {@link claimable} follows about a lock.
 *
 * `owner` and `epoch` are the ledger's current authorship in every answer — the state the
 * request was judged against — so a caller never has to re-read the fold to learn what it lost to.
 * @param state - a folded state.
 * @param session - the session to continue.
 * @param end - the end asking to write it.
 * @param epoch - the generation it asks at.
 * @param now - the instant, in milliseconds.
 * @param options - how long an author may go silent before another end may take over. Omitted means
 * no takeover is allowed at all.
 * @returns the verdict.
 */
export function mayContinue(state: TeamState, session: string, end: string, epoch: number, now: number, options: { timeoutMs?: number }): ContinueVerdict {
  const held = sessionOwner(state, session)
  if (held === null) return { ok: true, reason: 'none', owner: null, epoch: null }
  if (epoch <= held.epoch) return { ok: false, reason: 'stale-epoch', owner: held.end, epoch: held.epoch }
  if (end === held.end) return { ok: true, reason: 'ok', owner: held.end, epoch: held.epoch }
  // `isQuarantined` is the one place that answers "did this end beat and then go quiet": written
  // again here it would be a second liveness rule, and the two would drift apart.
  const silent = options.timeoutMs !== undefined && isQuarantined(state, held.end, now, { timeoutMs: options.timeoutMs })
  return silent
    ? { ok: true, reason: 'silent-owner', owner: held.end, epoch: held.epoch }
    : { ok: false, reason: 'owned-by-other', owner: held.end, epoch: held.epoch }
}

/**
 * Whether one end may write one session at one generation.
 *
 * This is the whole anti-fork rule in one boolean: the author and the generation must both match
 * what the ledger holds. Two ends that each believe they own one session cannot both be right, so
 * exactly one of them reads true — and every other reader only has to ask this.
 * @param state - a folded state.
 * @param session - the session.
 * @param end - the end asking.
 * @param epoch - the generation it writes at.
 * @returns whether it may write.
 */
export function mayWrite(state: TeamState, session: string, end: string, epoch: number): boolean {
  const held = sessionOwner(state, session)
  return held !== null && held.end === end && held.epoch === epoch
}

/**
 * Every accepted ownership change of one session, in sequence order.
 *
 * The chain starts at the beginning: its first entry is usually the initial `claim` that took the
 * session from nobody, and every entry after it is either a `claim` that took over or a `handoff`
 * from the author before it. Leaving the initial claim out would make every caller add the one
 * special case the chain exists to answer — where authorship started and how it moved.
 * @param state - a folded state.
 * @param session - the session to read.
 * @returns the accepted changes; refusals are not among them.
 */
export function continuations(state: TeamState, session: string): readonly SessionStep[] {
  return state.sessions.steps.filter((step) => step.session === session)
}

/** What one write to the turn channel did. */
export interface AppendTurnOutcome {
  /** Whether a `session/turn` record was appended. */
  readonly appended: boolean
  /** `ok` when it was, otherwise the reason the shared verdict gave. */
  readonly reason: string
  /** The sequence the appended record was given, or null when nothing was appended. */
  readonly seq: number | null
}

/**
 * The write face's reason for refusing, read off the verdict the query face already made.
 *
 * Two of `mayContinue`'s answers are permissions, and neither is a permission to write a turn:
 * with no author at all it answers `none` — "the first claim is legitimate", which is about
 * claiming, not about speaking — and for the author continuing it answers `ok`, which is true of
 * the session and not of the generation this turn is written at. An author that speaks one
 * generation ahead of the record is refused as `unrecorded-epoch`: the generation it writes at is
 * not the one the ledger holds, and calling that `epoch-gap` would give one name two meanings —
 * the handoff's gap is a generation that was skipped, not one that was never taken.
 * @param verdict - what `mayContinue` answered.
 * @returns the reason to report.
 */
function writeRefusalReason(verdict: ContinueVerdict): string {
  if (!verdict.ok) return verdict.reason
  return verdict.reason === 'none' ? 'none' : 'unrecorded-epoch'
}

/**
 * Write one turn, if the ledger says this end may — and append nothing at all when it does not.
 *
 * This is the write face of the same fact {@link mayWrite} answers on the read side. The permission
 * is `mayWrite` and the reason is `mayContinue`'s: both are the query face, called rather than
 * re-derived. A guard with its own copy of the rule is the defect this round exists to prevent, and
 * a guard that only reported a verdict would leave the other half of the claim untested — a refused
 * write has to leave the ledger exactly as it was, which is what the gate reads.
 *
 * A turn that is not shaped like a turn throws, the same way every builder here throws, before any
 * judgement is made: an invalid request is a caller error, not a refusal to report.
 *
 * `now` and `timeoutMs` are optional and only reach `mayContinue`; without `timeoutMs` no takeover
 * is read, exactly as everywhere else. `at` is the instant written into the record, and the one
 * clock read in this module is the default for it — a caller that needs reproducibility passes one.
 * @param log - the control log to append to. Nothing else is written.
 * @param state - the folded state the permission is read from.
 * @param turn - who speaks, in which session, at which generation, saying what.
 * @param options - the clock, the silence threshold, and the instant to stamp.
 * @returns whether a record was appended, why, and its sequence.
 */
export async function appendTurn(log: ControlLog, state: TeamState, turn: SessionTurn, options?: { now?: number, timeoutMs?: number, at?: number }): Promise<AppendTurnOutcome> {
  const record = turnRecord(turn, options?.at ?? Date.now())
  const verdict = mayContinue(state, turn.session, turn.end, turn.epoch, options?.now ?? 0, options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
  if (!mayWrite(state, turn.session, turn.end, turn.epoch)) return { appended: false, reason: writeRefusalReason(verdict), seq: null }
  const seq = await log.append(record)
  return { appended: true, reason: 'ok', seq }
}
/* ------------------------------------------------------------------------------------------------
 * Cross-end teams: a member that runs somewhere else.
 *
 * 《DSH LINK.md》§3 ③, "borrow B's transit to attach an Agent running on B to the Team", has one
 * decidable core: a member can run on another end, this team reaches it through a chain of hops, and
 * work may be handed to it exactly when the whole chain AND the member itself are alive right now.
 * None of this runs anything on the other device: it is the routing fact and the verdict about it.
 */

/**
 * The record kind one end appends to say where a member runs and how to reach it.
 *
 * The absence of this fact is a reading, not a gap: a member with no host fact runs **here**, which
 * is how every ledger written before this kind existed is to be read. A missing fact is never
 * "unreachable" — that is what a broken chain is, and it is reported as one.
 */
export const HOST_KIND = 'member/host'

/**
 * Build a host record.
 * @param memberId - the member being hosted. Non-empty.
 * @param end - the end it actually runs on. Non-empty.
 * @param via - the next hop towards the end reading this, or null for a directly attached member.
 * @param at - the instant, in milliseconds. Passed in; no clock is read here.
 * @returns the record to append, without a sequence.
 */
export function hostRecord(memberId: string, end: string, via: string | null, at: number): { kind: string, subject: string, payload: { id: string, end: string, via: string | null, at: number } } {
  if (typeof memberId !== 'string' || memberId === '') throw new TypeError('hostRecord: memberId must be a non-empty string')
  if (typeof end !== 'string' || end === '') throw new TypeError('hostRecord: end must be a non-empty string')
  if (via !== null && (typeof via !== 'string' || via === '')) throw new TypeError('hostRecord: via must be null or a non-empty string')
  if (!Number.isFinite(at)) throw new TypeError('hostRecord: at must be a finite number of milliseconds')
  return { kind: HOST_KIND, subject: memberId, payload: { id: memberId, end, via, at } }
}

/** One host declaration, as the projection used it. */
export interface HostedMemberClaim {
  /** The end the member runs on, as the record declared it. */
  readonly end: string
  /** The next hop the record declared, or null for a directly attached member. */
  readonly via: string | null
  /** The instant the record carried, in milliseconds. */
  readonly at: number
  /** Sequence of the record. */
  readonly seq: number
  /** The writer that made the declaration. */
  readonly writer: string | null
}

/** Where one member runs, as the fold read it. */
export interface HostedMember {
  /** The member. */
  readonly id: string
  /** The end it runs on. */
  readonly end: string
  /** The next hop towards the reading end, or null when it is directly attached. */
  readonly via: string | null
  /** The instant the winning record carried, in milliseconds. */
  readonly at: number
  /** Sequence of the winning record. */
  readonly seq: number
  /** Which rule chose the winner: the records' own clocks, or arrival order when they cannot. */
  readonly resolvedBy: 'at' | 'seq'
  /** True when a superseded declaration disagreed about the end or the hop. */
  readonly contested: boolean
  /** The declarations this one superseded, newest first. A folded record is kept, never dropped. */
  readonly losers: readonly HostedMemberClaim[]
}

/** What the host records add up to. */
export interface HostingState {
  /** One row per member that declared a host, ordered by member id. */
  readonly hosts: readonly HostedMember[]
  /** How many host records carried no usable id, end or instant. */
  readonly malformed: number
}

/**
 * Fold host declarations into where each member runs.
 *
 * The winner between two declarations of one member is decided by {@link foldClaim} — the same one
 * implementation the task and member folds use, called and not re-derived: two copies of "which claim
 * wins" is how one fold came to answer completed while another answered pending for the same key.
 *
 * Records are folded in sequence order, and the rows come out ordered by member id, so two arrival
 * orders of one batch answer byte for byte the same question.
 * @param records - every record read from the log, in any order.
 * @returns where each member runs, and how many records could not be read at all.
 */
/** The mutable state of {@link projectHosting}: the winning host declaration per member. */
interface HostingFoldState {
  hosts: Map<string, HostedMember>
  malformed: number
}

function emptyHostingFold(): HostingFoldState {
  return { hosts: new Map(), malformed: 0 }
}

function foldHosting(state: HostingFoldState, records: readonly ControlRecord[]): void {
  const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
  for (const record of orderedRecords(records)) {
    if (record.kind !== HOST_KIND) continue
    const payload = record.payload as { id?: unknown, end?: unknown, via?: unknown, at?: unknown } | undefined
    const id = text(payload?.id) ?? text(record.subject)
    const end = text(payload?.end)
    const rawAt = payload?.at
    if (id === null || end === null || typeof rawAt !== 'number' || !Number.isFinite(rawAt)) {
      state.malformed += 1
      continue
    }
    const via = text(payload?.via)
    const previous = state.hosts.get(id)
    if (previous === undefined) {
      state.hosts.set(id, { id, end, via, at: rawAt, seq: record.seq, resolvedBy: 'seq', contested: false, losers: [] })
      continue
    }
    const folded = foldClaim({ at: previous.at, seq: previous.seq }, { at: rawAt, seq: record.seq })
    const winner = folded.incomingWins ? { end, via, at: rawAt, seq: record.seq, writer: record.actor ?? null } : { end: previous.end, via: previous.via, at: previous.at, seq: previous.seq, writer: null }
    const loser = folded.incomingWins ? { end: previous.end, via: previous.via, at: previous.at, seq: previous.seq, writer: null } : { end, via, at: rawAt, seq: record.seq, writer: record.actor ?? null }
    const disagrees = loser.end !== winner.end || loser.via !== winner.via
    state.hosts.set(id, {
      id,
      end: winner.end,
      via: winner.via,
      at: winner.at,
      seq: winner.seq,
      resolvedBy: folded.byAt ? 'at' : 'seq',
      contested: previous.contested || disagrees,
      losers: disagrees ? [loser, ...previous.losers] : previous.losers,
    })
  }
}

function finishHosting(state: HostingFoldState): HostingState {
  return { hosts: [...state.hosts.values()].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)), malformed: state.malformed }
}

export function projectHosting(records: readonly ControlRecord[]): HostingState {
  const state = emptyHostingFold()
  foldHosting(state, records)
  return finishHosting(state)
}

/** One member this end can reach, and the chain it takes. */
export interface Route {
  /** The member. */
  readonly member: string
  /** The end the member runs on. */
  readonly end: string
  /** The chain from this end to it: [localEnd, ..., end]. */
  readonly path: readonly string[]
  /** How many hops: path.length - 1. */
  readonly hops: number
}

/** One member this end cannot reach, and why. */
export interface RouteFailure {
  /** The member. */
  readonly member: string
  /** Why the chain does not reach it. */
  readonly reason: 'no-route' | 'path-cycle' | 'route-down'
  /** The chain walked before the answer was known; the last element is where it stopped. */
  readonly path: readonly string[]
  /** The ends that repeat when a path turns into a cycle, in the order they were walked. */
  readonly loop: readonly string[]
}

/** Where one member's route stands: a path, or a failure with the chain walked so far. */
interface Resolution {
  /** The chain, on success. */
  readonly path: readonly string[]
  /** Why the chain does not arrive, or null when it does. */
  readonly failure: RouteFailure | null
}

/** The host declaration of one member, or null when it never declared one (it runs here). */
function hostOf(state: TeamState, member: string): HostedMember | null {
  return state.hosting.hosts.find((row) => row.id === member) ?? null
}

/**
 * The member that represents one end: the row whose id is that end, else the first row hosted on it.
 *
 * Every hop is itself a host fact — the machine carries a member that stands for it, and that member's
 * via is the next hop. The excluded member keeps the target out of its own chain: the target's silence
 * is the assignment's member-silent, and reading it here as a dead transit hop would make that answer
 * unreachable.
 * @param state - a folded state.
 * @param end - the end to find a representative for.
 * @param exclude - the member being resolved, or null.
 * @returns the representative, or null when no row stands for that end.
 */
function representativeOf(state: TeamState, end: string, exclude: string | null): HostedMember | null {
  const candidates = state.hosting.hosts.filter((row) => (row.id === end || row.end === end) && row.id !== exclude)
  if (candidates.length === 0) return null
  return candidates.find((row) => row.id === end) ?? candidates[0]
}

/**
 * Walk one member's chain towards this end.
 *
 * No host fact means the member runs here. A chain ends when a hop names this end. A hop that repeats
 * an end stops at the cycle instead of walking it (an answer, not a time-out). A hop with no host fact
 * that is not this end is no-route: nothing says it can be reached directly. And a hop whose
 * representative has stopped answering makes the whole chain unusable, reported up to that hop.
 * @param state - a folded state.
 * @param member - the member to resolve.
 * @param localEnd - the end asking.
 * @param livenesses - the members' livenesses at this instant, from {@link livenessOf}.
 * @returns the chain, or the failure with the chain walked so far.
 */
function resolveRoute(state: TeamState, member: string, localEnd: string, livenesses: ReadonlyMap<string, Liveness>): Resolution {
  const host = hostOf(state, member)
  const memberEnd = host === null ? localEnd : host.end
  if (memberEnd === localEnd) return { path: [localEnd], failure: null }
  const chain = [memberEnd]
  const seen = new Set([memberEnd])
  let via = host === null ? null : host.via
  for (;;) {
    const next = via === null ? localEnd : via
    if (next === localEnd) break
    if (seen.has(next)) {
      const walked = [localEnd, ...[...chain].reverse()]
      return { path: walked, failure: { member, reason: 'path-cycle', path: walked, loop: chain.slice(chain.indexOf(next)) } }
    }
    const representative = representativeOf(state, next, member)
    if (representative === null) {
      const walked = [localEnd, ...[...chain].reverse(), next]
      return { path: walked, failure: { member, reason: 'no-route', path: walked, loop: [] } }
    }
    chain.push(next)
    seen.add(next)
    via = representative.via
  }
  const path = [localEnd, ...[...chain].reverse()]
  for (const end of chain) {
    const representative = representativeOf(state, end, member)
    if (representative === null) continue
    if ((livenesses.get(representative.id) ?? 'unknown') !== 'unhealthy') continue
    const stopped = path.slice(0, path.indexOf(end) + 1)
    return { path: stopped, failure: { member, reason: 'route-down', path: stopped, loop: [] } }
  }
  return { path, failure: null }
}

/** Order members by id, then by the team they were folded under, so a table's order is a fact. */
const byMemberThenTeam = (left: { id: string, team: string | null }, right: { id: string, team: string | null }): number => {
  if (left.id !== right.id) return left.id < right.id ? -1 : 1
  const leftTeam = left.team ?? ''
  const rightTeam = right.team ?? ''
  return leftTeam < rightTeam ? -1 : leftTeam > rightTeam ? 1 : 0
}

/**
 * Every member this end can reach right now, ordered by member.
 *
 * Only the chains that arrive are here; the rest are in {@link routeFailures}, visible with the reason
 * and the hop they stopped at — a routing table that silently omits what it cannot reach cannot be
 * told from one that has nothing in it.
 * @param state - a folded state.
 * @param localEnd - the end asking.
 * @param now - the instant, in milliseconds.
 * @param options - the threshold a heartbeat must be within to count as alive.
 * @returns the reachable members and their chains.
 */
export function routes(state: TeamState, localEnd: string, now: number, options: { timeoutMs: number }): readonly Route[] {
  const livenesses = new Map(livenessOf(state, now, options).map((row) => [row.memberId, row.liveness]))
  const out: Route[] = []
  for (const row of [...state.members].sort(byMemberThenTeam)) {
    const resolved = resolveRoute(state, row.id, localEnd, livenesses)
    if (resolved.failure !== null) continue
    out.push({ member: row.id, end: resolved.path[resolved.path.length - 1], path: resolved.path, hops: resolved.path.length - 1 })
  }
  return out
}

/**
 * Every member this end cannot reach right now, with the reason and the hop it stopped at.
 * @param state - a folded state.
 * @param localEnd - the end asking.
 * @param now - the instant, in milliseconds.
 * @param options - the threshold a heartbeat must be within to count as alive.
 * @returns the unreachable members, ordered by member.
 */
export function routeFailures(state: TeamState, localEnd: string, now: number, options: { timeoutMs: number }): readonly RouteFailure[] {
  const livenesses = new Map(livenessOf(state, now, options).map((row) => [row.memberId, row.liveness]))
  const out: RouteFailure[] = []
  for (const row of [...state.members].sort(byMemberThenTeam)) {
    const resolved = resolveRoute(state, row.id, localEnd, livenesses)
    if (resolved.failure !== null) out.push(resolved.failure)
  }
  return out
}

/** Why work may or may not be handed to one member. */
export type AssignmentReason = 'ok' | 'local' | 'not-member' | 'not-in-team' | 'path-cycle' | 'no-route' | 'route-down' | 'member-silent'

/** What {@link assignThrough} answers, with the chain it was decided from. */
export interface AssignmentVerdict {
  /** Whether the work may be handed over. True only for ok and local. */
  readonly ok: boolean
  /** Why. */
  readonly reason: AssignmentReason
  /** The chain the answer was read along, or empty when the member was not the question. */
  readonly path: readonly string[]
  /** How many hops: path.length - 1. */
  readonly hops: number
  /** The ends that repeat when the failure is a cycle, else empty. */
  readonly loop: readonly string[]
}

/**
 * Decide whether work may be handed to one member of one team, right now.
 *
 * The precedence is fixed and total: not-member, not-in-team, path-cycle, no-route, route-down,
 * member-silent, then local, then ok. The chain is judged before the member's own heartbeat, so "the
 * road is broken" and "the member went quiet" stay two answers; and a member that runs here needs no
 * heartbeat at all — asking a member on this machine to prove it is alive is how a healthy local team
 * comes to look empty.
 *
 * Silence alone is not death anywhere else in this layer, and here it is not either: a member that
 * never beat reads unknown, which is not alive, so it is member-silent — exactly as a member that beat
 * and then went quiet is.
 * @param state - a folded state.
 * @param team - the team the work belongs to.
 * @param member - the member to hand it to.
 * @param localEnd - the end asking.
 * @param now - the instant, in milliseconds.
 * @param options - the threshold a heartbeat must be within to count as alive.
 * @returns the verdict.
 */
export function assignThrough(state: TeamState, team: string, member: string, localEnd: string, now: number, options: { timeoutMs: number }): AssignmentVerdict {
  const inTeam = state.members.some((row) => row.id === member && row.team === team)
  if (!inTeam) {
    const elsewhere = state.members.some((row) => row.id === member)
    return { ok: false, reason: elsewhere ? 'not-in-team' : 'not-member', path: [], hops: 0, loop: [] }
  }
  const livenesses = new Map(livenessOf(state, now, options).map((row) => [row.memberId, row.liveness]))
  const resolved = resolveRoute(state, member, localEnd, livenesses)
  if (resolved.failure !== null) {
    return { ok: false, reason: resolved.failure.reason, path: resolved.failure.path, hops: resolved.failure.path.length - 1, loop: resolved.failure.loop }
  }
  const path = resolved.path
  if (path.length === 1) return { ok: true, reason: 'local', path, hops: 0, loop: [] }
  if ((livenesses.get(member) ?? 'unknown') !== 'healthy') return { ok: false, reason: 'member-silent', path, hops: path.length - 1, loop: [] }
  return { ok: true, reason: 'ok', path, hops: path.length - 1, loop: [] }
}


/* ------------------------------------------------------------------------------------------------
 * R183: what an end can do, how much of it survives the path, and what leaves through our own facade.
 *
 * 《DSH LINK.md》md:374 asks the pairing moment to exchange a **capability manifest**; md:384-388 asks
 * the rights along a multi-hop path to be the **smallest** on it; md:376-382 asks for a face that lets
 * one end use another end's provider "as a local key", with failure mapped to "the service is gone".
 * Three separate things live here, and they stay separate:
 *
 * 1. `end/manifest` — one row per end, a ledger fact like every other declaration in this file. Its
 *    `via` is the next hop towards the end that reads it: the same word with the same meaning
 *    `member/host` already uses ({@link hostRecord}). The whole path is a fold over one fact per hop,
 *    never an array inside one row — two owners of "which way to that end" is the failure R44 removed.
 * 2. `effectiveCapabilities` — the decay along that path. Every hop must have a manifest and the
 *    answer is their intersection, so a smaller directory further out shrinks what arrives here. Pure:
 *    `now`, the threshold and the end asking are parameters, and no clock is read.
 * 3. `brokerKeys`/`brokerCall` — **our own** key space, `remote:<end>:<key>`. It is not the
 *    kernel's service broker and not an RPC provider (`TODO.md:70` says so in as many words); the
 *    README writes that sentence out, and the ruling that opened this face (R183 contract §6.3 #1)
 *    attaches it as an obligation rather than a preference.
 *
 * The permission meet that already exists (`intersectGrants`,
 * `plugins/dsh-lan-bridge/docs/MULTI-DEVICE-CONTRACT.md:51-59`) is a different question and is not
 * restated here: that one is the device face's meet over grants, this one is the capability list an
 * end puts on the ledger. Two measures with two owners, and neither recomputes the other.
 */

/**
 * The record kind one end appends to declare what it can do.
 *
 * An end is a device or a harness — the same namespace `member/host` already uses for `end`, so a
 * manifest never invents a second name for the machine a member runs on.
 */
export const MANIFEST_KIND = 'end/manifest'

/**
 * The manifest protocol versions this build speaks.
 *
 * Written down as data rather than implied by a branch, for the reason {@link SUPPORTED_PROTOCOLS}
 * states: the refusing side has to be able to read it, so a refused version comes back with the list
 * that would have been accepted instead of leaving the caller to guess. A version that is not here is
 * refused; it is never approximated.
 */
export const MANIFEST_PROTOCOLS: readonly string[] = ['dsh-link-device/1']

/**
 * A manifest was refused, with a code naming which rule was broken.
 *
 * The code is first in the message for the reason {@link DeclareRefusal} states: the tool registry
 * renders a thrown error as `Error: <message>`, so `MANIFEST_VIA: ...` names the rule while a bare
 * "invalid input" names nothing. A version refusal carries the supported list, the shape
 * {@link admitAdapter} answers with, so the two faces refuse a version the same way.
 */
export class ManifestRefusal extends Error {
  /** The stable code this refusal is named by. */
  readonly code: string
  /** The manifest versions this build speaks; empty on every refusal but a version one. */
  readonly supported: readonly string[]
  /**
   * @param code - the code, e.g. MANIFEST_VIA, or MANIFEST_NOT_AUTHORIZED when the row would be written by an end that is not the one it names (see {@link appendManifest}).
   * @param detail - what was refused, and what the caller should send instead.
   * @param supported - the version list, on a version refusal.
   */
  constructor(code: string, detail: string, supported: readonly string[] = []) {
    super(code + ': ' + detail)
    this.name = 'ManifestRefusal'
    this.code = code
    this.supported = supported
  }
}

/** One end's manifest, as the fold read it. */
export interface ManifestRow {
  /** The end this manifest is about. */
  readonly end: string
  /** The next hop towards the end reading this, or null when it is directly attached. */
  readonly via: string | null
  /** What kind of end it is, in the writer's own word (a harness name, a platform name). */
  readonly platform: string
  /** The manifest protocol version the row declared. */
  readonly protocolVersion: string
  /**
   * The capability names this row declares, sorted, without repeats, and **only** the ones the
   * capability registry recognises.
   *
   * The registry is the same authority `capability/state` folds ({@link projectRegistry}), which is why
   * a name nobody ever declared cannot enter this list: "capable of something this bus has never
   * heard of" is not a weaker claim than the bus can hold, it is an unreadable one, and a reader that
   * translated it into "does not have it" would be answering a different question.
   */
  readonly capabilities: readonly string[]
  /**
   * The names the row carried, exactly as the writer wrote them — the lossless half of the pair.
   *
   * `declared` is to `capabilities` what `declaredDeps` is to `deps` in the board fold: one
   * keeps the writer's own words, the other is the resolved reading. Nothing is dropped silently; a
   * name the registry does not recognise is visible here and counted in `malformed`.
   */
  readonly declared: readonly string[]
  /** The instant the writer stamped, in milliseconds. */
  readonly at: number
  /** Sequence of the winning row. */
  readonly seq: number
}

/** What the manifest rows add up to. */
export interface ManifestState {
  /** One row per end that declared a manifest, ordered by end. */
  readonly ends: readonly ManifestRow[]
  /**
   * How many manifest rows could not be read, or declared a capability the registry does not hold.
   *
   * A count rather than a list, like every other fold here; the row itself stays visible in
   * `ends`, so a reader never has to choose between "the record is gone" and "the record was odd".
   */
  readonly malformed: number
}

/** Read a non-empty string, or null. The one reader the manifest rows and the merge rows share. */
function textOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Read a non-empty NAME, or null - `textOf` plus the rule the declaring family already applies (R183, found by
 * gate 111's author): a string of blanks is not a name. `end` and `via` live in `member/host.end`'s namespace,
 * and a manifest whose end is `'   '` would key a row that no reader can ever address. The code a caller sees is
 * unchanged (`MANIFEST_END` / `MANIFEST_VIA`), so nothing that already refuses this is renamed.
 */
function nameOf(value: unknown): string | null {
  const text = textOf(value)
  return text !== null && text.trim() !== '' ? text : null
}

/**
 * The end one member runs on, as its own host fact declares it, or null when it declared none.
 *
 * Null means "here": the same reading `member/host` has everywhere else in this file, and the reason
 * a member with no row is never counted as running on a remote end.
 */
function hostedEndOf(state: TeamState, memberId: string): string | null {
  return state.hosting.hosts.find((row) => row.id === memberId)?.end ?? null
}

/**
 * The end one manifest row names: its own field, falling back to the record's subject, the reading
 * {@link projectManifests} makes. One reader, so a row that speaks for an end is spelled the same way
 * in the fold and in the two rules below.
 */
function manifestEndOf(row: { subject?: string | null, payload?: unknown }): string | null {
  const payload = row.payload as { end?: unknown } | undefined
  return textOf(payload?.end) ?? textOf(row.subject)
}

/**
 * Whether these rows hold a manifest the writer wrote **about itself** - the fact that answers "which
 * end is this writer?", the question MERGE_NOT_AUTHORIZED puts to the team fold (teamsLedBy(state,
 * log.writer)): two different rules, one question, and this is that question's manifest-side reader.
 *
 * A manifest row records the end it is about, never the writer that wrote it, so the answer cannot come
 * from {@link projectManifests} - that fold keeps the winning row per end and drops who wrote it. It is
 * read from the records, and the writer has to have spoken for itself: a row somebody else wrote naming
 * this writer is a claim about it, not this writer's own word (the page's section five-two: a batch
 * header is a declaration, not a proof).
 */
function declaresItself(rows: readonly { kind?: string, writer?: string | null, subject?: string | null, payload?: unknown }[], writer: string): boolean {
  return rows.some((row) => row?.kind === MANIFEST_KIND && (row.writer ?? null) === writer && manifestEndOf(row) === writer)
}

/**
 * The ends a ledger already holds: one its facts name, or one a member runs on.
 *
 * "Held" is deliberately the weak reading - a manifest row naming the end, or any member/host fact
 * putting a member on it - because it is only used to tell "an end this ledger has never heard of" from
 * "an end it already holds", and the fold that resolves where members run ({@link projectHosting}) is
 * the authority for the second half.
 */
function endsHeld(state: TeamState): Set<string> {
  const ends = new Set<string>()
  for (const row of state.manifests.ends) ends.add(row.end)
  for (const row of state.hosting.hosts) ends.add(row.end)
  return ends
}

/**
 * Build the record one end appends to declare its capabilities.
 *
 * Takes **one object of arguments**, the shape every refusing entry point in this file takes, because
 * the codes below name fields and a positional call could not report which of six positions was
 * unreadable. Nothing is written here: this is the record, and {@link appendManifest} is the write.
 *
 * `via` is refused rather than normalised when it names the end itself: a hop towards nowhere is not
 * a shorter path, and a fold that quietly read it as null would answer "directly attached" for a row
 * that said something else.
 * @param input - `{ end, via, platform, protocolVersion, capabilities, at }`.
 * @returns the record to append, without a sequence.
 * @throws ManifestRefusal with the code naming the rule that was broken.
 */
export function manifestRecord(input: unknown): { kind: string, subject: string, payload: { end: string, via: string | null, platform: string, protocolVersion: string, capabilities: string[], at: number } } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ManifestRefusal('MANIFEST_INPUT', 'this takes one object of arguments; got ' + describeValue(input))
  }
  const args = input as Record<string, unknown>
  const end = nameOf(args.end)
  if (end === null) throw new ManifestRefusal('MANIFEST_END', 'end is required and must be a non-empty name; got ' + describeValue(args.end ?? null))
  // The hop is read before the platform, so `via` pointing at the end itself is named as the hop problem
  // it is rather than surfacing as some other field's refusal.
  const rawVia = args.via
  let via: string | null = null
  if (rawVia !== null && rawVia !== undefined) {
    const hop = nameOf(rawVia)
    if (hop === null) throw new ManifestRefusal('MANIFEST_VIA', 'via must be null or a non-empty end name; got ' + describeValue(rawVia))
    if (hop === end) throw new ManifestRefusal('MANIFEST_VIA', 'via ' + describeValue(hop) + ' names the end itself; a hop towards nowhere is not a shorter path, use null when it is this end')
    via = hop
  }
  const platform = textOf(args.platform)
  if (platform === null) throw new ManifestRefusal('MANIFEST_PLATFORM', 'platform is required and must be a non-empty string; got ' + describeValue(args.platform ?? null))
  const rawVersion = args.protocolVersion
  const version = textOf(rawVersion)
  if (version === null || !MANIFEST_PROTOCOLS.includes(version)) {
    throw new ManifestRefusal('MANIFEST_VERSION', 'protocolVersion ' + describeValue(rawVersion ?? null) + ' is not one this build speaks; supported: ' + MANIFEST_PROTOCOLS.join(', '), [...MANIFEST_PROTOCOLS])
  }
  const listed = args.capabilities
  if (!Array.isArray(listed) || listed.length === 0) {
    throw new ManifestRefusal('MANIFEST_CAPABILITY', 'capabilities must be a non-empty array of names; got ' + describeValue(listed ?? null))
  }
  const names: string[] = []
  for (const entry of listed) {
    if (typeof entry !== 'string' || !DECLARED_NAME.test(entry)) {
      throw new ManifestRefusal('MANIFEST_CAPABILITY', 'capabilities carries ' + describeValue(entry) + ', which is not a name; use 1-64 characters from letters, digits and . _ - : @, starting with a letter or a digit')
    }
    names.push(entry)
  }
  const at = args.at
  if (typeof at !== 'number' || !Number.isFinite(at)) {
    throw new ManifestRefusal('MANIFEST_AT', 'at must be a finite number of milliseconds; got ' + describeValue(at ?? null))
  }
  return { kind: MANIFEST_KIND, subject: end, payload: { end, via, platform, protocolVersion: version, capabilities: [...new Set(names)].sort(), at } }
}

/** What {@link appendManifest} wrote, and what the ledger folds to afterwards. */
export interface ManifestAppend {
  /** The sequence the row was given. */
  readonly seq: number
  /** The kind written: `end/manifest`. */
  readonly kind: string
  /** The record's subject: the end. */
  readonly subject: string
  /** The end, as the row carries it. */
  readonly end: string
  /** The next hop written, or null. */
  readonly via: string | null
  /** The platform written. */
  readonly platform: string
  /** The version written. */
  readonly protocolVersion: string
  /** The capability names written, sorted and deduplicated. */
  readonly capabilities: readonly string[]
  /** The instant written. */
  readonly at: number
  /** The row as the ledger folded it back, or null when the fold could not read what was just written. */
  readonly folded: ManifestRow | null
}

/**
 * Append one end's manifest, after checking its names against the authority that owns them.
 *
 * The check needs a folded state and the append needs the log, which is why this is a write rather
 * than a builder: **the closed set of capability names is the registry's** ({@link projectRegistry}),
 * and a builder that held no state would have to accept a name nobody declared — the guess this
 * project refuses everywhere else. A refusal happens before the append, so a refused call leaves the
 * ledger byte for byte as it was.
 * @param state - the fold the names are checked against.
 * @param log - the ledger the row is appended to.
 * @param input - the manifest, as {@link manifestRecord} reads it.
 * @returns the row, and the fold's own reading of it.
 * @throws ManifestRefusal with MANIFEST_CAPABILITY when a name is not in the registry, or with
 * MANIFEST_NOT_AUTHORIZED when this ledger knows which end its writer is and the row names an end it
 * holds nothing about (one row, one writer: see the check above the append).
 */
export async function appendManifest(state: TeamState, log: ControlLog, input: unknown): Promise<ManifestAppend> {
  const draft = manifestRecord(input)
  const unknown = draft.payload.capabilities.filter((name) => membersWith(state, name).length === 0)
  if (unknown.length > 0) {
    throw new ManifestRefusal('MANIFEST_CAPABILITY', 'these names are not in the capability registry, so no end can be read as offering them: '
      + unknown.map((name) => describeValue(name)).join(', ')
      + '; declare them with the capability producer first (the registry is the only authority for what a capability is called)')
  }
  // One row, one writer. An end/manifest row may only be written by the end it names, and this face can
  // check it before the row exists: the ledger refuses only where it knows which end its writer is - a
  // manifest row the writer wrote about itself - because with no such row there is nothing to compare and
  // a refusal would be the guess this project refuses everywhere else (the shape MERGE_NOT_AUTHORIZED
  // reads out of the team fold). What is left to refuse is a row that would put an end nobody has ever
  // held onto this ledger while standing in for it: an end the ledger already holds (a manifest row naming
  // it, or a member running on it) is the honest gathering shape a ledger recording facts it was told has
  // always had. The refusal happens before the append, so a refused call leaves the ledger byte for byte
  // as it was.
  const end = draft.payload.end
  if (end !== log.writer && declaresItself(log.replay(), log.writer) && endsHeld(state).has(end) !== true) {
    throw new ManifestRefusal('MANIFEST_NOT_AUTHORIZED', 'this ledger knows its writer (' + describeValue(log.writer) + ') as an end, and ' + describeValue(end)
      + ' is an end it holds nothing about: no manifest row names it and no member runs on it. A manifest row may only be written by the end it names, so this row has to come from that end (its own log, its own row) or that end has to be held first - a member/host fact putting one of its members on it')
  }
  const seq = await log.append({ ...draft, actor: draft.payload.end })
  // Read back from the ledger rather than assembled from the intent, the rule R182's peer tools were
  // fixed to follow: an answer that says more than the ledger holds is a model reading a fact nobody wrote.
  const folded = projectManifests(log.replay()).ends.find((row) => row.end === draft.payload.end) ?? null
  return {
    seq,
    kind: draft.kind,
    subject: draft.subject,
    end: draft.payload.end,
    via: draft.payload.via,
    platform: draft.payload.platform,
    protocolVersion: draft.payload.protocolVersion,
    capabilities: draft.payload.capabilities,
    at: draft.payload.at,
    folded,
  }
}

/**
 * Fold manifest rows into one row per end.
 *
 * By `seq`, like every fold here: the highest sequence for an end wins, so the same rows arranged
 * differently answer byte for byte the same table. The capability names are settled by
 * {@link projectRegistry} over the same records — one authority, read once — and a row that carries a
 * name the registry does not hold counts in `malformed` while still landing in `ends` with its own
 * words in `declared`.
 * @param records - every record read from the log, in any order.
 * @returns one row per declaring end, ordered by end, and how many rows were unreadable or odd.
 */
/** The mutable state of {@link projectManifests}: the winning row per end, folded so far. */
interface ManifestsFoldState {
  latest: Map<string, ManifestRow>
  /** Rows whose own shape could not be read at all, counted as they were read. */
  unreadable: number
}

function emptyManifestsFold(): ManifestsFoldState {
  return { latest: new Map(), unreadable: 0 }
}

/**
 * Step the manifest fold.
 *
 * Capability names are NOT filtered here: a name is readable only when the registry knows it, and
 * the registry is read as one final authority in {@link finishManifests}. Filtering during the step
 * would make a row's readability depend on whether a later declaration had already been folded —
 * the one dependency that would stop this fold from being resumable from a checkpoint.
 */
function foldManifests(state: ManifestsFoldState, records: readonly ControlRecord[]): void {
  for (const record of orderedRecords(records)) {
    if (record.kind !== MANIFEST_KIND) continue
    const payload = record.payload as { end?: unknown, via?: unknown, platform?: unknown, protocolVersion?: unknown, capabilities?: unknown, at?: unknown } | undefined
    const end = textOf(payload?.end) ?? textOf(record.subject)
    const platform = textOf(payload?.platform)
    const version = textOf(payload?.protocolVersion)
    const at = payload?.at
    const rawVia = payload?.via
    const via = rawVia === null || rawVia === undefined ? null : textOf(rawVia)
    if (end === null || platform === null || version === null || typeof at !== 'number' || !Number.isFinite(at) || (rawVia !== null && rawVia !== undefined && via === null)) {
      state.unreadable += 1
      continue
    }
    const listed = Array.isArray(payload?.capabilities)
      ? payload.capabilities.flatMap((entry) => (textOf(entry) === null ? [] : [entry as string]))
      : []
    const declared = [...new Set(listed)].sort()
    const previous = state.latest.get(end)
    if (previous !== undefined && previous.seq > record.seq) continue
    state.latest.set(end, { end, via, platform, protocolVersion: version, capabilities: declared, declared, at, seq: record.seq })
  }
}

/**
 * Materialise the manifest table against the registry as it stands now.
 *
 * A declared name the registry never held is unreadable, and the row counts as malformed for it —
 * computed here, from the final registry, so the same rows answer the same way whether they were
 * read in one batch or resumed from a checkpoint.
 */
function finishManifests(state: ManifestsFoldState, known: ReadonlySet<string>): ManifestState {
  const ends: ManifestRow[] = [...state.latest.values()]
    .map((row) => ({
      end: row.end,
      via: row.via,
      platform: row.platform,
      protocolVersion: row.protocolVersion,
      capabilities: row.declared.filter((name) => known.has(name)),
      declared: row.declared,
      at: row.at,
      seq: row.seq,
    }))
    .sort((left, right) => (left.end < right.end ? -1 : left.end > right.end ? 1 : 0))
  const unreadable = state.unreadable
  return { ends, malformed: unreadable + ends.filter((row) => row.capabilities.length !== row.declared.length).length }
}

export function projectManifests(records: readonly ControlRecord[]): ManifestState {
  const state = emptyManifestsFold()
  foldManifests(state, records)
  return finishManifests(state, new Set(Object.keys(projectRegistry(records).byCapability)))
}

/** Why one hop of a capability path contributed nothing. Only these three words, and each means one thing. */
export type CapabilityMissCode = 'NO_MANIFEST' | 'PEER_SILENT' | 'ROUTE_DOWN'

/** One hop that stopped a capability path, named. */
export interface CapabilityMiss {
  /** The end that stopped it. */
  readonly hop: string
  /** Why. `NO_MANIFEST`: no row. `PEER_SILENT`: the end being asked went quiet. `ROUTE_DOWN`: a relay on the way stopped answering. */
  readonly code: CapabilityMissCode
}

/** What {@link effectiveCapabilities} answers, with the chain it was decided along. */
export interface CapabilityReading {
  /** The end asked about, echoed. */
  readonly end: string
  /** The chain walked, from the end reading this to the end asked about; its last element is where it stopped. */
  readonly path: readonly string[]
  /** The capability names that survive every hop. Empty whenever {@link CapabilityReading.missing} is not. */
  readonly capabilities: readonly string[]
  /** The hop that stopped the chain, when one did. */
  readonly missing: readonly CapabilityMiss[]
  /** The highest sequence the fold this was read from reached. */
  readonly through: number
}

/** What a capability reading needs. */
export interface CapabilityOptions {
  /** How long an end may go without a beat. The boundary is `sinceMs >= timeoutMs`: the threshold counts as out. */
  readonly timeoutMs: number
  /**
   * The end asking, when the caller knows it.
   *
   * Given, the chain is the whole road **including this end** — `[localEnd, ..., end]`, the shape
   * {@link routes} answers with — and this end's own manifest is a hop like any other, because an end
   * that never said what it can do cannot be the near end of a quoted capability. Omitted, the chain
   * starts at the furthest hop that declared one. Both readings are the same walk; only the near end
   * differs, and the parameter says which near end the caller meant.
   */
  readonly localEnd?: string | null
}

/**
 * The capabilities one end offers, after every hop on the way to it.
 *
 * The path is resolved one hop at a time from the rows themselves, never from an array somebody wrote
 * into one row, and every hop must have a manifest: a chain is only as long as its facts. The answer is
 * the **intersection** of the hops' sets, so a smaller directory further out shrinks what arrives
 * here — that is the whole of md:384-388's decay, and it is a different measure from the device face's
 * grant meet.
 *
 * Silence and a broken road stay two answers, the rule R59 set: the end being asked going quiet is
 * `PEER_SILENT`, a relay on the way going quiet is `ROUTE_DOWN`, and the hop is named in
 * both. A member that never beat reads `unknown`, which is **not** silence here either — R40's rule,
 * and the reason a capability reading never has to time out. A chain that repeats a hop is answered
 * rather than walked: the repeat is where the road is down.
 *
 * Pure: `now`, `timeoutMs` and the chain come from the caller, and no clock is read.
 * @param state - a folded state.
 * @param end - the end whose capabilities are asked about.
 * @param now - the instant to decide at, in milliseconds.
 * @param options - the silence threshold, and the end asking when the caller knows it.
 * @returns the chain, the names that survive it, and the hop that stopped it when one did.
 */
export function effectiveCapabilities(state: TeamState, end: string, now: number, options: CapabilityOptions): CapabilityReading {
  if (typeof end !== 'string' || end === '') throw new TypeError('effectiveCapabilities: end must be a non-empty string')
  if (typeof now !== 'number' || !Number.isFinite(now)) throw new TypeError('effectiveCapabilities: now must be a finite number of milliseconds')
  const timeoutMs = options?.timeoutMs
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0) throw new TypeError('effectiveCapabilities: timeoutMs must be a finite number of milliseconds and not negative')
  const local = textOf(options?.localEnd ?? null)
  const byEnd = new Map(state.manifests.ends.map((row) => [row.end, row]))
  // Walk outwards from the end asked about, one `via` at a time. The walk stops at a hop with no row
  // (that hop is the answer), at a hop that repeats (a road that never arrives is down, not a wait),
  // and at the end reading this when the caller named it.
  const chain: string[] = []
  const seen = new Set<string>()
  let cursor: string | null = end
  while (cursor !== null) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    chain.push(cursor)
    if (local !== null && cursor === local) break
    const row = byEnd.get(cursor)
    if (row === undefined) break
    const via = row.via
    cursor = via === null ? null : via
  }
  // The near end joins the chain when the road arrives at it: a hop that declared no next hop hangs
  // off the end reading this, and that end's own manifest is the first hop of the road. It is NOT
  // appended when the walk stopped at a hop with no row: a chain broken in the middle never reaches
  // the reader, and a path that named it anyway would hide where the road stopped.
  const arrived = chain[chain.length - 1]
  if (local !== null && arrived !== undefined && arrived !== local && byEnd.get(arrived)?.via === null) {
    chain.push(local)
  }
  // Judge the chain from the near end outwards, and stop where it breaks: the path a caller is shown
  // is the road actually walked, with its last element being where the answer was decided.
  const livenesses = new Map(livenessOf(state, now, { timeoutMs }).map((reading) => [reading.memberId, reading.liveness]))
  const missing: CapabilityMiss[] = []
  const path: string[] = []
  const reached: ManifestRow[] = []
  for (const hop of [...chain].reverse()) {
    path.push(hop)
    const row = byEnd.get(hop)
    if (row === undefined) {
      missing.push({ hop, code: 'NO_MANIFEST' })
      break
    }
    reached.push(row)
    const representative = representativeOf(state, hop, null)
    if (representative !== null && (livenesses.get(representative.id) ?? 'unknown') === 'unhealthy') {
      missing.push({ hop, code: hop === end ? 'PEER_SILENT' : 'ROUTE_DOWN' })
      break
    }
  }
  const capabilities: string[] = []
  if (missing.length === 0 && reached.length > 0) {
    for (const name of reached[reached.length - 1].capabilities) {
      if (reached.every((row) => row.capabilities.includes(name))) capabilities.push(name)
    }
    capabilities.sort()
  }
  return { end, path, capabilities, missing, through: state.through }
}

/** One key in {@link brokerKeys}: a provider this end can name, on the end that offers it. */
export interface BrokerKeyRow {
  /** The key, `remote:<end>:<providerKey>`. Built here and nowhere else. */
  readonly key: string
  /** The end offering it. */
  readonly end: string
  /** The capability name, which is the key half after the end. */
  readonly providerKey: string
  /** The next hop towards that end, as the ledger's own row declares it, or null when it is directly attached. */
  readonly via: string | null
  /** Every name that survives the path to that end — the same set the keys of that end are drawn from. */
  readonly capabilities: readonly string[]
}

/**
 * The key one provider on one end is called by.
 *
 * Private on purpose: {@link brokerKeys} is the one generator of keys, and a second place that could
 * spell `remote:...` would be a second answer to "what is this key called". Inside this module the
 * lookup in {@link brokerCall} uses it too, so the format has exactly one definition.
 */
function brokerKeyOf(end: string, providerKey: string): string {
  return 'remote:' + end + ':' + providerKey
}

/**
 * Every provider this end may call, by key.
 *
 * The key space is the capability sets that survive the path: an end whose chain is broken, or whose
 * set did not survive the intersection, contributes nothing — a key that is listed is a key that
 * answers. The end reading this table is excluded when the caller names it, so "a remote provider" has
 * one owner: this table, which never holds this end's own capabilities. That is also why
 * {@link brokerCall} answers anything it cannot find in the same table.
 * @param state - a folded state.
 * @param now - the instant to decide at, in milliseconds.
 * @param options - the silence threshold, and the end asking.
 * @returns the keys, ordered by key.
 */
export function brokerKeys(state: TeamState, now: number, options: CapabilityOptions): readonly BrokerKeyRow[] {
  const local = textOf(options?.localEnd ?? null)
  const rows: BrokerKeyRow[] = []
  for (const manifest of state.manifests.ends) {
    if (local !== null && manifest.end === local) continue
    const reading = effectiveCapabilities(state, manifest.end, now, options)
    if (reading.missing.length > 0) continue
    if (reading.capabilities.length === 0) continue
    for (const name of reading.capabilities) {
      rows.push({ key: brokerKeyOf(manifest.end, name), end: manifest.end, providerKey: name, via: manifest.via, capabilities: reading.capabilities })
    }
  }
  return rows.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
}

/** The closed set of answers {@link brokerCall} gives. Outside it there is no verdict to give. */
export type BrokerCode = 'ok' | 'unknown-key' | 'no-provider' | 'provider-silent' | 'not-granted' | 'service-gone'

/** What {@link brokerCall} answers. */
export interface BrokerCallResult {
  /** The verdict. */
  readonly code: BrokerCode
  /** The key asked about, echoed. */
  readonly key: string
  /** The end the key names, or null when no row ever offered that key. */
  readonly end: string | null
  /** The capability the key names, or null when no row ever offered that key. */
  readonly providerKey: string | null
  /** Why the link is gone, when it is: the hop code that broke it, or `meet:<hop>` for the hop whose set it did not survive. */
  readonly reason?: string
}

/** What a broker call needs. */
export interface BrokerCallOptions {
  /** The instant to decide at, in milliseconds. */
  readonly now: number
  /** How long an end may go without a beat. */
  readonly timeoutMs: number
  /** The end asking. Required: "may I call this" is a question about two ends, not about a key alone. */
  readonly localEnd: string
}

/**
 * Decide one call against the key space.
 *
 * The precedence is fixed and total, and each answer means one thing:
 *
 * - `unknown-key` — no row ever offered this end and this name. Nothing is known about it, which is
 *   not the same as knowing it is gone.
 * - `service-gone` — the key was offered and is not usable now: the chain broke, the intersection
 *   dropped the name, or the end declared less than it used to. This is md:382's "the failure maps to
 *   the service disappearing", and it is paired with {@link brokerKeys} by construction: a key that is
 *   in that table is not answered this way at that instant.
 * - `not-granted` — the road is up and the two ends have no granted exchange in that direction.
 *   Whether two leads may talk is `mayExchange`"s question and it is called, never re-derived.
 * - `no-provider` — nobody **on that end** declares this capability, or nobody declaring it is
 *   answering ({@link mcpCall}'s `no-provider`, and its `unknown-tool` folded into the same answer: at
 *   this face "the name has no provider" and "nobody declaring it is answering" are one reply).
 * - `provider-silent` — a provider on that end is answering and this end cannot reach it
 *   ({@link mcpCall}'s `provider-silent`). Both words keep the meanings they have at that face, so one
 *   verdict does not acquire two definitions by being asked twice.
 * - `ok` — the road is up, the exchange is granted, and a healthy provider is reachable.
 *
 * Pure: nothing is appended, no provider is contacted, and no clock is read; `now` is a parameter.
 * @param state - a folded state.
 * @param key - the key, as {@link brokerKeys} spelled it.
 * @param now - the instant to decide at, in milliseconds.
 * @param options - the threshold and the end asking.
 * @returns the verdict, with the key and the names it resolved to.
 * @throws TypeError when the key is not a string, or the end asking is not named.
 */
export function brokerCall(state: TeamState, key: string, now: number, options: BrokerCallOptions): BrokerCallResult {
  if (typeof key !== 'string' || key === '') throw new TypeError('brokerCall: key must be a non-empty string, as brokerKeys spelled it')
  const local = textOf(options?.localEnd ?? null)
  if (local === null) throw new TypeError('brokerCall: localEnd must name the end asking; "may this end call that one" has no answer without it')
  // The lookup is by exact key against the rows' own words, so no key is ever split on a colon: a name
  // may contain one (the name grammar allows it), and a parser that guessed where the end ends would
  // answer about a different end for a name that happens to contain the separator.
  const offered = new Map<string, { end: string, providerKey: string }>()
  for (const manifest of state.manifests.ends) {
    for (const name of manifest.declared) offered.set(brokerKeyOf(manifest.end, name), { end: manifest.end, providerKey: name })
  }
  const hit = offered.get(key)
  if (hit === undefined) return { code: 'unknown-key', key, end: null, providerKey: null }
  const reading = effectiveCapabilities(state, hit.end, now, { timeoutMs: options.timeoutMs, localEnd: local })
  if (reading.missing.length > 0) {
    return { code: 'service-gone', key, end: hit.end, providerKey: hit.providerKey, reason: reading.missing[0].code }
  }
  if (!reading.capabilities.includes(hit.providerKey)) {
    // The road is up and the name did not survive it: the hop whose set lost it is named, because
    // "the service is gone" is only useful next to where it went.
    const lost = reading.path.find((hop) => (state.manifests.ends.find((row) => row.end === hop)?.capabilities ?? []).includes(hit.providerKey) === false) ?? hit.end
    return { code: 'service-gone', key, end: hit.end, providerKey: hit.providerKey, reason: 'meet:' + lost }
  }
  if (!mayExchange(state, local, hit.end)) return { code: 'not-granted', key, end: hit.end, providerKey: hit.providerKey }
  // The key says "THIS end offers this", so the end's own directory has to hold somebody who declares
  // it: a capability the registry knows and no member on that end provides is not a provider this key
  // can reach, and answering "ok" because somebody somewhere declares it would make the end in the key
  // decoration. The registry is still the authority for what the name means; this is the second half of
  // the same question, asked of the end the key names.
  const onEnd = membersWith(state, hit.providerKey).filter((id) => hostedEndOf(state, id) === hit.end)
  if (onEnd.length === 0) return { code: 'no-provider', key, end: hit.end, providerKey: hit.providerKey }
  const provider = mcpCall(state, hit.providerKey, now, { timeoutMs: options.timeoutMs, localEnd: local })
  if (provider.reason === 'ok') return { code: 'ok', key, end: hit.end, providerKey: hit.providerKey }
  // The two provider answers keep the meanings they have at the MCP face, which is what "reuse the
  // existing words" has to mean: no-provider is "none of the declarers is answering" there and here,
  // provider-silent is "a provider is answering and this end cannot reach it" there and here. The
  // third MCP answer, unknown-tool, is folded into no-provider rather than given a code of its own:
  // at this face "nobody declares the name" and "nobody declaring it is answering" are one answer to
  // "who would take this call", and the key space only offers names the registry holds anyway.
  if (provider.reason === 'provider-silent') return { code: 'provider-silent', key, end: hit.end, providerKey: hit.providerKey }
  return { code: 'no-provider', key, end: hit.end, providerKey: hit.providerKey }
}


/* ------------------------------------------------------------------------------------------------
 * R183: recruiting and being recruited — two Teams agreeing to become one tree.
 *
 * 《DSH LINK.md》md:274 asks that A can recruit B **and** that A can choose to be recruited by B, and
 * md:229 adds that a sub-team's lead may be any Agent at all. The tree itself already exists
 * (`team/state`, R37/R98); what did not exist was the act: a request, an answer, and the one rule
 * that keeps two answers to "who is whose parent" from ever being written.
 *
 * That rule is the whole design: **a merge never writes another team's `team/state`.** The party
 * being merged in writes its own row (its `parent` is the team taking it in), and `team/merge` only
 * records who authorized that. An applicant that offers to write the other side's parent is refused
 * by name, because a tree with two writers is a tree with two answers — the collision gates
 * `team-parent-arbitration` and `subagent-contention` already guard that shape, and this act must not
 * be the one that introduces it.
 *
 * The three disciplines are the handshake's, one for one (R182, `peer/state`): a request is not a
 * permission, a later `denied` clears an earlier `granted` because the higher sequence wins rather
 * than by a second mechanism, and **no merge without a handshake**: whether two leads may exchange is
 * `mayExchange`"s question, called and not re-derived.
 */

/**
 * The record kind one team appends to ask for a merge, or to answer one.
 *
 * The subject is the **asking** team, so one ordered pair has one address: `(from, to)`. The
 * direction is data, exactly as it is for a handshake, because a merge is not symmetric: @@"B joined
 * A"@@ is a different fact from @@@"A joined B"@@, and one row that carried both would have to be read
 * twice to answer once.
 */
export const MERGE_KIND = 'team/merge'

/**
 * Which way a merge runs.
 *
 * `join`: the asking team `from` is taken in by `to` (`from` becomes `to`'s child).
 * `absorb`: the asking team `from` takes `to` in (`to` becomes `from`'s child). Both
 * directions are md:274's two halves: recruiting, and choosing to be recruited.
 */
export type MergeMode = 'join' | 'absorb'

/** Where one merge stands. Only an agreement changes a tree; a request never does. */
export type MergeStateName = 'requested' | 'granted' | 'denied'

/**
 * A merge was refused, with a code naming which rule was broken.
 *
 * The codes are this family's own (`MERGE_*`) for the reason the handshake family states: a reader of
 * `MERGE_NOT_AUTHORIZED` learns that a merge would have written somebody else's parent, and a code
 * shared across three tool families would name none of them.
 */
export class MergeRefusal extends Error {
  /** The stable code this refusal is named by. */
  readonly code: string
  /**
   * @param code - the code, e.g. MERGE_NOT_AUTHORIZED.
   * @param detail - what was refused, and what the caller should send instead.
   */
  constructor(code: string, detail: string) {
    super(code + ': ' + detail)
    this.name = 'MergeRefusal'
    this.code = code
  }
}

/** One merge row, as the fold read it. */
export interface MergeRow {
  /** The asking team — the record's subject. */
  readonly from: string
  /** The team being asked. */
  readonly to: string
  /** Which way the merge runs. */
  readonly mode: MergeMode
  /** Where it stands. */
  readonly state: MergeStateName
  /** Who wrote it: the lead that authorized it (or asked). */
  readonly by: string
  /** The instant the writer stamped, in milliseconds. */
  readonly at: number
  /** Sequence of the row. */
  readonly seq: number
}

/** What the merge rows add up to. */
export interface MergeState {
  /**
   * Every readable row, in sequence order — the history, not the standing answer.
   *
   * Kept whole because the round that clears a grant is part of what happened: a table that held only
   * the winner could not answer "was this pair ever agreed", which is exactly the audit an agreement
   * about a team tree needs.
   */
  readonly merges: readonly MergeRow[]
  /** The winning row per ordered pair, ordered by `(from, to)` — the standing answer, and what {@link mayMerge} reads. */
  readonly pairs: readonly MergeRow[]
  /** How many merge rows could not be read. */
  readonly malformed: number
}

/**
 * Build a merge record.
 *
 * Takes one object of arguments, like the manifest builder and for the same reason: the refusals name
 * the field. This is the **only** place a merge row is built — the tools append what this returns, so
 * a tool cannot invent a spelling the fold would read differently.
 * @param input - `{ from, to, mode, state, by, at }`.
 * @returns the record to append, without a sequence.
 * @throws MergeRefusal with the code naming the rule that was broken.
 */
export function mergeRecord(input: unknown): { kind: string, subject: string, payload: { from: string, to: string, state: MergeStateName, mode: MergeMode, by: string, at: number } } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new MergeRefusal('MERGE_INPUT', 'this takes one object of arguments; got ' + describeValue(input))
  }
  const args = input as Record<string, unknown>
  const refuse = (code: string, detail: string): Error => new MergeRefusal(code, detail)
  const from = requiredName(args.from, 'from', 'MERGE_', refuse)
  const to = requiredName(args.to, 'to', 'MERGE_', refuse)
  const by = requiredName(args.by, 'by', 'MERGE_', refuse)
  if (from === to) {
    throw new MergeRefusal('MERGE_SELF', 'team ' + describeValue(from) + ' cannot merge with itself; name the team at the other end (a team cannot be its own parent)')
  }
  const mode = args.mode
  if (mode !== 'join' && mode !== 'absorb') {
    throw new MergeRefusal('MERGE_MODE', 'mode ' + describeValue(mode ?? null) + ' is not a direction; use join (the asking team is taken in) or absorb (the asking team takes the other in)')
  }
  const state = args.state
  if (state !== 'requested' && state !== 'granted' && state !== 'denied') {
    throw new MergeRefusal('MERGE_STATE', 'state ' + describeValue(state ?? null) + ' is not one of the three this vocabulary holds: requested, granted or denied')
  }
  const at = args.at
  if (typeof at !== 'number' || !Number.isFinite(at)) {
    throw new MergeRefusal('MERGE_AT', 'at must be a finite number of milliseconds; got ' + describeValue(at ?? null))
  }
  return { kind: MERGE_KIND, subject: from, payload: { from, to, state, mode, by, at } }
}

/**
 * Fold merge rows into the history and the standing answer.
 *
 * By `seq`, like every fold here: for one ordered pair the highest sequence wins, so a later
 * `denied` clears an earlier `granted` by the same rule that decides everything else, and the same
 * rows arranged differently fold byte for byte the same. The pair is ordered, so no direction is
 * folded onto its reverse.
 * @param records - every record read from the log, in any order.
 * @returns the history, the winner per ordered pair, and how many rows were unreadable.
 */
/** The mutable state of {@link projectMerges}: every readable merge row folded so far. */
interface MergesFoldState {
  rows: MergeRow[]
  malformed: number
}

function emptyMergesFold(): MergesFoldState {
  return { rows: [], malformed: 0 }
}

function foldMerges(state: MergesFoldState, records: readonly ControlRecord[]): void {
  for (const record of orderedRecords(records)) {
    if (record.kind !== MERGE_KIND) continue
    const payload = record.payload as { from?: unknown, to?: unknown, mode?: unknown, state?: unknown, by?: unknown, at?: unknown } | undefined
    const from = textOf(payload?.from) ?? textOf(record.subject)
    const to = textOf(payload?.to)
    const by = textOf(payload?.by)
    const at = payload?.at
    const mode = payload?.mode
    const stateName = payload?.state
    if (from === null || to === null || by === null || typeof at !== 'number' || !Number.isFinite(at)) { state.malformed += 1; continue }
    if (mode !== 'join' && mode !== 'absorb') { state.malformed += 1; continue }
    if (stateName !== 'requested' && stateName !== 'granted' && stateName !== 'denied') { state.malformed += 1; continue }
    state.rows.push({ from, to, mode, state: stateName, by, at, seq: record.seq })
  }
}

function finishMerges(state: MergesFoldState): MergeState {
  // Rows are accumulated in sequence order, so the last write for a pair is the winner.
  const winners = new Map<string, MergeRow>()
  for (const row of state.rows) winners.set(row.from + '->' + row.to, row)
  const pairs = [...winners.values()].sort((left, right) => {
    if (left.from !== right.from) return left.from < right.from ? -1 : 1
    return left.to < right.to ? -1 : left.to > right.to ? 1 : 0
  })
  return { merges: state.rows, pairs, malformed: state.malformed }
}

export function projectMerges(records: readonly ControlRecord[]): MergeState {
  const state = emptyMergesFold()
  foldMerges(state, records)
  return finishMerges(state)
}

/**
 * Whether two teams may merge, right now.
 *
 * Two facts, both already owned elsewhere: the pair must be **granted** (this fold), and the two leads
 * must be able to exchange at all ({@link mayExchange}, called and not re-derived). The second half is
 * not a formality — "先握手后合并" is the ruling's own wording — and keeping it here means a caller
 * holding only a folded state cannot get a "yes" that the handshake table would refuse.
 * @param state - a folded state.
 * @param from - the asking team.
 * @param to - the team being asked.
 * @returns true only when the pair is granted in that direction and the two may exchange.
 */
export function mayMerge(state: TeamState, from: string, to: string): boolean {
  if (!mayExchange(state, from, to)) return false
  return state.merges.pairs.find((pair) => pair.from === from && pair.to === to)?.state === 'granted'
}

/* ------------------------------------------------------------------------------------------------
 * Multi-platform agents: the adapter layer and the MCP face.
 *
 * 《DSH LINK.md》§2 has one decidable core: an Agent from another platform joins this bus only through
 * a **declared adapter**, speaking a **protocol version this build supports**, offering only the
 * capabilities the **capability registry** actually records for it. What cannot be recognised is
 * refused, never guessed at and never translated on the fly — the same discipline the rest of this
 * file follows.
 *
 * What this section is: admission, version negotiation, and the dispatch verdict. What it is not:
 * a real MCP transport (no JSON-RPC over stdio or HTTP), no tool execution, and no change to any
 * kernel-side Agent. Every function here is pure and writes nothing to the ledger; a caller that
 * wants a call recorded appends the record itself.
 */

/**
 * The record kind one adapter appends to declare itself.
 *
 * An adapter is also a member, and its subject is that member's id: its heartbeats, capability
 * declarations and host facts are the existing folds' business, so this layer needs no second
 * identity for the same thing.
 */
export const ADAPTER_KIND = 'adapter/state'

/**
 * The protocol versions this build speaks.
 *
 * Written down as data rather than implied by a branch, because the refusing side has to be able to
 * read it: a refusal carries this list, so a caller learns what would have been accepted instead of
 * guessing — and a version that is not here is refused rather than approximated.
 */
export const SUPPORTED_PROTOCOLS: readonly string[] = ['dsh-link-adapter/1']

/** The identity the MCP face answers initialization with. */
const MCP_SERVER_INFO: { readonly name: string, readonly version: string } = { name: 'dsh-link-collab', version: '1' }

/**
 * Build the record an adapter appends to declare itself.
 * @param adapterId - the adapter, which is also the member id it runs as. Non-empty.
 * @param platform - the platform it comes from. Non-empty.
 * @param protocolVersion - the version it speaks. Non-empty.
 * @param offers - the capabilities it claims to provide.
 * @returns the record to append, without a sequence.
 * @throws TypeError when the id, platform or version is not a non-empty string, or offers is not an
 * array.
 */
export function adapterRecord(adapterId: string, platform: string, protocolVersion: string, offers: readonly string[]): { kind: string, subject: string, payload: { id: string, platform: string, protocolVersion: string, offers: string[] } } {
  if (typeof adapterId !== 'string' || adapterId === '') throw new TypeError('adapterRecord: adapterId must be a non-empty string')
  if (typeof platform !== 'string' || platform === '') throw new TypeError('adapterRecord: platform must be a non-empty string')
  if (typeof protocolVersion !== 'string' || protocolVersion === '') throw new TypeError('adapterRecord: protocolVersion must be a non-empty string')
  if (!Array.isArray(offers)) throw new TypeError('adapterRecord: offers must be an array of capability names')
  return { kind: ADAPTER_KIND, subject: adapterId, payload: { id: adapterId, platform, protocolVersion, offers: sortedNames(offers) } }
}

/**
 * The capability names one declaration carries, sorted and deduplicated.
 *
 * Two declarations of the same thing have to produce the same bytes, or comparing a relayed copy with
 * a local one reports a difference that is only the order somebody typed the names in.
 * @param names - the names, as declared.
 * @returns the usable names, sorted, without repeats.
 */
function sortedNames(names: readonly unknown[]): string[] {
  return [...new Set(names.filter((name): name is string => typeof name === 'string' && name !== ''))].sort()
}

/** One adapter declaration, as a claim. */
export interface AdapterRowClaim {
  /** The platform the claim named. */
  readonly platform: string
  /** The protocol version the claim named. */
  readonly protocolVersion: string
  /** The capabilities the claim offered, sorted and deduplicated. */
  readonly offers: readonly string[]
  /** The instant the record carried, in milliseconds. */
  readonly at: number
  /** Sequence of the record. */
  readonly seq: number
  /** The writer that made the claim. */
  readonly writer: string | null
}

/** One adapter, as the fold read it. */
export interface AdapterRow {
  /** The adapter, which is also the member id it runs as. */
  readonly id: string
  /** The platform from the winning claim. */
  readonly platform: string
  /** The protocol version from the winning claim. */
  readonly protocolVersion: string
  /** The capabilities the winning claim offered. */
  readonly offers: readonly string[]
  /** The instant the winning record carried, in milliseconds. */
  readonly at: number
  /** Sequence of the winning record. */
  readonly seq: number
  /** Which rule chose the winner: the records' own clocks, or arrival order when they cannot. */
  readonly resolvedBy: 'at' | 'seq'
  /** True when a superseded declaration disagreed about the platform, the version or the offers. */
  readonly contested: boolean
  /** The declarations this one superseded, newest first. A folded record is kept, never dropped. */
  readonly losers: readonly AdapterRowClaim[]
}

/**
 * One declaration that could not be read at all.
 *
 * Visible rather than dropped: a refusal explains the absence of an adapter, and an absence with no
 * explanation cannot be told from a declaration that was never made.
 */
export interface AdapterRefusal {
  /** The adapter the record named, or null when it named none that could be read. */
  readonly id: string | null
  /** Why it was refused. Only one reason exists so far: the record's shape could not be read. */
  readonly reason: 'malformed'
  /** Sequence of the refused record. */
  readonly seq: number
}

/** What the adapter declarations add up to. */
export interface AdaptersState {
  /** One row per adapter, ordered by adapter id. */
  readonly adapters: readonly AdapterRow[]
  /** Declarations that could not be read, in sequence order. */
  readonly refused: readonly AdapterRefusal[]
  /** How many declarations were refused. */
  readonly malformed: number
}

/**
 * Read one adapter declaration, or null when the record cannot be read as one.
 *
 * A missing or wrongly typed id, platform or version is unreadable; so is an offers field that is not
 * an array. An **empty** platform or version is readable and is kept: an empty string is a fact
 * somebody wrote, and the admission judgement reports it as empty-platform rather than letting the
 * fold swallow it as a malformed record. Names in offers that are not non-empty strings are dropped:
 * they cannot name a capability, and inventing one is not this layer's business.
 * @param record - the record to read.
 * @returns the declaration, or null.
 */
function adapterClaimOf(record: ControlRecord): { id: string, platform: string, protocolVersion: string, offers: string[], at: number } | null {
  const payload = record.payload as { id?: unknown, platform?: unknown, protocolVersion?: unknown, offers?: unknown, at?: unknown } | undefined
  const subject = typeof record.subject === 'string' && record.subject !== '' ? record.subject : null
  const id = typeof payload?.id === 'string' && payload.id !== '' ? payload.id : subject
  if (id === null) return null
  if (typeof payload?.platform !== 'string') return null
  if (typeof payload?.protocolVersion !== 'string') return null
  if (!Array.isArray(payload?.offers)) return null
  const at = typeof payload.at === 'number' && Number.isFinite(payload.at) ? payload.at : record.at
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  return { id, platform: payload.platform, protocolVersion: payload.protocolVersion, offers: sortedNames(payload.offers), at }
}

/**
 * Fold adapter declarations into the adapters this ledger knows.
 *
 * The winner between two declarations of one adapter is decided by {@link foldClaim} — the same one
 * implementation the task, member, lock and host folds use, called and not re-derived. Records are
 * folded in sequence order and the rows come out ordered by adapter id, so two arrival orders of one
 * batch answer byte for byte the same question.
 * @param records - every record read from the log, in any order.
 * @returns the adapters, the refusals, and how many declarations were refused.
 */
/** The mutable state of {@link projectAdapters}: the winning declaration per adapter, folded so far. */
interface AdaptersFoldState {
  adapters: Map<string, AdapterRow>
  refused: AdapterRefusal[]
}

function emptyAdaptersFold(): AdaptersFoldState {
  return { adapters: new Map(), refused: [] }
}

function foldAdapters(state: AdaptersFoldState, records: readonly ControlRecord[]): void {
  for (const record of orderedRecords(records)) {
    if (record.kind !== ADAPTER_KIND) continue
    const claim = adapterClaimOf(record)
    if (claim === null) {
      const payload = record.payload as { id?: unknown } | undefined
      const subject = typeof record.subject === 'string' && record.subject !== '' ? record.subject : null
      const named = typeof payload?.id === 'string' && payload.id !== '' ? payload.id : subject
      state.refused.push({ id: named, reason: 'malformed', seq: record.seq })
      continue
    }
    const previous = state.adapters.get(claim.id)
    const incoming: AdapterRowClaim = { platform: claim.platform, protocolVersion: claim.protocolVersion, offers: [...claim.offers], at: claim.at, seq: record.seq, writer: record.actor ?? null }
    if (previous === undefined) {
      state.adapters.set(claim.id, {
        id: claim.id,
        platform: incoming.platform,
        protocolVersion: incoming.protocolVersion,
        offers: [...incoming.offers],
        at: incoming.at,
        seq: incoming.seq,
        resolvedBy: 'seq',
        contested: false,
        losers: [],
      })
      continue
    }
    const held: AdapterRowClaim = { platform: previous.platform, protocolVersion: previous.protocolVersion, offers: [...previous.offers], at: previous.at, seq: previous.seq, writer: null }
    const folded = foldClaim({ at: previous.at, seq: previous.seq }, { at: incoming.at, seq: incoming.seq })
    const winner = folded.incomingWins ? incoming : held
    const loser = folded.incomingWins ? held : incoming
    const disagrees = loser.platform !== winner.platform || loser.protocolVersion !== winner.protocolVersion || loser.offers.join('\u0000') !== winner.offers.join('\u0000')
    state.adapters.set(claim.id, {
      id: claim.id,
      platform: winner.platform,
      protocolVersion: winner.protocolVersion,
      offers: [...winner.offers],
      at: winner.at,
      seq: winner.seq,
      resolvedBy: folded.byAt ? 'at' : 'seq',
      contested: previous.contested || disagrees,
      losers: disagrees ? [loser, ...previous.losers] : previous.losers,
    })
  }
}

function finishAdapters(state: AdaptersFoldState): AdaptersState {
  return {
    adapters: [...state.adapters.values()].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    refused: state.refused,
    malformed: state.refused.length,
  }
}

export function projectAdapters(records: readonly ControlRecord[]): AdaptersState {
  const state = emptyAdaptersFold()
  foldAdapters(state, records)
  return finishAdapters(state)
}

/** Why an adapter may or may not join this bus. */
export type AdmitReason = 'ok' | 'undeclared-adapter' | 'unsupported-protocol' | 'capability-mismatch' | 'empty-platform'

/** What {@link admitAdapter} answers, with everything it was decided from. */
export interface AdmitVerdict {
  /** Whether the adapter may join. True only for reason === 'ok'. */
  readonly ok: boolean
  /** Why. */
  readonly reason: AdmitReason
  /** The platform from the winning declaration, or null when nothing declared this adapter. */
  readonly platform: string | null
  /** The version judged: the caller's when it gave one, else the declaration's; null when undeclared. */
  readonly protocolVersion: string | null
  /** The protocol versions this build supports, so a refusal says what would have been accepted. */
  readonly supported: readonly string[]
  /** Capabilities the adapter claims and the registry does not record. Non-empty means refused. */
  readonly missing: readonly string[]
  /** Capabilities the registry records and the declaration did not mention. Reported, never refused. */
  readonly extra: readonly string[]
}

/**
 * Decide whether one declared adapter may join this bus.
 *
 * The precedence is fixed and total: undeclared-adapter, empty-platform, unsupported-protocol,
 * capability-mismatch, ok. A declaration whose shape could not be read never enters
 * {@link AdaptersState.adapters}, so it reads as undeclared here and as a refusal there — both facts
 * are reported, which is what "visible" means for a record nobody could read.
 *
 * The **capability registry is the authority**, not the declaration: a capability the adapter claims
 * and the registry does not record is `missing`, and **any** missing capability refuses it — a caller
 * that believes it can do work the ledger has no record of must not be handed work on that belief. The
 * other direction is reported and not refused: a capability the registry records and the declaration
 * forgot is `extra`, because the ledger is what counts and an understated offer is not a lie about
 * what can be done. Both lists travel with every answer, refusals included, so a caller can see the
 * whole comparison rather than only the first thing that was wrong.
 * @param state - a folded state.
 * @param adapterId - the adapter to admit.
 * @param options - the version the caller speaks, when it states one.
 * @returns the verdict.
 */
export function admitAdapter(state: TeamState, adapterId: string, options?: { protocolVersion?: string }): AdmitVerdict {
  const supported = [...SUPPORTED_PROTOCOLS]
  const row = state.adapters.adapters.find((entry) => entry.id === adapterId)
  if (row === undefined) return { ok: false, reason: 'undeclared-adapter', platform: null, protocolVersion: null, supported, missing: [], extra: [] }
  const registered = capabilitiesOf(state, adapterId)
  const missing = row.offers.filter((name) => !registered.includes(name)).sort()
  const extra = registered.filter((name) => !row.offers.includes(name)).sort()
  if (row.platform === '') return { ok: false, reason: 'empty-platform', platform: null, protocolVersion: row.protocolVersion, supported, missing, extra }
  const asked = options?.protocolVersion
  if (asked !== undefined && !supported.includes(asked)) {
    return { ok: false, reason: 'unsupported-protocol', platform: row.platform, protocolVersion: asked, supported, missing, extra }
  }
  if (!supported.includes(row.protocolVersion)) {
    return { ok: false, reason: 'unsupported-protocol', platform: row.platform, protocolVersion: row.protocolVersion, supported, missing, extra }
  }
  if (missing.length > 0) return { ok: false, reason: 'capability-mismatch', platform: row.platform, protocolVersion: row.protocolVersion, supported, missing, extra }
  return { ok: true, reason: 'ok', platform: row.platform, protocolVersion: row.protocolVersion, supported, missing, extra }
}

/** One MCP initialization request, as a client sends it. */
export interface McpInitializeRequest {
  /** The version the client proposes, when it proposes one. */
  readonly protocolVersion?: string
  /** Who is asking. Carried so a caller can log it; not judged here. */
  readonly clientInfo?: { readonly name?: string, readonly version?: string }
}

/** What {@link mcpInitialize} answers. */
export interface McpInitializeResult {
  /** Whether the handshake may proceed. */
  readonly ok: boolean
  /** Why. The same vocabulary admission uses, so a refusal reads the same at both faces. */
  readonly reason: AdmitReason
  /** The version this session will speak, or the refused one that was asked for. */
  readonly protocolVersion: string | null
  /** The versions this build supports. */
  readonly supported: readonly string[]
  /** This server's identity. */
  readonly serverInfo: { readonly name: string, readonly version: string }
}

/**
 * Negotiate the protocol version of one MCP session.
 *
 * A client that names a version this build does not speak is refused, with the supported list attached
 * so the answer says what would have worked. A client that names **no** version is not refused: the
 * server chooses, which is what a version-less initialize means, and the answer states the version
 * this session will speak. Refusing silence would turn "pick one for me" into an error.
 * @param state - a folded state. This face does not read it: the answer is a fact about this build,
 * and the parameter belongs to one call shape shared with the other two faces.
 * @param request - the client's initialize request, or undefined when it sent none.
 * @returns the negotiation result.
 */
export function mcpInitialize(state: TeamState, request: McpInitializeRequest | undefined): McpInitializeResult {
  void state
  const supported = [...SUPPORTED_PROTOCOLS]
  const asked = typeof request?.protocolVersion === 'string' && request.protocolVersion !== '' ? request.protocolVersion : null
  if (asked === null) return { ok: true, reason: 'ok', protocolVersion: SUPPORTED_PROTOCOLS[0], supported, serverInfo: MCP_SERVER_INFO }
  if (!supported.includes(asked)) return { ok: false, reason: 'unsupported-protocol', protocolVersion: asked, supported, serverInfo: MCP_SERVER_INFO }
  return { ok: true, reason: 'ok', protocolVersion: asked, supported, serverInfo: MCP_SERVER_INFO }
}

/** One tool on the catalogue. */
export interface McpTool {
  /** The tool's name, which is the capability's name. */
  readonly name: string
  /**
   * The members that can provide this capability **now, from the end that asked**, ordered by id.
   *
   * Both halves are part of the meaning: `healthy`, and reachable from `localEnd`. A member that beat
   * recently but sits behind a broken chain cannot serve this end, so it is not advertised as
   * available — the field answers "what can serve here", not "who exists". The viewpoint is a required
   * parameter of {@link mcpTools} precisely so this field cannot be read without one.
   */
  readonly availableFrom: readonly string[]
}

/**
 * The tool catalogue, derived from the capability registry.
 *
 * Every capability the registry knows becomes one tool — the registry is the authority on what can be
 * done, so a list built from declarations would offer work the ledger has no record of. An empty
 * registry is an empty catalogue rather than an error: "nothing is registered" is an answer.
 *
 * `availableFrom` holds the members that can serve it **now, from `localEnd`**: healthy **and** reachable
 * from the end asking. Both halves are required, and the viewpoint is mandatory for the same reason it
 * is on the call face: a catalogue that advertises a tool the verdict then refuses to dispatch is one
 * question answered two ways. A member that never beat is not alive here for the same reason it is not
 * alive anywhere else in this layer. A capability is still listed when nobody can serve it, with an
 * empty `availableFrom`, so the catalogue says the capability exists and that nobody is answering.
 * @param state - a folded state.
 * @param now - the instant, in milliseconds.
 * @param options - the threshold a heartbeat must be within to count as alive, and the end asking.
 * @returns the tools, ordered by name.
 */
export function mcpTools(state: TeamState, now: number, options: { timeoutMs: number, localEnd: string }): readonly McpTool[] {
  const livenesses = new Map(livenessOf(state, now, options).map((reading) => [reading.memberId, reading.liveness]))
  // The same viewpoint the call verdict takes, because a catalogue and a verdict that disagree about one
  // end are one question answered twice: a tool advertised here must be dispatchable there. The
  // judgement itself is {@link routes}, called rather than re-derived.
  const reachable = new Set(routes(state, options.localEnd, now, { timeoutMs: options.timeoutMs }).map((row) => row.member))
  return Object.keys(state.registry.byCapability).sort().map((name) => ({
    name,
    availableFrom: (state.registry.byCapability[name] ?? [])
      .filter((id) => livenesses.get(id) === 'healthy' && reachable.has(id))
      .sort(),
  }))
}

/** Why one tool call may or may not be dispatched. */
export type McpCallReason = 'ok' | 'unknown-tool' | 'no-provider' | 'provider-silent'

/** What {@link mcpCall} answers, with everything it was decided from. */
export interface McpCallResult {
  /** Whether a provider is available. True only for reason === 'ok'. */
  readonly ok: boolean
  /** Why. */
  readonly reason: McpCallReason
  /** Every member the registry **declares** for this capability, ordered by id — healthy or not. */
  readonly declaredBy: readonly string[]
  /** The subset of `declaredBy` that is healthy right now, ordered by id. */
  readonly healthy: readonly string[]
}

/**
 * Decide whether one tool call can be dispatched, and to whom.
 *
 * The precedence is fixed and total: unknown-tool, no-provider, provider-silent, ok.
 * `unknown-tool` means the registry records **nobody** for this capability: the name is not work this
 * bus can do, whatever a declaration says. `no-provider` means somebody declares it and **none of
 * them is healthy**: the capability exists and nobody is answering. `provider-silent` means at least
 * one provider is healthy and **none of the healthy ones is reachable from `localEnd`** —
 * reachability is a property of a viewpoint, which is why the caller must state one, and why the
 * answer comes from {@link routes} rather than from a second opinion about chains.
 *
 * Pure: nothing is appended, no lock is taken, no provider is contacted. A caller that wants the call
 * on the record appends the record itself.
 * @param state - a folded state.
 * @param name - the capability (tool) being called.
 * @param now - the instant, in milliseconds.
 * @param options - the silence threshold, and the end asking.
 * @returns the verdict.
 */
export function mcpCall(state: TeamState, name: string, now: number, options: { timeoutMs: number, localEnd: string }): McpCallResult {
  const declaredBy = membersWith(state, name)
  if (declaredBy.length === 0) return { ok: false, reason: 'unknown-tool', declaredBy: [], healthy: [] }
  const livenesses = new Map(livenessOf(state, now, { timeoutMs: options.timeoutMs }).map((reading) => [reading.memberId, reading.liveness]))
  const healthy = declaredBy.filter((id) => livenesses.get(id) === 'healthy')
  if (healthy.length === 0) return { ok: false, reason: 'no-provider', declaredBy, healthy }
  const reachable = new Set(routes(state, options.localEnd, now, { timeoutMs: options.timeoutMs }).map((row) => row.member))
  if (!healthy.some((id) => reachable.has(id))) return { ok: false, reason: 'provider-silent', declaredBy, healthy }
  return { ok: true, reason: 'ok', declaredBy, healthy }
}

/* ------------------------------------------------------------------------------------------------
 * MCP over stdio: the transport half.
 *
 * `docs/research/mcp-stdio-wire.md` is the authority for every byte below — it quotes the official
 * transport, lifecycle and tools pages and the kernel's own fixture-server shapes, and each rule this
 * section implements points back at one of its lines. R45 landed the judgement faces
 * (`mcpInitialize`/`mcpTools`/`mcpCall`); what it did not do is run a server. This section does:
 * a real child process, newline-delimited JSON-RPC, a handshake in the order the lifecycle page
 * writes it, a tool face, and a verdict for each way a server can fail to answer.
 *
 * Two rules from that page shape everything here: **one message is one line** (a newline inside a
 * string travels escaped, never raw), and **stdout carries only protocol frames** while stderr is
 * logging the client collects and never judges.
 */

/** The protocol version this build proposes in `initialize.params.protocolVersion`. */
export const MCP_PROTOCOL_VERSION = '2025-06-18'

/** How to start one MCP server. */
export interface McpServerSpec {
  /** The executable to run. */
  readonly command: string
  /** Its arguments. */
  readonly args?: readonly string[]
  /** Extra environment for the child, on top of this process's. */
  readonly env?: Record<string, string>
  /** Its working directory. */
  readonly cwd?: string
}

/** The slice of a child process this client uses, so a test can stand in for one. */
export interface McpChildLike {
  /** The child's process id, or null when it never started. */
  readonly pid: number | null
  /** Its stdin, or null. */
  readonly stdin: { write: (chunk: string) => unknown, end?: () => unknown } | null
  /** Its stdout, or null. */
  readonly stdout: { on: (event: string, listener: (chunk: unknown) => void) => unknown } | null
  /** Its stderr, or null. */
  readonly stderr?: { on: (event: string, listener: (chunk: unknown) => void) => unknown } | null
  /** Lifecycle events: `exit`, `close`, `error`. */
  on: (event: string, listener: (...args: unknown[]) => void) => unknown
  /** Ask the child to stop. */
  kill: (signal?: string) => unknown
}

/** What one MCP handshake came to. */
export interface McpHandshake {
  /** `ok` only when the server agreed to the version this client proposed. */
  readonly verdict: 'ok' | 'refused' | 'protocol-error' | 'transport-error' | 'timeout'
  /** The version the server answered with, when it answered with a usable one. */
  readonly negotiated: string | null
  /** The server's self-description, when it gave a readable one. */
  readonly serverInfo: { readonly name: string, readonly version: string } | null
  /** The server's declared capabilities, echoed as received, or null. */
  readonly capabilities: unknown
  /** The JSON-RPC error code, when the refusal was an error object. */
  readonly code?: number
  /** One line saying what happened, for a reader that has only the verdict. */
  readonly detail?: string
  /** The named cause of a `transport-error`: `malformed-frame`, `closed`, `server-exited`, … */
  readonly reason?: string
  /** The client's instant when the result arrived, from the injected clock. */
  readonly at: number
}

/** One tool as the server listed it. */
export interface McpToolListEntry {
  /** The tool's name. A name is required: an unnamed tool cannot be called. */
  readonly name: string
  /** Its description, or null when it gave none. */
  readonly description: string | null
  /** Its input schema, echoed as received — this layer does not validate schemas. */
  readonly inputSchema: unknown
}

/** What one `tools/list` came to. */
export interface McpListVerdict {
  /** Why the list is empty when it is. */
  readonly verdict: 'ok' | 'protocol-error' | 'transport-error' | 'timeout'
  /** The tools the server listed, in its own order. */
  readonly tools: readonly McpToolListEntry[]
  /** The server's continuation cursor, when it offered one. */
  readonly nextCursor: string | null
  /** The JSON-RPC error code, when the failure was an error object. */
  readonly code?: number
  /** One line saying what happened. */
  readonly detail?: string
  /** The named cause of a `transport-error`: `malformed-frame`, `closed`, `server-exited`, … */
  readonly reason?: string
}

/** What one `tools/call` came to. */
export interface McpCallVerdict {
  /** `tool-error` is the server's own `isError: true` — a result, not a broken transport. */
  readonly verdict: 'ok' | 'tool-error' | 'unknown-tool' | 'protocol-error' | 'transport-error' | 'timeout'
  /** The content blocks, echoed as received: heterogeneous blocks are never flattened. */
  readonly content: readonly unknown[]
  /** Whether the server marked the result as an error. */
  readonly isError: boolean
  /** The JSON-RPC error code, when the refusal was an error object. */
  readonly code?: number
  /** One line saying what happened. */
  readonly detail?: string
  /** The named cause of a `transport-error`: `malformed-frame`, `closed`, `server-exited`, … */
  readonly reason?: string
}

/** What a caller may configure on one client. */
export interface McpClientOptions {
  /** The server to run. */
  readonly server: McpServerSpec
  /** The version to propose. Defaults to {@link MCP_PROTOCOL_VERSION}. */
  readonly protocolVersion?: string
  /** The name to report in `initialize.params.clientInfo`. */
  readonly clientName?: string
  /** The version to report in `initialize.params.clientInfo`. */
  readonly clientVersion?: string
  /** How long any one request may wait, in milliseconds. @default 10000 */
  readonly timeoutMs?: number
  /** The clock stamped onto the handshake. @default Date.now */
  readonly now?: () => number
  /** How to start the child. Injected only so a test can stand in for one. */
  readonly spawn?: (spec: McpServerSpec) => McpChildLike
}

/** One live MCP client. */
export interface McpClient {
  /** Handshake: `initialize` → result → `notifications/initialized`. */
  initialize(): Promise<McpHandshake>
  /** Ask the server for its tools. */
  listTools(options?: { cursor?: string }): Promise<McpListVerdict>
  /** Call one tool. */
  callTool(name: string, args: unknown, options?: { timeoutMs?: number }): Promise<McpCallVerdict>
  /** Stop the child and release everything. Idempotent, and it leaves no orphan. */
  close(): Promise<void>
  /** The child's process id, or null. Readable after `close()`. */
  readonly pid: number | null
  /** Protocol frames written and read. Only frames are counted; stderr lines are not. */
  readonly frames: { readonly sent: number, readonly received: number }
  /** The server's stderr lines, in arrival order. Logging, never protocol. */
  readonly stderr: readonly string[]
}

/**
 * Start one MCP server as a real child process.
 *
 * `windowsHide` because a console window per server is a visible side effect of a protocol the caller
 * never asked to see; `env` is merged onto this process's rather than replacing it, because a server
 * that cannot find its own runtime is a failure that reads as a protocol failure.
 * @param spec - the command to run.
 * @returns the child, narrowed to what the client uses.
 */
function spawnMcpServer(spec: McpServerSpec): McpChildLike {
  const child = spawnChild(spec.command, [...(spec.args ?? [])], {
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(spec.env === undefined ? {} : { env: { ...process.env, ...spec.env } }),
    ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
    windowsHide: true,
  })
  return child as unknown as McpChildLike
}

/** What one request to the server came to, before it is turned into the caller's verdict. */
type McpAnswer =
  | { readonly ok: true, readonly result: unknown }
  | { readonly ok: false, readonly kind: 'error', readonly code: number | null, readonly detail: string }
  | { readonly ok: false, readonly kind: 'protocol-error' | 'transport-error' | 'timeout', readonly detail: string, readonly reason?: string }

/** How a failed request maps onto a caller's verdict word. Identical mapping at all three faces. */
function verdictOf(answer: Extract<McpAnswer, { ok: false }>): 'protocol-error' | 'transport-error' | 'timeout' {
  return answer.kind === 'error' ? 'protocol-error' : answer.kind
}

/**
 * Create one MCP client over a server's standard input and output.
 *
 * Frames are newline-delimited (§一 规则 1): a message that carried a raw newline would be read as two
 * messages, so newlines travel inside JSON strings as the two-character escape. Reading is by line and
 * not by chunk — one `data` event may hold half a frame or three of them — which is why the buffers
 * below exist rather than a `JSON.parse` per event.
 *
 * A line that is not a frame ends the session: the stream can no longer be trusted to be aligned with
 * the requests waiting on it. The request whose answer was corrupted reads `protocol-error` — the
 * defect is a protocol fact and it names it — and the session is marked unusable, so **every request
 * after it answers `transport-error` immediately** rather than waiting for a reply that may already
 * have been consumed. That is the choice this build makes, and it is a choice: retrying on the next line
 * would attribute a later response to an earlier request, which is the one outcome nobody can read.
 * @param options - the server to run, the versions to report, the timeout and the clock.
 * @returns the client.
 * @throws TypeError when no server command was given.
 */
export function createMcpClient(options: McpClientOptions): McpClient {
  const server = options?.server
  if (server === null || typeof server?.command !== 'string' || server.command === '') {
    throw new TypeError('createMcpClient: server.command must be a non-empty string')
  }
  const protocolVersion = options.protocolVersion === undefined ? MCP_PROTOCOL_VERSION : options.protocolVersion
  const timeoutMs = options.timeoutMs === undefined ? 10_000 : options.timeoutMs
  const now = options.now ?? ((): number => Date.now())
  const child = (options.spawn ?? spawnMcpServer)(server)
  const stdin = child.stdin
  const stdout = child.stdout
  const stderrStream = child.stderr ?? null

  const waiting = new Map<number, { settle: (answer: McpAnswer) => void, timer: ReturnType<typeof setTimeout> }>()
  let nextId = 1
  let sent = 0
  let received = 0
  // The latch: once a line on the stream is not a frame, the stream can no longer be trusted to line
  // up with the requests written into it, so this client writes nothing more and names why. `reason` is
  // the latch's own name, so a caller reads "unreachable **because** the server wrote something that is
  // not a frame" rather than a verdict that could mean any transport problem.
  let latch: { readonly reason: string, readonly detail: string } | null = null
  let died: string | null = null
  let closed = false
  let finished: McpHandshake | null = null
  const stderrLines: string[] = []
  let outBuffer = ''
  let errBuffer = ''

  /** Hand one answer to whoever is waiting for it, and stop its timer. */
  const settle = (id: number, answer: McpAnswer): void => {
    const entry = waiting.get(id)
    if (entry === undefined) return
    waiting.delete(id)
    clearTimeout(entry.timer)
    entry.settle(answer)
  }

  /** Fail every waiting request for one reason, which is what a dead or poisoned session means. */
  const settleAll = (answer: (id: number) => McpAnswer): void => {
    for (const id of [...waiting.keys()]) settle(id, answer(id))
  }

  /** Read one received line as a frame. */
  const onLine = (line: string): void => {
    if (line === '') return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      latch = { reason: 'malformed-frame', detail: 'the server wrote a line that is not JSON' }
      settleAll(() => ({ ok: false, kind: 'protocol-error', detail: 'the server wrote a line that is not JSON' }))
      return
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      latch = { reason: 'malformed-frame', detail: 'the server wrote a line that is not a JSON-RPC message' }
      settleAll(() => ({ ok: false, kind: 'protocol-error', detail: 'the server wrote a line that is not a JSON-RPC message' }))
      return
    }
    received += 1
    const frame = parsed as { id?: unknown, method?: unknown, result?: unknown, error?: unknown }
    if (typeof frame.id !== 'number') {
      // A server-initiated notification carries a method and no id (§一 规则 3). It is not a reply, so
      // it answers nobody; it is not poison either, and answering server requests is not this half.
      if (typeof frame.method === 'string') return
      latch = { reason: 'malformed-frame', detail: 'the server wrote a message that is neither a reply nor a notification' }
      settleAll(() => ({ ok: false, kind: 'protocol-error', detail: 'the server wrote a message that is neither a reply nor a notification' }))
      return
    }
    if (frame.error !== undefined && frame.error !== null) {
      const error = frame.error as { code?: unknown, message?: unknown }
      const code = typeof error.code === 'number' ? error.code : null
      const detail = typeof error.message === 'string' ? error.message : 'the server answered with an error'
      settle(frame.id, { ok: false, kind: 'error', code, detail })
      return
    }
    if (frame.result === undefined) {
      latch = { reason: 'malformed-frame', detail: 'a reply carried neither result nor error' }
      settleAll(() => ({ ok: false, kind: 'protocol-error', detail: 'a reply carried neither result nor error' }))
      return
    }
    settle(frame.id, { ok: true, result: frame.result })
  }

  /** Append one chunk to a line buffer and hand over every complete line it now holds. */
  const feed = (buffer: string, chunk: string, take: (line: string) => void): string => {
    let text = buffer + chunk
    let cut = text.indexOf('\n')
    while (cut >= 0) {
      const line = text.slice(0, cut)
      text = text.slice(cut + 1)
      take(line.endsWith('\r') ? line.slice(0, -1) : line)
      cut = text.indexOf('\n')
    }
    return text
  }

  if (stdout !== null) {
    stdout.on('data', (chunk: unknown) => {
      outBuffer = feed(outBuffer, String(chunk), onLine)
    })
  }
  if (stderrStream !== null) {
    stderrStream.on('data', (chunk: unknown) => {
      errBuffer = feed(errBuffer, String(chunk), (line) => { if (line !== '') stderrLines.push(line) })
    })
  }
  child.on('error', (error: unknown) => {
    died = 'the server process failed: ' + String((error as { message?: unknown })?.message ?? error)
    settleAll(() => ({ ok: false, kind: 'transport-error', reason: 'server-exited', detail: died === null ? 'the server is gone' : died }))
  })
  const noteExit = (...args: unknown[]): void => {
    if (died === null) died = 'the server exited before answering' + (args.length === 0 ? '' : ' (code ' + String(args[0]) + ')')
    settleAll(() => ({ ok: false, kind: 'transport-error', reason: 'server-exited', detail: died === null ? 'the server is gone' : died }))
  }
  child.on('exit', noteExit)
  child.on('close', noteExit)

  /** Write one protocol frame. A failure to write is a transport failure, not a thrown error. */
  const writeFrame = (frame: { id: number, method: string, params: unknown } | { method: string, params: unknown }): McpAnswer | null => {
    if (stdin === null) return { ok: false, kind: 'transport-error', reason: 'no-stdin', detail: 'the server has no standard input' }
    try {
      // Every frame this client writes carries the protocol-version member, and it is added here rather
      // than at the call sites: a request and a notification are the same shape to a reader, and the
      // reference server answers an `initialize` without it with silence - which reaches a caller as
      // `timeout`, a verdict about the clock rather than about the frame. Inbound stays tolerant on
      // purpose: `onLine` reads the members it needs and ignores the rest, so a server that omits this
      // member is still read. Strict outbound costs one key; strict inbound would reject peers that are
      // merely older, and a reader cannot tell "older" from "broken".
      stdin.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\n')
      sent += 1
      return null
    } catch (error) {
      return { ok: false, kind: 'transport-error', reason: 'write-failed', detail: 'writing to the server failed: ' + String((error as { message?: unknown })?.message ?? error) }
    }
  }

  /** One request, bounded by the timeout. */
  const request = (method: string, params: unknown, override?: number): Promise<McpAnswer> => {
    if (closed) return Promise.resolve({ ok: false, kind: 'transport-error', reason: 'closed', detail: 'the client is closed' })
    if (latch !== null) {
      // No id is minted, no frame is written, no timer is armed: the pairing a reader needs is
      // `frames.sent` staying exactly where it was across these calls.
      return Promise.resolve({ ok: false, kind: 'transport-error', reason: latch.reason, detail: 'the session is latched closed after a protocol defect: ' + latch.detail })
    }
    if (died !== null) return Promise.resolve({ ok: false, kind: 'transport-error', reason: 'server-exited', detail: died })
    const id = nextId
    nextId += 1
    const limit = override === undefined ? timeoutMs : override
    return new Promise<McpAnswer>((done) => {
      const timer = setTimeout(() => {
        waiting.delete(id)
        done({ ok: false, kind: 'timeout', detail: 'no answer within ' + String(limit) + 'ms' })
      }, limit)
      waiting.set(id, { settle: done, timer })
      const failed = writeFrame({ id, method, params })
      if (failed !== null) settle(id, failed)
    })
  }

  const initialize = async (): Promise<McpHandshake> => {
    if (finished !== null) return finished
    const answer = await request('initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: options.clientName ?? 'dsh-link-collab', version: options.clientVersion ?? '1' },
    })
    const at = now()
    const empty = { negotiated: null, serverInfo: null, capabilities: null, at }
    if (!answer.ok) {
      return { ...empty, verdict: verdictOf(answer), detail: answer.detail, ...(answer.reason === undefined ? {} : { reason: answer.reason }), ...(answer.kind === 'error' && answer.code !== null ? { code: answer.code } : {}) }
    }
    const result = answer.result as { protocolVersion?: unknown, serverInfo?: unknown, capabilities?: unknown } | null
    const negotiated = typeof result?.protocolVersion === 'string' && result.protocolVersion !== '' ? result.protocolVersion : null
    const info = result?.serverInfo as { name?: unknown, version?: unknown } | undefined
    const serverInfo = info === null || typeof info?.name !== 'string' || info.name === ''
      ? null
      : { name: info.name, version: typeof info.version === 'string' ? info.version : '' }
    const capabilities = result?.capabilities ?? null
    if (negotiated === null) {
      return { ...empty, serverInfo, capabilities, verdict: 'protocol-error', detail: 'the initialize result named no protocolVersion' }
    }
    if (negotiated !== protocolVersion) {
      // §二 规则 7: a different version is not a success. `refused` is the same word the server face
      // uses, so one vocabulary covers both directions, and the answer the server gave travels with it.
      return { ...empty, serverInfo, capabilities, negotiated, verdict: 'refused', detail: 'the server answered ' + negotiated + ' while this client proposed ' + protocolVersion }
    }
    // §二 规则 6: the notification goes out only AFTER the result is in hand, which is what makes the
    // order a fact of this code rather than of a comment.
    const failed = writeFrame({ method: 'notifications/initialized', params: {} })
    if (failed !== null) return { ...empty, serverInfo, capabilities, negotiated, verdict: verdictOf(failed), detail: failed.detail }
    finished = { verdict: 'ok', negotiated, serverInfo, capabilities, at }
    return finished
  }

  const listTools = async (listOptions?: { cursor?: string }): Promise<McpListVerdict> => {
    const answer = await request('tools/list', listOptions?.cursor === undefined ? {} : { cursor: listOptions.cursor })
    const empty = { tools: [], nextCursor: null }
    if (!answer.ok) {
      return { ...empty, verdict: verdictOf(answer), detail: answer.detail, ...(answer.reason === undefined ? {} : { reason: answer.reason }), ...(answer.kind === 'error' && answer.code !== null ? { code: answer.code } : {}) }
    }
    const result = answer.result as { tools?: unknown, nextCursor?: unknown } | null
    if (!Array.isArray(result?.tools)) {
      return { ...empty, verdict: 'protocol-error', detail: 'the tools/list result carried no tools array' }
    }
    const tools: McpToolListEntry[] = []
    for (const row of result.tools) {
      const entry = row as { name?: unknown, description?: unknown, inputSchema?: unknown } | null
      if (typeof entry?.name !== 'string' || entry.name === '') {
        // A listed tool without a name is unusable, and dropping it silently would make the catalogue
        // claim the server is smaller than it said it was.
        return { ...empty, verdict: 'protocol-error', detail: 'the server listed a tool without a name' }
      }
      tools.push({
        name: entry.name,
        description: typeof entry.description === 'string' ? entry.description : null,
        inputSchema: entry.inputSchema ?? null,
      })
    }
    return { verdict: 'ok', tools, nextCursor: typeof result.nextCursor === 'string' ? result.nextCursor : null }
  }

  const callTool = async (name: string, args: unknown, callOptions?: { timeoutMs?: number }): Promise<McpCallVerdict> => {
    const answer = await request('tools/call', { name, arguments: args }, callOptions?.timeoutMs)
    const empty = { content: [], isError: false }
    if (!answer.ok) {
      // §三 规则 10: the server's protocol-level "no such tool" is not the same thing as a tool that
      // ran and failed. It carries a code, and it is the one error this face names itself.
      if (answer.kind === 'error' && answer.code === -32602) {
        return { ...empty, verdict: 'unknown-tool', code: -32602, detail: answer.detail }
      }
      return { ...empty, verdict: verdictOf(answer), detail: answer.detail, ...(answer.reason === undefined ? {} : { reason: answer.reason }), ...(answer.kind === 'error' && answer.code !== null ? { code: answer.code } : {}) }
    }
    const result = answer.result as { content?: unknown, isError?: unknown } | null
    if (!Array.isArray(result?.content)) {
      return { ...empty, verdict: 'protocol-error', detail: 'the tools/call result carried no content array' }
    }
    const isError = result?.isError === true
    // §三 规则 8: `isError` is a RESULT. The client stays usable, which is why nothing here poisons it.
    return { verdict: isError ? 'tool-error' : 'ok', content: result.content, isError }
  }

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    settleAll(() => ({ ok: false, kind: 'transport-error', detail: 'the client was closed' }))
    try { stdin?.end?.() } catch { /* the pipe may already be gone; the kill below is the real stop */ }
    /** Wait for the child to be gone, bounded: a close that hung on a wedged child would be no close. */
    const gone = (limit: number): Promise<void> => new Promise((done) => {
      if (died !== null) { done(); return }
      const timer = setTimeout(() => { done() }, limit)
      const finish = (): void => { clearTimeout(timer); done() }
      child.on('exit', finish)
      child.on('close', finish)
    })
    if (child.pid !== null && died === null) {
      try { child.kill() } catch { /* already gone is the outcome this asks for */ }
      await gone(500)
      if (died === null) {
        try { child.kill('SIGKILL') } catch { /* a process that cannot be killed stays, and that is a fact */ }
        await gone(2_000)
      }
    }
  }

  return {
    initialize,
    listTools,
    callTool,
    close,
    get pid() { return child.pid },
    get frames() { return { sent, received } },
    get stderr() { return [...stderrLines] },
  }
}

/**
 * The ledger records for the tools one MCP server listed.
 *
 * `capabilityRecord` is called, not imitated: the claim that a tool exists has exactly one spelling in
 * this build, so what a server said cannot end up as a second vocabulary that some other reader has to
 * learn. A tool whose name is not a usable name is dropped by that same function, for the same reason
 * it drops one everywhere else.
 * @param adapterId - the adapter the tools belong to. Non-empty.
 * @param tools - the tools as listed.
 * @returns one record, ready to append.
 * @throws TypeError when the adapter id is not a non-empty string.
 */
export function mcpToolRecords(adapterId: string, tools: readonly McpToolListEntry[]): readonly { kind: string, subject: string, payload: { id: string, capabilities: string[] } }[] {
  const names = (Array.isArray(tools) ? tools : []).map((tool) => tool?.name)
  return [capabilityRecord(adapterId, names)]
}

/**
 * Map one MCP call verdict onto the outcome a dispatched unit of work is written down as.
 *
 * The mapping is **named row by row**, not defaulted: every verdict in the closed set has its own
 * answer, and anything outside the set throws. A default branch would be the quiet kind of wrong —
 * a new verdict would arrive and be written as "ok" or as "failed" by a rule nobody chose, and the
 * dispatch ledger would carry a fact this build never decided.
 *
 * The two success-shaped rows differ in exactly one way, and it is the whole point of the tool face:
 * `ok` keeps the content blocks as the server wrote them (heterogeneous blocks are not flattened,
 * because an image block flattened to text is no longer the answer the server gave), while
 * `tool-error` is a **result** too — the work was done and reported as failed — so its first text
 * block becomes the error text and the dispatch still gets an answer.
 * @param verdict - what one `tools/call` came to.
 * @returns the outcome to write down.
 * @throws TypeError when the verdict is not one this build maps.
 */
export function mcpDispatchOutcome(verdict: McpCallVerdict): DispatchOutcome {
  const name = (verdict as { verdict?: unknown } | null | undefined)?.verdict
  if (name === 'ok') return { ok: true, value: { content: (verdict as McpCallVerdict).content, isError: false } }
  if (name === 'tool-error') {
    const blocks = (verdict as McpCallVerdict).content
    const first = Array.isArray(blocks)
      ? blocks.find((block) => (block as { type?: unknown } | null)?.type === 'text' && typeof (block as { text?: unknown }).text === 'string')
      : undefined
    const text = (first as { text?: unknown } | undefined)?.text
    // No text block is still an answer: the tool failed, and the word for that is in this build's
    // vocabulary rather than the server's, which is the only thing left to say.
    return { ok: false, error: typeof text === 'string' ? text : 'tool-error' }
  }
  if (name === 'unknown-tool') return { ok: false, error: 'unknown-tool' }
  if (name === 'protocol-error') return { ok: false, error: 'protocol-error' }
  if (name === 'transport-error') {
    // The reason is carried through, so a latched stream reads at the dispatch result as
    // `transport-error:malformed-frame` instead of as a transport failure with no cause.
    const reason = (verdict as { reason?: unknown }).reason
    return { ok: false, error: typeof reason === 'string' && reason !== '' ? 'transport-error:' + reason : 'transport-error' }
  }
  if (name === 'timeout') return { ok: false, error: 'timeout' }
  throw new TypeError('mcpDispatchOutcome: ' + String(JSON.stringify(name)) + ' is not a verdict this build maps (ok | tool-error | unknown-tool | protocol-error | transport-error | timeout)')
}

/**
 * Install the tools one MCP server listed into this end's tool registry.
 *
 * The registry is where dispatched work is executed from, so installing here is what makes a remote
 * tool runnable by a dispatch. Nothing else happens here: **this function does not read or write the
 * ledger**. Declaring the capability is a separate, explicit act (`mcpToolRecords` →
 * `capabilityRecord`), because a second place that decided "who has this tool" would eventually
 * disagree with the registry — and the disagreement would decide whether work is dispatched at all.
 *
 * A client that was never initialized is not an error: the handler calls the server and whatever
 * comes back is mapped to a verdict, so a caller gets a decidable outcome rather than a throw.
 * @param into - the registry to install into.
 * @param tools - the tools to install, as the server listed them.
 * @param client - the client the handlers call.
 * @returns a disposer that removes exactly what this call installed and restores what it replaced.
 * @throws TypeError when the registry or client is not usable, or a tool carries no name.
 */
export function installMcpTools(into: LocalTools, tools: readonly McpToolListEntry[], client: McpClient): () => void {
  if (into === null || typeof into?.register !== 'function' || typeof into?.has !== 'function') {
    throw new TypeError('installMcpTools: into must be a tool registry')
  }
  if (client === null || typeof client?.callTool !== 'function') {
    throw new TypeError('installMcpTools: client must be an MCP client')
  }
  const disposers: (() => void)[] = []
  for (const tool of Array.isArray(tools) ? tools : []) {
    const name = tool?.name
    if (typeof name !== 'string' || name === '') throw new TypeError('installMcpTools: every tool must carry a name')
    // The handler closes over the name rather than over the entry: what gets installed is "call this
    // tool", so a caller that mutates the listing afterwards cannot change what the registry runs.
    disposers.push(into.register(name, async (args: unknown): Promise<unknown> => {
      const outcome = mcpDispatchOutcome(await client.callTool(name, args))
      // The registry wraps what a handler returns, so this handler returns the tool's VALUE and throws
      // the failure: returning the mapped outcome here would be a second shape for the same answer.
      if (!outcome.ok) throw new Error(outcome.error)
      return outcome.value
    }))
  }
  let removed = false
  return () => {
    if (removed) return
    removed = true
    // Unwound in reverse, the way a stack unwinds: a name installed twice has the later install
    // holding the earlier handler, so removing the later one restores the earlier one first.
    for (const dispose of [...disposers].reverse()) dispose()
  }
}

/**
 * Read a state change out of a record's payload, or null when it does not carry one.
 * @param record - the record to read.
 * @returns the id and state, or null.
 */
function stateOf(record: ControlRecord): { id: string, team: string | null, state: string, owner: string | null, name: string | null, role: string | null } | null {
  const payload = record.payload as { id?: unknown, state?: unknown, owner?: unknown, name?: unknown, role?: unknown } | undefined
  if (payload === undefined || typeof payload.id !== 'string' || payload.id === '') return null
  // The flag makes the fold drop ownership, which is the one fact a task board cannot be
  // rebuilt without. It exists so the gate can prove its projection injections would catch
  // that: a defect nobody can reproduce on demand is a defect nobody can test for.
  const keepOwner = !attackFlag('DSH_LINK_COLLAB_DROP_OWNER')
  // A record may carry a name and a role beside its id — the kernel's Team events do. They are
  // kept rather than dropped: a reader asked to show a member needs a name to show, and one
  // asked to place it in a hierarchy needs its role. The id stays the key, because a name is
  // what a roster refuses to reuse while an id is what a record actually addresses.
  const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
  // The team a record belongs to is read by the same helper every other fold uses, so the task
  // fold, the board and the lock table cannot attribute one record to two different teams — a
  // disagreement would key one fact two ways. A record that names no team folds into its own
  // unnamed bucket rather than into every other team's.
  return {
    id: payload.id,
    team: teamOf(record),
    state: text(payload.state) ?? 'open',
    owner: keepOwner ? text(payload.owner) : null,
    name: text(payload.name),
    role: text(payload.role),
  }
}

/* ------------------------------------------------------------------------------------------------
 * Cross-end dispatch: work handed to a member that runs somewhere else, and the result coming home.
 *
 * 《DSH LINK.md》§3 ③ asks that B's transit can put an Agent running on B into the Team. R44 landed
 * the routing fact (who runs where, whether the whole chain is alive) and the verdict about it; what
 * it did not do is hand work over and bring the answer back. This section is that half, and it is
 * still a protocol face: the two ends are two control logs, and what crosses is a record.
 *
 * The one decidable sentence is: a dispatched unit of work runs **at most once**, only at the member
 * it addresses, only while that member's capability ledger says it can do it, and the result that
 * counts is the one written by that member — everything else is refused **visibly**.
 */

/**
 * The record kind one end appends to hand a unit of work to a member.
 *
 * `id` is the dispatcher's own token, not a ledger-assigned one: the dispatcher mints it so that the
 * answer can be matched to the request across two logs, and the fold refuses a second dispatch that
 * reuses one (`duplicate-id`) rather than merging the two silently. Merging would be the same defect
 * the board avoided by keying on (team, id): one id answering two questions.
 */
export const DISPATCH_KIND = 'task/dispatch'

/** The record kind the addressed member appends with the answer. */
export const RESULT_KIND = 'task/result'

/** What one dispatch asked for, as read off its record. */
export interface DispatchRequest {
  /** The dispatcher's token for this unit of work. */
  readonly id: string
  /** The member the work is addressed to. */
  readonly to: string
  /** The tool name, which is also the capability the member must have declared. */
  readonly tool: string
  /** The tool's argument, in whatever shape the tool defines. */
  readonly args: unknown
  /** The instant the dispatcher wrote it, in milliseconds. */
  readonly at: number
  /** The work this attempt retries, when it is a retry: the root id of the piece of work. */
  readonly retryOf?: string
  /** Which attempt this is, when it is a retry. The id names it too; both are written so a reader
   * that only sees the payload can still tell an attempt from a first dispatch. */
  readonly attempt?: number
}

/** A handler that answered. */
export interface DispatchOutcomeOk {
  /** Always true, so an outcome can be switched on alone. */
  readonly ok: true
  /** What the handler returned. Only a successful outcome carries one. */
  readonly value: unknown
}

/** A handler that failed, or a tool nobody registered. */
export interface DispatchOutcomeFailed {
  /** Always false. */
  readonly ok: false
  /** Why it failed: the thrown message, or `unknown-tool`. */
  readonly error: string
}

/** What executing a tool produced. */
export type DispatchOutcome = DispatchOutcomeOk | DispatchOutcomeFailed

/** One result record, as folded. */
export interface DispatchResult {
  /** The dispatch it answers. */
  readonly id: string
  /** The member that wrote it, which must be the one the dispatch addressed. */
  readonly from: string
  /** Whether the tool succeeded. */
  readonly ok: boolean
  /** The tool's answer, present only on success. */
  readonly value?: unknown
  /** The failure, present only on failure. */
  readonly error?: string
  /** The instant the writer stamped, in milliseconds. */
  readonly at: number
  /** Sequence of the record it came from. */
  readonly seq: number
}

/** One dispatched unit of work and what became of it. */
export interface DispatchEntry {
  /** The dispatcher's token. */
  readonly id: string
  /** The member addressed. */
  readonly to: string
  /** The tool asked for. */
  readonly tool: string
  /** The argument, echoed from the record. */
  readonly args: unknown
  /** The instant the dispatcher stamped. */
  readonly at: number
  /** Sequence of the dispatch record. */
  readonly seq: number
  /** `pending` while unanswered, `answered` once a result from the addressed member was accepted,
   * `refused` when the capability ledger never allowed it in the first place. */
  readonly status: 'pending' | 'answered' | 'refused'
  /** The accepted result, or null. */
  readonly result: DispatchResult | null
}

/** A dispatch record the fold would not accept. */
export interface RefusedDispatch {
  /** The id the refused record carried. */
  readonly id: string
  /** The instant the record stamped. */
  readonly at: number
  /** Sequence of the refused record. */
  readonly seq: number
  /** `duplicate-id` when the id was already dispatched, `capability-mismatch` when the addressed
   * member's ledger never declared the tool. */
  readonly reason: 'duplicate-id' | 'capability-mismatch' | 'lease-mismatch'
}

/** A result record the fold would not accept. */
export interface RefusedDispatchResult {
  /** The dispatch id it claimed to answer. */
  readonly id: string
  /** The member that wrote it. */
  readonly from: string
  /** The instant the record stamped. */
  readonly at: number
  /** Sequence of the refused record. */
  readonly seq: number
  /** Why it was refused. */
  readonly reason: 'unknown-id' | 'wrong-writer' | 'refused-dispatch' | 'duplicate-result'
}

/** The folded dispatch state. */
export interface DispatchState {
  /** Every canonical dispatch, by id, ascending. */
  readonly dispatches: readonly DispatchEntry[]
  /** The accepted results, by id, ascending. */
  readonly results: readonly DispatchResult[]
  /** The ids still waiting for an answer, ascending. */
  readonly pending: readonly string[]
  /** Dispatch records that were not accepted. */
  readonly refusedDispatches: readonly RefusedDispatch[]
  /** Result records that were not accepted. */
  readonly refusedResults: readonly RefusedDispatchResult[]
  /** How many of each, so a reader does not have to count rows to see a refusal. */
  readonly counts: {
    readonly dispatches: number
    readonly results: number
    readonly pending: number
    readonly refusedDispatches: number
    readonly refusedResults: number
  }
}

/**
 * Build the record one end appends to hand work to a member.
 *
 * The instant travels inside the payload as well as on the record, because the payload is what a
 * peer reads after a relay: the record's own `at` is the receiving log's stamp, the payload's is
 * the dispatcher's, and a verdict about "how long has this been waiting" has to use the second.
 * @param id - the dispatcher's token, non-empty.
 * @param to - the member addressed, non-empty.
 * @param tool - the tool name, non-empty, and the capability the member must have declared.
 * @param args - the tool's argument.
 * @param at - the dispatcher's instant, in milliseconds.
 * @returns the record to append, without a sequence.
 */
export function dispatchRecord(id: string, to: string, tool: string, args: unknown, at: number, options?: { retryOf?: string, attempt?: number }): { kind: string, subject: string, payload: DispatchRequest } {
  if (typeof id !== 'string' || id === '') throw new TypeError('dispatchRecord: id must be a non-empty string')
  if (typeof to !== 'string' || to === '') throw new TypeError('dispatchRecord: to must be a non-empty string')
  if (typeof tool !== 'string' || tool === '') throw new TypeError('dispatchRecord: tool must be a non-empty string')
  const retry = options?.retryOf === undefined
    ? {}
    : { retryOf: options.retryOf, attempt: options.attempt ?? attemptOf(id).attempt }
  return { kind: DISPATCH_KIND, subject: id, payload: { id, to, tool, args, at, ...retry } }
}

/** One result as it is about to be written, before it is matched against the dispatch it answers. */
export interface ResultDraft {
  /** The record kind, so a draft is appendable as it stands. */
  readonly kind: string
  /** The dispatch id it answers. */
  readonly subject: string
  /** The fields the fold reads: who answered, whether it worked, and the answer or the failure. */
  readonly payload: { readonly id: string, readonly from: string, readonly ok: boolean, readonly value?: unknown, readonly error?: string, readonly at: number }
}

/**
 * Build the record the addressed member appends with its answer.
 *
 * A failed outcome carries `error` and never `value`, and a successful one the other way round:
 * an answer that could be read as either would make "did it work" a question about which field a
 * reader happened to look at first.
 * @param id - the dispatch being answered, non-empty.
 * @param from - the member answering, non-empty.
 * @param outcome - what the tool produced.
 * @param at - the answering end's instant, in milliseconds.
 * @returns the record to append, without a sequence.
 */
export function resultRecord(id: string, from: string, outcome: DispatchOutcome, at: number): ResultDraft {
  if (typeof id !== 'string' || id === '') throw new TypeError('resultRecord: id must be a non-empty string')
  if (typeof from !== 'string' || from === '') throw new TypeError('resultRecord: from must be a non-empty string')
  const payload = outcome.ok
    ? { id, from, ok: true, value: outcome.value, at }
    : { id, from, ok: false, error: outcome.error, at }
  return { kind: RESULT_KIND, subject: id, payload }
}

/**
 * Read the request one record carries, or null when it does not carry a usable one.
 *
 * A record with a missing id, addressee or tool is null rather than defaulted: every one of the
 * three is an address, and an address nobody wrote is not a fact about the ledger.
 * @param record - the record to read.
 * @returns the request, or null.
 */
function dispatchOf(record: ControlRecord): DispatchRequest | null {
  if (record.kind !== DISPATCH_KIND) return null
  const payload = record.payload as { id?: unknown, to?: unknown, tool?: unknown, args?: unknown, at?: unknown, retryOf?: unknown, attempt?: unknown } | undefined
  const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
  const id = text(payload?.id) ?? text(record.subject)
  const to = text(payload?.to)
  const tool = text(payload?.tool)
  if (id === null || to === null || tool === null) return null
  const retryOf = text(payload?.retryOf)
  const attempt = typeof payload?.attempt === 'number' && Number.isInteger(payload.attempt) && payload.attempt > 0 ? payload.attempt : undefined
  return {
    id,
    to,
    tool,
    args: payload?.args,
    at: typeof payload?.at === 'number' ? payload.at : record.at,
    ...(retryOf === null ? {} : { retryOf }),
    ...(attempt === undefined ? {} : { attempt }),
  }
}

/**
 * Read the answer one record carries, or null when it does not carry a usable one.
 * @param record - the record to read.
 * @returns the answering member, the id, the outcome and the instant, or null.
 */
function answerOf(record: ControlRecord): { id: string, from: string, outcome: DispatchOutcome, at: number } | null {
  if (record.kind !== RESULT_KIND) return null
  const payload = record.payload as { id?: unknown, from?: unknown, ok?: unknown, value?: unknown, error?: unknown, at?: unknown } | undefined
  const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
  const id = text(payload?.id) ?? text(record.subject)
  const from = text(payload?.from) ?? text(record.actor)
  if (id === null || from === null || typeof payload?.ok !== 'boolean') return null
  const at = typeof payload.at === 'number' ? payload.at : record.at
  const outcome: DispatchOutcome = payload.ok === true
    ? { ok: true, value: payload.value }
    : { ok: false, error: typeof payload.error === 'string' ? payload.error : 'failed' }
  return { id, from, outcome, at }
}

/**
 * Fold dispatches and their answers.
 *
 * Records are ordered by `seq` before anything else, so the same set of records arranged differently
 * folds to the same state: a relay may hand the lines over in any order, and a comparison between two
 * folds is only meaningful when the difference is a fact and not an arrival accident.
 *
 * Capability is decided here and nowhere else: a dispatch whose tool the addressed member never
 * declared is `refused` in the projection, and the executor reads that verdict instead of repeating
 * the rule. A dispatch is answered by exactly one result — the first one from the addressed member —
 * and every later one is refused as `duplicate-result` rather than overwriting an answer that has
 * already been read by whoever is acting on it.
 * @param records - every record read from the log, in any order.
 * @returns the folded dispatch state.
 */
/** The mutable state of {@link projectDispatches}: the dispatches and answers folded so far. */
interface DispatchesFoldState {
  entries: Map<string, { request: DispatchRequest, seq: number }>
  refusedDispatches: RefusedDispatch[]
  refusedResults: RefusedDispatchResult[]
  accepted: Map<string, DispatchResult>
  /** The highest instant any retry attempt carried: a later lease below it could change a verdict. */
  maxRetryAt: number | null
  /** Every member any dispatch record addressed (accepted or refused): capability changes matter for them. */
  members: Set<string>
  /** How many lease rows the cached buckets were built from. */
  leasesSeen: number
  leasesByRoot: Map<string, RetryLease[]>
}

function emptyDispatchesFold(): DispatchesFoldState {
  return { entries: new Map(), refusedDispatches: [], refusedResults: [], accepted: new Map(), maxRetryAt: null, members: new Set(), leasesSeen: -1, leasesByRoot: new Map() }
}

/**
 * Step the dispatch fold over one batch of records.
 *
 * `declared` and `leases` are the OTHER folds read as one authority each, passed in rather than
 * re-derived: a second copy of "who may do this" or "who holds the root" is how two folds come to
 * disagree. The lease buckets are cached by the number of lease rows seen, so a steady append does
 * not rebuild them.
 */
function foldDispatches(state: DispatchesFoldState, records: readonly ControlRecord[], declared: RegistryState, leases: readonly RetryLease[]): void {
  if (state.leasesSeen !== leases.length) {
    state.leasesSeen = leases.length
    state.leasesByRoot = new Map()
    for (const lease of leases) {
      const bucket = state.leasesByRoot.get(lease.root)
      if (bucket === undefined) state.leasesByRoot.set(lease.root, [lease])
      else bucket.push(lease)
    }
  }
  const ordered = orderedRecords(records)
  for (const record of ordered) {
    const request = dispatchOf(record)
    if (request === null) continue
    // Checked before the duplicate rule, and checked against the claims written no later than this
    // attempt: a claim that did not exist yet cannot authorise an attempt, and two ends that raced
    // write the same id — the one that was not the holder must not take the id from the holder by
    // arriving first. `actor` is what the writer said about itself; `writer` is the log it was
    // written into, which a relay preserves.
    const writer = record.actor ?? record.writer ?? null
    state.members.add(request.to)
    if (request.retryOf !== undefined) {
      if (state.maxRetryAt === null || request.at > state.maxRetryAt) state.maxRetryAt = request.at
      // R71: a claim constrains RETRIES, not the work itself.
      const attemptRoot = attemptOf(request.id).root
      const rootLeases = state.leasesByRoot.get(attemptRoot) ?? []
      const held = retryOwner(rootLeases.filter((lease) => lease.at <= request.at), { root: attemptRoot, localEnd: writer ?? '', now: request.at })
      if (held.holder !== null && held.holder !== writer) {
        state.refusedDispatches.push({ id: request.id, at: request.at, seq: record.seq, reason: 'lease-mismatch' })
        continue
      }
    }
    if (state.entries.has(request.id)) {
      state.refusedDispatches.push({ id: request.id, at: request.at, seq: record.seq, reason: 'duplicate-id' })
      continue
    }
    state.entries.set(request.id, { request, seq: record.seq })
    // Capability is the authority, and it is a statement about the ledger: a member that never
    // declared the tool is not a member that can do the work, however the dispatch is worded.
    if (!declared.byCapability[request.tool]?.includes(request.to)) {
      state.refusedDispatches.push({ id: request.id, at: request.at, seq: record.seq, reason: 'capability-mismatch' })
    }
  }

  const refusedIds = new Set(state.refusedDispatches.filter((row) => row.reason === 'capability-mismatch').map((row) => row.id))
  for (const record of ordered) {
    const answer = answerOf(record)
    if (answer === null) continue
    const entry = state.entries.get(answer.id)
    if (entry === undefined) {
      state.refusedResults.push({ id: answer.id, from: answer.from, at: answer.at, seq: record.seq, reason: 'unknown-id' })
      continue
    }
    if (refusedIds.has(answer.id)) {
      state.refusedResults.push({ id: answer.id, from: answer.from, at: answer.at, seq: record.seq, reason: 'refused-dispatch' })
      continue
    }
    if (answer.from !== entry.request.to) {
      state.refusedResults.push({ id: answer.id, from: answer.from, at: answer.at, seq: record.seq, reason: 'wrong-writer' })
      continue
    }
    if (state.accepted.has(answer.id)) {
      state.refusedResults.push({ id: answer.id, from: answer.from, at: answer.at, seq: record.seq, reason: 'duplicate-result' })
      continue
    }
    state.accepted.set(answer.id, { id: answer.id, from: answer.from, ok: answer.outcome.ok, ...(answer.outcome.ok ? { value: answer.outcome.value } : { error: answer.outcome.error }), at: answer.at, seq: record.seq })
  }
}

function finishDispatches(state: DispatchesFoldState): DispatchState {
  const refusedIds = new Set(state.refusedDispatches.filter((row) => row.reason === 'capability-mismatch').map((row) => row.id))
  const dispatches: DispatchEntry[] = [...state.entries.values()]
    .map((entry) => {
      const result = state.accepted.get(entry.request.id) ?? null
      const status: DispatchEntry['status'] = refusedIds.has(entry.request.id) ? 'refused' : (result === null ? 'pending' : 'answered')
      return { ...entry.request, seq: entry.seq, status, result }
    })
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  const results = [...state.accepted.values()].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  const pending = dispatches.filter((entry) => entry.status === 'pending').map((entry) => entry.id)
  const refusedDispatches = [...state.refusedDispatches].sort((left, right) => left.seq - right.seq)
  const refusedResults = [...state.refusedResults].sort((left, right) => left.seq - right.seq)
  return {
    dispatches,
    results,
    pending,
    refusedDispatches,
    refusedResults,
    counts: {
      dispatches: dispatches.length,
      results: results.length,
      pending: pending.length,
      refusedDispatches: refusedDispatches.length,
      refusedResults: refusedResults.length,
    },
  }
}

export function projectDispatches(records: readonly ControlRecord[]): DispatchState {
  const state = emptyDispatchesFold()
  foldDispatches(state, records, projectRegistry(records), projectRetryLeases(records))
  return finishDispatches(state)
}
/**
 * What one dispatch id means right now.
 *
 * The verdict is the entry's own status, echoed rather than re-derived: an id the ledger never saw is
 * `unknown-id`, and a caller can tell "nobody dispatched this" from "it was dispatched and refused"
 * without inspecting the refusal rows.
 */
export interface DispatchVerdict {
  /** The id asked about. */
  readonly id: string
  /** `unknown-id` when the ledger never carried it, `stale` when a pending one has waited at least
   * `timeoutMs`, else the entry's own status. */
  readonly verdict: 'unknown-id' | 'refused' | 'pending' | 'answered' | 'stale'
}

/**
 * The threshold that separates "still waiting" from "waited too long".
 *
 * The threshold is the caller's, not this build's: there is no default here on purpose. A dispatched
 * unit of work has no inherent deadline — the same dispatch is on time for a chat turn and late for a
 * build — so a reader that invented one would be answering a question nobody asked, and the answer
 * would be indistinguishable from a real reading.
 */
export interface DispatchTimeoutOptions {
  /** How long a pending dispatch may wait, in milliseconds. Absent means no threshold was given. */
  readonly timeoutMs?: number
}

/**
 * Read one threshold off an options bag, refusing a value that cannot be a duration.
 *
 * `undefined` is "no threshold given" and answers null. Any other non-duration — a string, NaN, a
 * negative number — throws rather than being coerced: `NaN` compared with `>=` is false, so a caller
 * that wrote `timeoutMs: Number(process.env.T)` would get "never stale" forever, which reads exactly
 * like "nothing has timed out" and would hide a deadline that never fired.
 * @param raw - the value the caller passed, or undefined.
 * @param caller - the name to name in the error.
 * @returns the threshold, or null when none was given.
 */
function timeoutOf(raw: unknown, caller: string): number | null {
  if (raw === undefined) return null
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    throw new TypeError(caller + ': timeoutMs must be a finite, non-negative number of milliseconds')
  }
  return raw
}

/**
 * Answer what one dispatched unit of work is now.
 *
 * `stale` is a reading about **time**, never about the member: it says the dispatcher's clock has run
 * past the threshold it passed in, and says nothing about whether the addressee is alive. "This could
 * not be delivered" is a different question with its own answer (`route-down`/`member-silent` in
 * {@link assignThrough}), and merging the two would report a healthy member as a dead one the moment
 * work sat in a queue.
 *
 * `answered` and `refused` are never overridden by `stale`: a clock cannot take back an answer the
 * ledger already holds, and an id the ledger never carried stays `unknown-id` — "we never dispatched
 * this" is not "it waited too long".
 * @param state - a folded state.
 * @param id - the dispatch id.
 * @param now - the instant the question is asked at, in milliseconds.
 * @param options - the threshold, when the caller has one. Without it the verdict is `pending` for a
 * pending entry: no threshold, no conclusion.
 * @returns the id and its verdict.
 */
export function resolveDispatch(state: TeamState, id: string, now: number, options?: DispatchTimeoutOptions): DispatchVerdict {
  const threshold = timeoutOf(options?.timeoutMs, 'resolveDispatch')
  const entry = state.dispatches.dispatches.find((row) => row.id === id)
  if (entry === undefined) return { id, verdict: 'unknown-id' }
  if (entry.status !== 'pending') return { id, verdict: entry.status }
  if (threshold === null) return { id, verdict: 'pending' }
  // The boundary is inclusive, matching `sinceMs >= timeoutMs` in the liveness fold: at exactly the
  // threshold the wait has lasted the whole timeout, and a reader that used `>` would report "still
  // waiting" for an instant that any other reader of the same number calls expired.
  return { id, verdict: now - entry.at >= threshold ? 'stale' : 'pending' }
}

/**
 * List the dispatches that have waited at least `timeoutMs`, by id, ascending.
 *
 * The rule is read through {@link resolveDispatch} rather than restated, so a list and a verdict can
 * never disagree about the same id; the sort makes the answer a set rather than an arrival accident,
 * exactly as the fold does. Only pending work can expire: an answered or refused dispatch is not
 * waiting, and re-dispatching one is a new id rather than a reuse (see {@link dispatchRecord}).
 * @param state - a folded state.
 * @param now - the instant the question is asked at, in milliseconds.
 * @param options - the threshold; required, because a list of expired work needs a deadline to be
 * expired against.
 * @returns the stale ids, ascending.
 */
export function expiredDispatches(state: TeamState, now: number, options: { timeoutMs: number }): readonly string[] {
  const threshold = timeoutOf(options?.timeoutMs, 'expiredDispatches')
  if (threshold === null) throw new TypeError('expiredDispatches: timeoutMs is required')
  return state.dispatches.dispatches
    .filter((entry) => resolveDispatch(state, entry.id, now, { timeoutMs: threshold }).verdict === 'stale')
    .map((entry) => entry.id)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

/** Whether an answer would be accepted, and why not when it would not. */
export interface ResultVerdict {
  /** The dispatch id the answer claims to be about. */
  readonly id: string
  /** Whether the ledger would accept it. */
  readonly accepted: boolean
  /** `accepted`, or the reason the answer is not the answer. */
  readonly reason: 'accepted' | 'unknown-id' | 'wrong-writer' | 'refused-dispatch' | 'duplicate-result'
}

/**
 * Decide whether one answer is the answer to its dispatch.
 *
 * This is the rule the write face applies and the fold applies, in one place: only the addressed
 * member answers, only once, and only work that was allowed in the first place. A caller that keeps
 * its own copy of the rule would let one end accept what another refuses.
 * @param state - a folded state.
 * @param draft - the answer that is about to be written.
 * @returns whether it would be accepted, and why.
 */
export function acceptResult(state: TeamState, draft: ResultDraft): ResultVerdict {
  const entry = state.dispatches.dispatches.find((row) => row.id === draft.payload.id)
  if (entry === undefined) return { id: draft.payload.id, accepted: false, reason: 'unknown-id' }
  if (entry.status === 'refused') return { id: entry.id, accepted: false, reason: 'refused-dispatch' }
  if (draft.payload.from !== entry.to) return { id: entry.id, accepted: false, reason: 'wrong-writer' }
  if (entry.result !== null) return { id: entry.id, accepted: false, reason: 'duplicate-result' }
  return { id: entry.id, accepted: true, reason: 'accepted' }
}

/** What one attempt to write an answer did. */
export interface AppendResultOutcome {
  /** Whether a `task/result` record was appended. */
  readonly appended: boolean
  /** `ok` when it was, otherwise the shared verdict's reason. */
  readonly reason: string
  /** The sequence the appended record was given, or null when nothing was appended. */
  readonly seq: number | null
}

/**
 * Write one answer, if the ledger says it is the answer — and append nothing when it does not.
 *
 * The write face of the same fact {@link acceptResult} answers on the read side, called rather than
 * re-derived, exactly as {@link appendTurn} treats {@link mayWrite}. A refusal has to leave the
 * ledger byte for byte as it was; that is the reading, not the verdict alone.
 * @param state - the folded state the verdict is read from.
 * @param log - the control log to append to. Nothing else is written.
 * @param draft - the answer, built by {@link resultRecord}.
 * @returns whether a record was appended, why, and its sequence.
 */
export async function appendResult(state: TeamState, log: ControlLog, draft: ResultDraft): Promise<AppendResultOutcome> {
  const verdict = acceptResult(state, draft)
  if (verdict.reason === 'accepted') {
    const seq = await log.append(draft)
    return { appended: true, reason: 'ok', seq }
  }
  return { appended: false, reason: verdict.reason, seq: null }
}

/**
 * The tools this end can run for a dispatch.
 *
 * A registry the caller holds, not a module-level table: a process-wide one would make two ends in
 * one process share their tools, and the shared tool a test cannot see is the bug this shape exists
 * to prevent. `register` returns its own disposer, so a fiber that installs tools removes them.
 */
export interface LocalTools {
  /** Install a handler under a tool name; the returned function removes it again. */
  readonly register: (name: string, handler: (args: unknown) => unknown) => () => void
  /** Whether a name is installed right now. */
  readonly has: (name: string) => boolean
  /**
   * Run one tool; an uninstalled name answers `unknown-tool` rather than throwing.
   *
   * A tool **may answer asynchronously**: work that happens in another process — an MCP server is the
   * case this shape exists for — cannot be answered before it happens, so a thenable comes back here
   * and the executor awaits it. A rejection becomes the same failed outcome a throwing handler
   * produces, so "it failed" has one spelling whichever half of the call failed.
   */
  readonly invoke: (name: string, args: unknown) => DispatchOutcome | Promise<DispatchOutcome>
}

/**
 * Whether a value is promise-like, so a caller must await it.
 * @param value - the value a handler returned.
 * @returns true when the value carries a callable `then`.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function'
}

/**
 * Create an empty tool registry.
 * @returns the registry: register, has, invoke.
 */
export function createLocalTools(): LocalTools {
  const handlers = new Map<string, (args: unknown) => unknown>()
  return {
    register: (name, handler) => {
      if (typeof name !== 'string' || name === '') throw new TypeError('register: name must be a non-empty string')
      if (typeof handler !== 'function') throw new TypeError('register: handler must be a function')
      const previous = handlers.get(name)
      handlers.set(name, handler)
      let removed = false
      return () => {
        if (removed) return
        removed = true
        if (previous === undefined) handlers.delete(name)
        else handlers.set(name, previous)
      }
    },
    has: (name) => handlers.has(name),
    invoke: (name, args) => {
      const handler = handlers.get(name)
      if (handler === undefined) return { ok: false, error: 'unknown-tool' }
      let produced: unknown
      try {
        produced = handler(args)
      } catch (error) {
        // The failure is the answer: a handler that throws has to be reported as a failed result,
        // because swallowing it would make a broken tool look like a pending one forever.
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      // A handler that returns a thenable is awaited by the executor rather than written out as it
      // stands: an unawaited promise serialises to `{}`, which reads as an answer that said nothing.
      // Either way the REGISTRY owns the outcome shape and the handler owns the value — one convention,
      // one owner. R56 briefly let a handler return an outcome as well, and a plain handler's success
      // then came back unwrapped: `executeDispatches` read `ok === undefined` and wrote the ledger row
      // as `ok:false`. No gate noticed, because no gate ran a plain handler through the executor; R62's
      // gate did, and it read the ledger rather than the in-memory outcome.
      if (isThenable(produced)) {
        return Promise.resolve(produced).then(
          (settled) => ({ ok: true, value: settled }),
          (error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
        )
      }
      return { ok: true, value: produced }
    },
  }
}

/** One dispatch this end ran, and what it produced. */
export interface ExecutedDispatch {
  /** The dispatch id. */
  readonly id: string
  /** What the tool produced. */
  readonly outcome: DispatchOutcome
  /** Whether the answer was appended, and why not when it was not. */
  readonly reason: string
}

/** One dispatch this end did not run. */
export interface RefusedExecution {
  /** The dispatch id. */
  readonly id: string
  /** `unknown-tool` when nothing is installed under that name. */
  readonly reason: string
}

/** What one execution pass did. */
export interface DispatchExecution {
  /** The dispatches this end ran and answered. */
  readonly executed: readonly ExecutedDispatch[]
  /** The dispatches it would not run. */
  readonly refused: readonly RefusedExecution[]
}

/**
 * Run every dispatch this end is addressed by, and answer each one.
 *
 * Only `pending` entries are run, and only those addressed to `local`: a refused dispatch was never
 * allowed, and an answered one is already answered — running it again would make "at most once"
 * depend on how often a caller polls. The answer goes through {@link appendResult}, so a caller that
 * is not the addressed member writes nothing.
 *
 * An uninstalled tool is refused **without** a record: there is nothing to report to the dispatcher
 * that "I do not have this tool" would improve, and writing a failure would spend the one answer the
 * dispatch has on a local misconfiguration rather than on the work.
 *
 * A pending attempt that a later attempt has **superseded** is not run either: a ledger is append-only,
 * so a re-dispatch leaves the stale attempt exactly where it was, and an executor that ran every
 * pending row would do the work twice — the very thing re-dispatching exists to avoid. Supersession is
 * read from the ids (`<root>#r<n>`), so it survives replay without a second source of truth.
 * @param state - the folded state the work is read from.
 * @param options - this end's member id, its tools, the log to answer into, and the clock.
 * @returns what was run and what was refused.
 */
export async function executeDispatches(state: TeamState, options: { local: string, tools: LocalTools, log: ControlLog, now: number, at?: number }): Promise<DispatchExecution> {
  const executed: ExecutedDispatch[] = []
  const refused: RefusedExecution[] = []
  const at = options.at ?? options.now
  for (const id of state.dispatches.pending) {
    const entry = state.dispatches.dispatches.find((row) => row.id === id)
    if (entry === undefined || entry.to !== options.local) continue
    const mine = attemptOf(id)
    const superseded = state.dispatches.dispatches.some((row) => {
      const other = attemptOf(row.id)
      return other.root === mine.root && other.attempt > mine.attempt
    })
    if (superseded) {
      refused.push({ id, reason: 'superseded' })
      continue
    }
    if (!options.tools.has(entry.tool)) {
      refused.push({ id, reason: 'unknown-tool' })
      continue
    }
    const outcome = await options.tools.invoke(entry.tool, entry.args)
    const written = await appendResult(state, options.log, resultRecord(id, options.local, outcome, at))
    executed.push({ id, outcome, reason: written.reason })
  }
  return { executed, refused }
}
/* ------------------------------------------------------------------------------------------------
 * Retrying work that was never answered: the other half of "at most once".
 *
 * R53 made one dispatch be answered at most once, R54 made silence decidable (`stale`), and R44 made
 * "can work be handed over right now" a verdict. What none of them did is say what a dispatcher is
 * supposed to DO about a stale dispatch — so a rule that used to be a convention ("re-dispatch under a
 * new id", R53) becomes the thing this section computes, with the same discipline as everything else:
 * the decision is a pure function of the ledger and the clock the caller supplies, and the write face
 * appends only what that decision produced.
 */

/** One attempt that should be made, derived from one that was never answered. */
export interface RedispatchEntry {
  /** The stale dispatch this attempt replaces. */
  readonly from: string
  /** The new id: the work's root id, `#r`, and the attempt number. */
  readonly id: string
  /** Which attempt this is: the first dispatch of a piece of work is attempt 1. */
  readonly attempt: number
  /** The member addressed, unchanged from the stale dispatch. */
  readonly to: string
  /** The tool, unchanged. */
  readonly tool: string
  /** The argument, unchanged. */
  readonly args: unknown
}

/** One attempt that should NOT be made, and why not. */
export interface RedispatchBlocked {
  /** The stale dispatch that would have been retried. */
  readonly from: string
  /** The attempt number that was refused. */
  readonly attempt: number
  /** Why. `already-attempted` means the ledger already carries that id, so retrying would be a
   * second dispatch of one id (which the fold refuses as `duplicate-id`). */
  readonly reason: 'route-down' | 'member-silent' | 'no-route' | 'path-cycle' | 'not-member' | 'not-in-team' | 'attempts-exhausted' | 'already-attempted' | 'lease-held'
}

/** What a caller should do about the work that has waited too long. */
export interface RedispatchPlan {
  /** The attempts to append, by new id, ascending. */
  readonly entries: readonly RedispatchEntry[]
  /** The attempts that were refused, by the stale id they came from. */
  readonly blocked: readonly RedispatchBlocked[]
}

/**
 * Read one dispatch id as (root, attempt).
 *
 * A retry names itself: `<root>#r<attempt>`. Reading the attempt back out of the id is what keeps the
 * rule replayable — a number stored beside the record could be edited away from the id it belongs to,
 * and then "which attempt is this" would depend on which field a reader trusted.
 * @param id - the dispatch id.
 * @returns the work's root id and the attempt number it names.
 */
function attemptOf(id: string): { root: string, attempt: number } {
  const match = /^(.*)#r(\d+)$/.exec(id)
  if (match === null) return { root: id, attempt: 1 }
  return { root: match[1], attempt: Number(match[2]) }
}

/**
 * The record kind one end writes to claim the right to retry a root.
 *
 * Retrying is the half of "at most once" that needs a second party: two ends can each decide the
 * same dispatch is stale, and each can write an attempt under the same name. A duplicate id stops
 * the second write inside ONE ledger; it says nothing about two ledgers that are merged later. The
 * lease is that missing fact, and it is a fact about the ledger rather than about a timer, so a
 * merged history can be read back and judged by anyone.
 */
export const RETRY_LEASE_KIND = 'task/retry-lease'

/** One end's claim on retrying a root, as folded. */
export interface RetryLease {
  /** The work's root id: the id every attempt of this work is named after. */
  readonly root: string
  /** The end that holds the claim. */
  readonly end: string
  /** The instant the claim was written, in milliseconds. */
  readonly at: number
  /** How long the claim lives from `at`, in milliseconds. */
  readonly untilMs: number
  /** Sequence of the record this row came from. */
  readonly seq: number
}

/** Who may retry a root right now, and why. */
export interface RetryOwnerVerdict {
  /** The end that holds the root's live claim, or null when nobody does. */
  readonly holder: string | null
  /** Whether that end is this one. */
  readonly mine: boolean
  /** `unclaimed` nobody ever claimed it, `expired` only dead claims exist (anybody may take it),
   * `mine`/`other` a live claim exists and names this end or another. */
  readonly reason: 'unclaimed' | 'mine' | 'other' | 'expired'
}

/**
 * Build the record one end appends to claim the right to retry a root.
 *
 * The end travels inside the payload as well as in the record's writer, because the payload is what a
 * peer reads after a relay: the receiving log's own writer is the relaying end, and a claim whose
 * holder was read from there would name whoever forwarded it.
 * @param root - the work's root id, non-empty.
 * @param end - the claiming end, non-empty.
 * @param at - the instant the claim is made, in milliseconds.
 * @param untilMs - how long the claim lives, a positive integer.
 * @returns the record to append, without a sequence.
 */
export function retryLeaseRecord(root: string, end: string, at: number, untilMs: number): { kind: string, subject: string, payload: { root: string, end: string, at: number, untilMs: number } } {
  if (typeof root !== 'string' || root === '') throw new TypeError('retryLeaseRecord: root must be a non-empty string')
  if (typeof end !== 'string' || end === '') throw new TypeError('retryLeaseRecord: end must be a non-empty string')
  if (!Number.isInteger(untilMs) || untilMs <= 0) throw new TypeError('retryLeaseRecord: untilMs must be a positive integer')
  return { kind: RETRY_LEASE_KIND, subject: root, payload: { root, end, at, untilMs } }
}

/**
 * Read the claim one record carries, or null when it does not carry a usable one.
 * @param record - the record to read.
 * @returns the claim's fields, or null.
 */
function leaseOf(record: ControlRecord): { root: string, end: string, at: number, untilMs: number } | null {
  if (record.kind !== RETRY_LEASE_KIND) return null
  const payload = record.payload as { root?: unknown, end?: unknown, at?: unknown, untilMs?: unknown } | undefined
  const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
  const root = text(payload?.root) ?? text(record.subject)
  const end = text(payload?.end) ?? text(record.actor)
  const untilMs = payload?.untilMs
  if (root === null || end === null) return null
  if (typeof untilMs !== 'number' || !Number.isInteger(untilMs) || untilMs <= 0) return null
  return { root, end, at: typeof payload?.at === 'number' ? payload.at : record.at, untilMs }
}

/**
 * Fold the claims on retrying roots.
 *
 * Ordered by the writers' own clocks and then by arrival, so the same set of records folds to the
 * same rows however a relay handed them over.
 * @param records - control records, in any order.
 * @returns the claims, oldest first.
 */
/** The mutable state of {@link projectRetryLeases}: every claim row folded so far. */
interface RetryLeasesFoldState {
  rows: RetryLease[]
}

function emptyRetryLeasesFold(): RetryLeasesFoldState {
  return { rows: [] }
}

function foldRetryLeases(state: RetryLeasesFoldState, records: readonly ControlRecord[]): void {
  for (const record of records) {
    const lease = leaseOf(record)
    if (lease === null) continue
    state.rows.push({ ...lease, seq: record.seq })
  }
}

function finishRetryLeases(state: RetryLeasesFoldState): readonly RetryLease[] {
  return [...state.rows].sort((left, right) => left.at - right.at || left.seq - right.seq)
}

export function projectRetryLeases(records: readonly ControlRecord[]): readonly RetryLease[] {
  const state = emptyRetryLeasesFold()
  foldRetryLeases(state, records)
  return finishRetryLeases(state)
}

/**
 * Decide which end may retry a root at one instant.
 *
 * Pure: `now` is the caller's, so a replay of the same ledger and the same instant gives the same
 * answer (R40). A claim is live while `now - at < untilMs` — the equality case is expired, the same
 * discipline R54 put on staleness, because "the claim has just run out" and "the claim is still
 * held" must not both be true.
 *
 * The holder is the smallest `end` among the live claims, ties broken by the older claim. That is
 * deliberately not "the first claim I saw": two ends that race both write, and the merged ledger has
 * to crown exactly one of them from the records themselves, in an order nobody controls.
 * @param leases - the folded claims.
 * @param options - the root asked about, this end, and the instant.
 * @returns the holder, whether it is this end, and which of the four cases it is.
 */
export function retryOwner(leases: readonly RetryLease[], options: { root: string, localEnd: string, now: number }): RetryOwnerVerdict {
  const relevant = leases.filter((lease) => lease.root === options.root)
  if (relevant.length === 0) return { holder: null, mine: false, reason: 'unclaimed' }
  const live = relevant.filter((lease) => options.now - lease.at < lease.untilMs)
  if (live.length === 0) return { holder: null, mine: false, reason: 'expired' }
  const ordered = [...live].sort((left, right) => (left.end < right.end ? -1 : left.end > right.end ? 1 : 0) || left.at - right.at || left.seq - right.seq)
  const holder = ordered[0].end
  const mine = holder === options.localEnd
  return { holder, mine, reason: mine ? 'mine' : 'other' }
}

/**
 * Decide which stale dispatches should be tried again, and under which id.
 *
 * Pure: it reads the folded state, the ledger's own id vocabulary and the caller's clock, and writes
 * nothing. The refusals are deliberate and each names a different fact: the work is not reachable
 * right now (the routing verdict, R44, called rather than re-derived), or this caller has already
 * spent its attempts — either because `maxAttempts` is reached, or because the ledger already holds
 * the id the next attempt would use.
 *
 * There is deliberately **no capability check here**. R53 ruled that the capability judgement has one
 * owner, the projection: a dispatch whose tool the addressed member does not declare is `refused`
 * there, and a refused dispatch is not stale and never reaches this function. A second check would
 * give one question two answers, and the second one would be the one nobody could see in the fold.
 * @param state - a folded state.
 * @param options - the team, this end, the clock, the staleness threshold and the attempt cap.
 * @returns the attempts to make and the ones refused with their reasons.
 */
export function redispatchPlan(state: TeamState, options: { team: string, localEnd: string, now: number, timeoutMs: number, maxAttempts: number }): RedispatchPlan {
  const stale = expiredDispatches(state, options.now, { timeoutMs: options.timeoutMs })
  const entries: RedispatchEntry[] = []
  const blocked: RedispatchBlocked[] = []
  // R345 (perf): the loop looked its own dispatch up with .find and asked retryOwner about every lease for every id -
  // two whole-table scans per stale attempt. Measured at stale=6,400 by the research: redispatchPlan 399 ms of
  // synchronous work. One id index and one lease bucket per root remove both scans.
  const byId = new Map(state.dispatches.dispatches.map((row) => [row.id, row] as const))
  const leasesByRoot = new Map<string, typeof state.retryLeases>()
  for (const lease of state.retryLeases) {
    const bucket = leasesByRoot.get(lease.root)
    if (bucket === undefined) leasesByRoot.set(lease.root, [lease])
    else bucket.push(lease)
  }
  for (const id of stale) {
    const entry = byId.get(id)
    if (entry === undefined) continue
    const { root, attempt } = attemptOf(id)
    const next = attempt + 1
    // Asked before the attempt is even counted: whether this end may act on the root at all is a
    // different question from how many attempts it has spent, and the answer comes from the ledger.
    const owner = retryOwner(leasesByRoot.get(root) ?? [], { root, localEnd: options.localEnd, now: options.now })
    if (owner.reason === 'other') {
      blocked.push({ from: id, attempt: next, reason: 'lease-held' })
      continue
    }
    if (next > options.maxAttempts) {
      blocked.push({ from: id, attempt: next, reason: 'attempts-exhausted' })
      continue
    }
    const candidate = root + '#r' + String(next)
    if (state.dispatches.dispatches.some((row) => row.id === candidate)) {
      blocked.push({ from: id, attempt: next, reason: 'already-attempted' })
      continue
    }

    const reachable = assignThrough(state, options.team, entry.to, options.localEnd, options.now, { timeoutMs: options.timeoutMs })
    if (!reachable.ok) {
      // `ok` and `local` are the two permissive answers, so a refusal here is one of the routing
      // verdicts and is carried through by name rather than translated.
      blocked.push({ from: id, attempt: next, reason: reachable.reason as RedispatchBlocked['reason'] })
      continue
    }
    entries.push({ from: id, id: candidate, attempt: next, to: entry.to, tool: entry.tool, args: entry.args })
  }
  entries.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  blocked.sort((left, right) => (left.from < right.from ? -1 : left.from > right.from ? 1 : 0))
  return { entries, blocked }
}

/**
 * Append the attempts a plan asks for, and nothing else.
 *
 * The write face of {@link redispatchPlan}, and idempotent for the same reason `appendResult` is: the
 * second call plans nothing, because the ids the first call wrote are in the ledger and no longer
 * need to be invented. A caller that computed the plan, slept, and then wrote it would need this to
 * re-derive the plan; recomputing here is what makes "what to do" and "what was written" one fact.
 * @param state - the folded state the plan is re-derived from.
 * @param log - the control log to append to.
 * @param options - the same options the plan was asked with; the plan is recomputed, not trusted.
 * @returns the sequences appended, in the order they were written.
 */
export async function appendRedispatches(state: TeamState, log: ControlLog, options: { team: string, localEnd: string, now: number, timeoutMs: number, maxAttempts: number }): Promise<readonly number[]> {
  const plan = redispatchPlan(state, options)
  if (plan.entries.length === 0) return []
  const written: number[] = []
  let folded = state
  // One claim per root this plan wants to act on. A root this end already holds is left alone: the
  // claim is live, and a second one would only be a record nobody reads.
  const roots = [...new Set(plan.entries.map((entry) => attemptOf(entry.id).root))].sort()
  for (const root of roots) {
    const before = retryOwner(folded.retryLeases, { root, localEnd: options.localEnd, now: options.now })
    if (before.reason !== 'unclaimed' && before.reason !== 'expired') continue
    // The claim's lifetime is the caller's staleness threshold: a second knob for "how long may I
    // retry this" would be a second answer to a question that already has one.
    written.push(await log.append(retryLeaseRecord(root, options.localEnd, options.now, options.timeoutMs)))
    // Re-folded from the ledger rather than patched in memory: whether this end won the race is a
    // fact about what the log holds, and the only way to read it is to read the log.
    folded = foldStateOf(log)
  }
  // Read again even when nothing was claimed: the caller's state is a snapshot, and a second call with
  // the same snapshot would otherwise write the attempt a second time. "What to do" is answered by the
  // ledger, so the ledger is what the attempts are derived from — including the claims and attempts
  // that arrived while this pass was deciding.
  folded = folded === state ? foldStateOf(log) : folded
  // Re-derived against that ledger, so an attempt is written only when this end still holds the root.
  // A root another end holds now blocks as `lease-held` and its attempt is never written: the ledger
  // then shows a claim without an attempt, which is the honest record of a race that was lost.
  const decided = redispatchPlan(folded, options)
  for (const entry of decided.entries) {
    // The claim travels with the attempt as its actor: the fold enforces "only the owner retries" by
    // reading a record's own identity, and an attempt that named nobody could not be checked against
    // the claim it was supposed to hold.
    written.push(await log.append({
      ...dispatchRecord(entry.id, entry.to, entry.tool, entry.args, options.now, { retryOf: attemptOf(entry.id).root, attempt: entry.attempt }),
      actor: options.localEnd,
    }))
  }
  return written
}
/**
 * The record kinds this build reads: the kinds whose facts land somewhere in the projection.
 *
 * `unknown` in the counts means "this build could not read this record's kind", which is a statement
 * about the reader. Counting a kind this layer writes itself as unknown said the opposite — adding
 * one lock record turned a clean ledger into an unreadable one — and it is the same confusion that
 * made a whole build look like it understood less than it did.
 */
const READABLE_KINDS: readonly string[] = [TASK_KIND, MEMBER_KIND, CAPABILITY_KIND, HEARTBEAT_KIND, TEAM_KIND, MESSAGE_KIND, PEER_KIND, LOCK_KIND, SESSION_KIND, HANDOFF_KIND, TURN_KIND, HOST_KIND, ADAPTER_KIND, DISPATCH_KIND, RESULT_KIND, RETRY_LEASE_KIND, QUARANTINE_KIND, MANIFEST_KIND, MERGE_KIND]

/**
 * Fold control records into the team state they describe.
 *
 * The fold is total: a record whose kind it does not recognize is counted as unknown and
 * changes nothing, so an older reader facing a newer writer reports what it could not use
 * instead of guessing at it.
 *
 * A task's status is the winning claim, chosen by the records' own clocks (at) when both claims
 * carry one and by arrival order (seq) otherwise; resolvedBy says which rule decided, contested
 * marks a task whose claims disagreed, and losers keeps every superseded claim. The ledger is
 * never rewritten: this projects over records that are all still there.
 *
 * @param records - control records, in sequence order.
 * @returns the projected state.
 */
export function projectTeamState(records: readonly ControlRecord[]): TeamState {
  const state = emptyTeamFold()
  foldTeamRecords(state, records)
  return finishTeamFold(state)
}


/* ------------------------------------------------------------------------------------------------
 * Resumable fold: one accumulator, one step, one materialise (R496).
 *
 * The projection above is a pure function of the records; a READER that already holds the state after
 * records [1, K] must be able to answer the state after [1, K] ++ suffix without folding [1, K] again.
 * That is only true when every projection is an ordered fold with no dependency on a record it has not
 * seen yet. Two of them were not, and were made so: the manifest fold filters against the registry at
 * finish time, and one cross-projection dependency that cannot be made local (a lease whose instant is
 * older than an already-folded retry attempt can change that attempt's verdict) is named by
 * {@link foldResumeSafety} so a caller falls back to a full replay instead of answering differently.
 *
 * The accumulator is the whole fold state: entity maps, per-projection folds and the counters. It is
 * data (Maps, Sets, arrays, plain objects) and is serialised with `v8.serialize` for a checkpoint file
 * or a worker frame; {@link TeamFoldAccumulator.format} guards a future shape change.
 * ---------------------------------------------------------------------------------------------- */

/**
 * The record kinds a checkpoint may drop from the prefix before replaying it.
 *
 * Empty, and deliberately so: every kind this build can read either changes the state or is counted
 * in `counts.unknown`, `through` or `records`, so dropping one would make a resumed fold answer
 * differently from a full one. The field exists because the checkpoint format promises it.
 */
export const FOLD_DROPPED_KINDS: readonly string[] = []

/** One accumulator shape version. A checkpoint or worker frame with another version is not read. */
export const FOLD_ACCUMULATOR_VERSION = 1

/** The projection state of the task, member, team and registry folds plus the counters they feed. */
export interface TeamFoldAccumulator {
  /** The accumulator shape this was built with; guarded when a checkpoint is revived. */
  readonly format: number
  /** The highest sequence folded. */
  through: number
  /** How many records were folded (the accumulator's own record count). */
  recordCount: number
  /** Records that changed a task or a member. */
  folded: number
  /** Records whose KIND this build cannot read. */
  unknown: number
  /** Folded records whose record named no team. */
  unattributed: number
  /** Tasks keyed by {@link boardKey}, in first-mention order. */
  tasks: Map<string, ProjectedTask>
  /** Members keyed by {@link boardKey}, in first-mention order. */
  members: Map<string, ProjectedMember>
  /** Named teams a task or member record attributed something to. */
  namedTeams: Set<string>
  /** Team-message flow counts, the reading {@link readStatus} publishes. */
  messages: { journal: number, inbox: number }
  locks: LocksFoldState
  board: BoardFoldState
  peers: PeersFoldState
  teams: TeamsFoldState
  registry: RegistryFoldState
  taskDemands: TaskDemandsFoldState
  liveness: LivenessFoldState
  quarantine: QuarantineFoldState
  sessions: SessionsFoldState
  hosting: HostingFoldState
  manifests: ManifestsFoldState
  merges: MergesFoldState
  adapters: AdaptersFoldState
  dispatches: DispatchesFoldState
  retryLeases: RetryLeasesFoldState
}

/** The empty accumulator: the state after zero records. */
export function emptyTeamFold(): TeamFoldAccumulator {
  return {
    format: FOLD_ACCUMULATOR_VERSION,
    through: 0,
    recordCount: 0,
    folded: 0,
    unknown: 0,
    unattributed: 0,
    tasks: new Map(),
    members: new Map(),
    namedTeams: new Set(),
    messages: { journal: 0, inbox: 0 },
    locks: emptyLocksFold(),
    board: emptyBoardFold(),
    peers: emptyPeersFold(),
    teams: emptyTeamsFold(),
    registry: emptyRegistryFold(),
    taskDemands: emptyTaskDemandsFold(),
    liveness: emptyLivenessFold(),
    quarantine: emptyQuarantineFold(),
    sessions: emptySessionsFold(),
    hosting: emptyHostingFold(),
    manifests: emptyManifestsFold(),
    merges: emptyMergesFold(),
    adapters: emptyAdaptersFold(),
    dispatches: emptyDispatchesFold(),
    retryLeases: emptyRetryLeasesFold(),
  }
}

/**
 * Step the accumulator over one batch of records.
 *
 * The batch must be the NEXT records in ledger order, i.e. every `seq` in it is greater than
 * {@link TeamFoldAccumulator.through} and the batch itself is in ascending sequence order;
 * {@link foldResumeSafety} is the guard a caller runs first. For an empty accumulator the batch may
 * be the whole ledger in any order (the entity loop keeps the caller's order, exactly as
 * {@link projectTeamState} always has, and every projection sorts by sequence itself).
 */
export function foldTeamRecords(state: TeamFoldAccumulator, records: readonly ControlRecord[]): void {
  if (state.format !== FOLD_ACCUMULATOR_VERSION) throw new TypeError('foldTeamRecords: unknown accumulator format ' + String(state.format))
  // The entity loop first: tasks, members, the counters and the message-flow reading all live in one
  // pass, exactly as projectTeamState has always folded them.
  for (const record of records) {
    state.recordCount += 1
    state.through = Math.max(state.through, record.seq)
    if (record.kind === MESSAGE_KIND) {
      const messageState = (record.payload as { state?: unknown } | null | undefined)?.state
      if (messageState === 'queued' || messageState === 'delivered') state.messages.journal += 1
      else if (messageState === 'accepted') state.messages.inbox += 1
    }
    const change = record.kind === TASK_KIND || record.kind === MEMBER_KIND ? stateOf(record) : null
    if (!READABLE_KINDS.includes(record.kind)) state.unknown += 1
    if (change === null) continue
    state.folded += 1
    if (change.team === null) state.unattributed += 1
    else state.namedTeams.add(change.team)
    if (record.kind === TASK_KIND) {
      const id = boardKey(change.team, change.id)
      const previous = state.tasks.get(id)
      const incoming: ProjectedClaim = { status: change.state, owner: change.owner, at: record.at ?? null, seq: record.seq, writer: record.actor ?? null }
      if (previous === undefined) {
        state.tasks.set(id, { id: change.id, team: change.team, status: incoming.status, owner: incoming.owner, records: 1, at: record.seq, claim: incoming, resolvedBy: 'arrival', contested: false, losers: [] })
      } else {
        const folded = foldClaim({ at: previous.claim.at, seq: previous.claim.seq }, { at: incoming.at, seq: incoming.seq })
        const winner = folded.incomingWins ? incoming : previous.claim
        const loser = folded.incomingWins ? previous.claim : incoming
        const disagrees = loser.status !== winner.status || loser.owner !== winner.owner
        state.tasks.set(id, {
          id: change.id,
          team: change.team,
          status: winner.status,
          owner: winner.owner,
          records: previous.records + 1,
          at: Math.max(previous.at, record.seq),
          claim: winner,
          resolvedBy: folded.byAt ? 'at' : 'arrival',
          contested: previous.contested || disagrees,
          losers: disagrees ? [loser, ...previous.losers] : previous.losers,
        })
      }
    } else {
      const id = boardKey(change.team, change.id)
      const previous = state.members.get(id)
      const incoming: ProjectedMemberClaim = { name: change.name, state: change.state, role: change.role, at: record.at ?? null, seq: record.seq, writer: record.actor ?? null }
      if (previous === undefined) {
        state.members.set(id, { id: change.id, team: change.team, name: incoming.name, state: incoming.state, role: incoming.role, at: record.seq, claim: incoming, resolvedBy: 'arrival', contested: false, losers: [] })
      } else {
        const folded = foldClaim({ at: previous.claim.at, seq: previous.claim.seq }, { at: incoming.at, seq: incoming.seq })
        const winner = folded.incomingWins ? incoming : previous.claim
        const loser = folded.incomingWins ? previous.claim : incoming
        const disagrees = loser.name !== winner.name || loser.state !== winner.state || loser.role !== winner.role
        state.members.set(id, {
          id: change.id,
          team: change.team,
          name: winner.name,
          state: winner.state,
          role: winner.role,
          at: Math.max(previous.at, record.seq),
          claim: winner,
          resolvedBy: folded.byAt ? 'at' : 'arrival',
          contested: previous.contested || disagrees,
          losers: disagrees ? [loser, ...previous.losers] : previous.losers,
        })
      }
    }
  }
  // Then the independent folds. Registry and leases are stepped before the two folds that read them,
  // because those two ask the finished folds for one authority each rather than re-deriving a rule.
  foldLocks(state.locks, records)
  foldPeers(state.peers, records)
  foldTeams(state.teams, records)
  foldRegistry(state.registry, records)
  foldTaskDemands(state.taskDemands, records)
  foldLiveness(state.liveness, records)
  foldQuarantine(state.quarantine, records)
  foldSessions(state.sessions, records)
  foldHosting(state.hosting, records)
  foldAdapters(state.adapters, records)
  foldRetryLeases(state.retryLeases, records)
  foldBoard(state.board, records)
  foldManifests(state.manifests, records)
  foldMerges(state.merges, records)
  foldDispatches(state.dispatches, records, finishRegistry(state.registry), finishRetryLeases(state.retryLeases))
}

/** Materialise the projected state from the accumulator. Pure: the accumulator is not modified. */
export function finishTeamFold(state: TeamFoldAccumulator): TeamState {
  const registry = finishRegistry(state.registry)
  return {
    tasks: [...state.tasks.values()],
    members: [...state.members.values()],
    through: state.through,
    counts: {
      folded: state.folded,
      unknown: state.unknown,
      tasks: state.tasks.size,
      members: state.members.size,
      teams: state.namedTeams.size,
      unattributed: state.unattributed,
    },
    registry,
    liveness: finishLiveness(state.liveness),
    quarantine: finishQuarantine(state.quarantine),
    taskDemands: finishTaskDemands(state.taskDemands),
    teams: finishTeams(state.teams),
    peers: finishPeers(state.peers),
    board: finishBoard(state.board),
    locks: finishLocks(state.locks),
    sessions: finishSessions(state.sessions),
    hosting: finishHosting(state.hosting),
    adapters: finishAdapters(state.adapters),
    dispatches: finishDispatches(state.dispatches),
    retryLeases: finishRetryLeases(state.retryLeases),
    manifests: finishManifests(state.manifests, new Set(Object.keys(registry.byCapability))),
    merges: finishMerges(state.merges),
  }
}

/**
 * Why a batch may NOT be appended to an accumulator with an answer that is identical to a full fold.
 *
 * Returns null when the batch is a safe suffix, or a stable reason string when it is not. The two
 * reasons are the cross-projection dependencies that a left fold cannot make local: both are cases
 * where a fold that already ran read an authority (the registry, the lease table) as it stood then,
 * while a full fold would read it as the whole ledger leaves it.
 *
 * This is the conservative half of R491 section 3.6: a prefix that might read differently is not
 * guessed at. The caller falls back to a full replay and says so; the answer is exact either way.
 * @param state - the accumulator holding records [1, K].
 * @param suffix - the records K+1..end, in ledger order.
 * @returns null when resuming is exact, else the reason it is not.
 */
export function foldResumeSafety(state: TeamFoldAccumulator, suffix: readonly ControlRecord[]): string | null {
  let expected = state.through
  for (const record of suffix) {
    if (record.seq !== expected + 1) return 'nonsequential-suffix'
    expected = record.seq
    if (record.kind === RETRY_LEASE_KIND) {
      const maxRetryAt = state.dispatches.maxRetryAt
      const lease = leaseOf(record)
      if (maxRetryAt !== null && lease !== null && lease.at <= maxRetryAt) return 'lease-rewrites-folded-verdict'
      continue
    }
    if (record.kind === CAPABILITY_KIND && state.dispatches.members.size > 0) {
      const declaration = declarationOf(record)
      if (declaration !== null && state.dispatches.members.has(declaration.id)) return 'capability-rewrites-folded-verdict'
    }
  }
  return null
}

/** One cheap reading of the accumulator: what a status route publishes, without materialising rows. */
export interface FoldReading {
  /** How many records were folded. */
  readonly records: number
  /** The highest sequence folded. */
  readonly through: number
  /** The same counters {@link TeamState.counts} carries. */
  readonly counts: TeamState['counts']
  /** How many named teams the records attributed a fact to. */
  readonly teams: number
  /** The team-message flow reading. */
  readonly messages: { readonly journal: number, readonly inbox: number, readonly source: 'none' | 'journal' | 'inbox' | 'both', readonly scope: 'none' | 'both-directions' | 'this-end-only' }
}

/** Read the accumulator without materialising the projected state. */
export function foldReading(state: TeamFoldAccumulator): FoldReading {
  const journal = state.messages.journal
  const inbox = state.messages.inbox
  const source = journal > 0 && inbox > 0 ? 'both' : inbox > 0 ? 'inbox' : journal > 0 ? 'journal' : 'none'
  const scope = source === 'journal' ? 'both-directions' : source === 'none' ? 'none' : 'this-end-only'
  return {
    records: state.recordCount,
    through: state.through,
    counts: {
      folded: state.folded,
      unknown: state.unknown,
      tasks: state.tasks.size,
      members: state.members.size,
      teams: state.namedTeams.size,
      unattributed: state.unattributed,
    },
    teams: state.namedTeams.size,
    messages: { journal, inbox, source, scope },
  }
}

/** The wire shape of one resumable fold call: a base64 v8 accumulator and the suffix as JSON text. */
export interface FoldFrame {
  /** The accumulator, base64 of `v8.serialize`. */
  readonly accumulator: string
  /** The suffix records, JSON text (the "stringified single frame" the worker path uses). */
  readonly records: string
}

/** Serialise an accumulator to the checkpoint/frame encoding. */
export function encodeFoldAccumulator(state: TeamFoldAccumulator): string {
  return v8Serialize(state).toString('base64')
}

/** Revive an accumulator from {@link encodeFoldAccumulator}; throws on a corrupt or foreign payload. */
export function decodeFoldAccumulator(encoded: string): TeamFoldAccumulator {
  const revived = v8Deserialize(Buffer.from(encoded, 'base64')) as TeamFoldAccumulator
  if (revived === null || typeof revived !== 'object' || revived.format !== FOLD_ACCUMULATOR_VERSION) {
    throw new TypeError('fold accumulator: unknown format ' + String((revived as { format?: unknown } | null)?.format))
  }
  return revived
}

/**
 * Fold one frame: revive the accumulator, check that the suffix may be resumed, fold it, answer both.
 *
 * This is the whole worker protocol. The worker imports the shipped module and calls this with the
 * frame it was sent; nothing else crosses the boundary, so the worker cannot answer differently from
 * the main thread by running a different fold.
 * @param frameJson - JSON text of {@link FoldFrame}.
 * @returns JSON text of `{ accumulator, state, resumed, reason? }`, where `state` is
 * `JSON.stringify` of the materialised state, and `resumed` is false when the suffix was refused.
 */
export function foldResumeFrame(frameJson: string): string {
  const frame = JSON.parse(frameJson) as Partial<FoldFrame> | null
  if (frame === null || typeof frame.accumulator !== 'string' || typeof frame.records !== 'string') {
    throw new TypeError('foldResumeFrame: a frame carries { accumulator: string, records: string }')
  }
  const base = decodeFoldAccumulator(frame.accumulator)
  const records = JSON.parse(frame.records) as ControlRecord[]
  if (!Array.isArray(records)) throw new TypeError('foldResumeFrame: records must be a JSON array')
  const blocked = foldResumeSafety(base, records)
  if (blocked !== null) {
    return JSON.stringify({ accumulator: null, state: null, resumed: false, reason: blocked })
  }
  foldTeamRecords(base, records)
  return JSON.stringify({ accumulator: encodeFoldAccumulator(base), state: JSON.stringify(finishTeamFold(base)), resumed: true })
}

/* ------------------------------------------------------------------------------------------------
 * The live fold: one incremental index per ledger, plus an optional checkpoint (R496).
 *
 * The fold is a pure function of the records, but recomputing it from zero on every read is what R487
 * measured: 170 ms at 100k rows, paid again after every append. Two layers fix that without changing a
 * single answer:
 *
 *   the live index  an accumulator kept per open log, stepped by only the records appended since the
 *                   last fold. Reads answer from it, and the write path asks for the AFTER state from
 *                   the same index, so one append no longer folds the whole ledger twice.
 *   the checkpoint  an optional file beside the ledger holding that accumulator at a prefix boundary.
 *                   A process that opens the ledger next resumes from it and folds only the suffix; a
 *                   missing, corrupt, foreign or non-resumable checkpoint is DISCARDED and the whole
 *                   ledger re-folded, so the log stays the only authority and this file is a cache.
 *
 * Neither layer may change an answer: {@link foldResumeSafety} refuses a suffix that would make the
 * resumed answer differ, and the checkpoint is persisted only from a fold that already answered. A
 * checkpoint that cannot be written is reported and ignored — the write path never depends on it.
 * ---------------------------------------------------------------------------------------------- */

/**
 * The slice of a ledger the checkpoint layer reads.
 *
 * Structurally satisfied by {@link ControlLog} and by a worker's own array-backed ledger, so the
 * checkpoint format has ONE implementation: the file the kernel writes and the file a worker writes
 * are validated and produced by the same code.
 */
export interface FoldLedgerView {
  /** The directory holding control.jsonl and the checkpoint. */
  readonly directory: string
  /** The ledger instance identity its revision names. */
  readonly instance: string
  /** The highest sequence the log holds. */
  readonly lastSeq: number
  /** The sha1 content digest of the ledger's lines, maintained as the log moves (R502). */
  readonly digest: string
  /** What the reader could not parse, or null when it read clean. */
  readonly damage: DamageReport | null
  /**
   * Whether the view already holds the ledger's records (R504).
   *
   * A checkpoint-accelerated open can answer a fold without parsing the prefix; the checkpoint's
   * edge-record proof is then implied by its content digest, and asking this view to page would pay
   * the very parse the open removed. Absent means "materialised" (a worker's own array-backed view).
   */
  readonly recordsMaterialised?: boolean
  /** One page of records after a cursor, in sequence order. */
  page(since?: number, limit?: number): ControlRecord[]
}

/**
 * The additive digest of a control ledger's lines (R502).
 *
 * Two 32-bit accumulators, each summed over one hash per non-empty line. Additive on purpose: the
 * digest of a whole ledger is the sum of the digest of its prefix and its digest of its suffix, so a
 * reader that holds the whole file's digest can VALIDATE A PREFIX by subtracting only the appended
 * suffix — no second read of the prefix, no O(prefix) validation cost, O(1) memory (two integers).
 *
 * The hash is content, not structure: any changed byte of any line moves the line's hash and (with
 * overwhelming probability) the sum, so an in-place rewrite that keeps the inode, the file size and
 * the sequence numbers unchanged is caught (R502 A1: the attack that defeated identity+revision).
 * A crafted multi-line collision is outside the append-only contract and is named in R496's threat
 * model; a cache is a way to notice corruption, not an authentication mechanism.
 */
export interface LedgerDigest {
  /** The first 32-bit accumulator, modulo 2^32. */
  readonly first: number
  /** The second 32-bit accumulator, modulo 2^32. */
  readonly second: number
}

/** The digest of one record line, without its newline. */
export function ledgerLineDigest(line: string): LedgerDigest {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < line.length; index += 1) {
    const code = line.charCodeAt(index)
    first = Math.imul(first ^ code, 16777619) >>> 0
    second = Math.imul(second + code, 2246822519) >>> 0
  }
  return { first, second }
}

/** Add two digests, modulo 2^32. */
export function addLedgerDigests(left: LedgerDigest, right: LedgerDigest): LedgerDigest {
  return { first: (left.first + right.first) >>> 0, second: (left.second + right.second) >>> 0 }
}

/** Subtract one digest from another, modulo 2^32 (the operation a prefix validation needs). */
export function subtractLedgerDigests(left: LedgerDigest, right: LedgerDigest): LedgerDigest {
  return { first: (left.first - right.first) >>> 0, second: (left.second - right.second) >>> 0 }
}

/**
 * The additive digest of a ledger file's text: one hash per non-empty line, summed.
 *
 * Computed while reading the file, on the lines the reader already holds — it never opens the file a
 * second time and keeps no copy of the text.
 * @param text - the control.jsonl content.
 * @returns the additive digest.
 */
export function ledgerTextDigest(text: string): LedgerDigest {
  // One pass over the characters, no per-line array: each line keeps its own two accumulators and is
  // added to the total when its newline is reached. The cost is the bytes, not an allocation per line.
  let first = 0
  let second = 0
  let lineFirst = 0x811c9dc5
  let lineSecond = 0x9e3779b9
  let content = false
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code === 10) {
      if (content) {
        first = (first + lineFirst) >>> 0
        second = (second + lineSecond) >>> 0
      }
      lineFirst = 0x811c9dc5
      lineSecond = 0x9e3779b9
      content = false
      continue
    }
    content = true
    lineFirst = Math.imul(lineFirst ^ code, 16777619) >>> 0
    lineSecond = Math.imul(lineSecond + code, 2246822519) >>> 0
  }
  if (content) {
    first = (first + lineFirst) >>> 0
    second = (second + lineSecond) >>> 0
  }
  return { first, second }
}

/** The additive digest of records, reserialised the way the writer writes them. */
export function ledgerRecordDigest(records: readonly ControlRecord[]): LedgerDigest {
  let digest: LedgerDigest = { first: 0, second: 0 }
  for (const record of records) digest = addLedgerDigests(digest, ledgerLineDigest(JSON.stringify(record)))
  return digest
}

/** The file a fold checkpoint's manifest lives in, inside the ledger directory. */
export const FOLD_CHECKPOINT_FILE = 'fold.checkpoint.json'
/** The materialised-state file a checkpoint writes beside its manifest (R504). */
export const FOLD_CHECKPOINT_STATE_FILE = 'fold.checkpoint.state.json'
/** The accumulator file a checkpoint writes beside its manifest (R504). */
export const FOLD_CHECKPOINT_ACC_FILE = 'fold.checkpoint.acc.bin'
/** The checkpoint document format, so a foreign or older document is refused rather than parsed. */
export const FOLD_CHECKPOINT_FORMAT = 'dsh-link.collab.fold-checkpoint/1'
/** The checkpoint document version: v2 is the manifest + state.json + acc.bin split (R504). */
export const FOLD_CHECKPOINT_VERSION = 2

/** Options for the incremental-fold / checkpoint layer. */
export interface FoldSettings {
  /** Persist and load fold checkpoints beside the ledger. @default false */
  readonly checkpoint: boolean
  /** How often an idle ledger's checkpoint is refreshed, in milliseconds. @default 5000 */
  readonly checkpointIntervalMs: number
  /**
   * Trust the writer's stamp without re-reading the ledger, when its bindings all match.
   *
   * OFF by default: the zero-read tier depends on the OS timestamps a stat returns, so it cannot
   * synchronously prove a prefix nobody rewrote (an attacker able to forge mtime defeats it until
   * the next verification). The default tier reads and hashes the bytes once instead, which keeps
   * R502's A1 guarantee at about a twelfth of the parse cost. See R496 section 8.3. @default false
   */
  readonly fastOpen: boolean
  /**
   * How old a stamp's digest may be before an open re-reads and re-hashes the ledger to prove it.
   *
   * This is the bound on the opt-in fastOpen tier's blind spot: a rewrite that forges the
   * timestamps is caught the first time an open is older than this interval. @default 60000
   */
  readonly stampVerifyMs: number
  /** The clock a checkpoint's created stamp reads. @default Date.now */
  readonly now: () => number
}

const DEFAULT_FOLD_SETTINGS: FoldSettings = { checkpoint: false, checkpointIntervalMs: 5_000, fastOpen: false, stampVerifyMs: 60_000, now: () => Date.now() }
let FOLD_SETTINGS_STATE: FoldSettings = DEFAULT_FOLD_SETTINGS

/**
 * Configure the live-fold / checkpoint layer.
 *
 * Module-level on purpose: this plugin opens ledgers from one fiber, and the fold index is a cache of
 * the filesystem that must answer identically for every caller in the process. Tests configure it
 * directly; the plugin configures it from its own row in {@link apply}.
 * @param settings - the fields to set; absent fields keep today's value.
 * @returns the settings now in force.
 */
export function configureFold(settings: Partial<FoldSettings> = {}): FoldSettings {
  if (settings.checkpoint !== undefined && typeof settings.checkpoint !== 'boolean') throw new TypeError('configureFold: checkpoint must be a boolean')
  if (settings.checkpointIntervalMs !== undefined && (!Number.isInteger(settings.checkpointIntervalMs) || settings.checkpointIntervalMs <= 0)) {
    throw new TypeError('configureFold: checkpointIntervalMs must be a positive integer')
  }
  if (settings.fastOpen !== undefined && typeof settings.fastOpen !== 'boolean') throw new TypeError('configureFold: fastOpen must be a boolean')
  if (settings.stampVerifyMs !== undefined && (!Number.isInteger(settings.stampVerifyMs) || settings.stampVerifyMs <= 0)) {
    throw new TypeError('configureFold: stampVerifyMs must be a positive integer')
  }
  if (settings.now !== undefined && typeof settings.now !== 'function') throw new TypeError('configureFold: now must be a function')
  FOLD_SETTINGS_STATE = { ...FOLD_SETTINGS_STATE, ...settings }
  return FOLD_SETTINGS_STATE
}

/** The settings currently in force. */
export function foldSettings(): FoldSettings {
  return FOLD_SETTINGS_STATE
}

/** What one checkpoint read or write did. */
export interface FoldCheckpointInfo {
  /** The checkpoint manifest file this reading is about. */
  readonly path: string
  /** loaded (verified and resumed), saved, ignored (a cache miss or a refusal) or failed. */
  readonly outcome: 'loaded' | 'saved' | 'ignored' | 'failed'
  /** Why it was ignored or failed, or null when it loaded or saved. */
  readonly reason: string | null
  /** The document version read/written, or null when no document was read. */
  readonly formatVersion: number | null
  /** The ledger identity the document was written for, or null. */
  readonly ledgerIdentity: string | null
  /** The source revision the document was written at, or null. */
  readonly sourceRevision: string | null
  /** The last sequence folded into the saved state, or null. */
  readonly prefixEndSeq: number | null
  /** The record kinds the checkpoint dropped, or null. */
  readonly droppedKinds: readonly string[] | null
  /** The split state file's byte length, or null. */
  readonly stateBytes: number | null
  /** The split accumulator file's byte length, or null. */
  readonly accumulatorBytes: number | null
  /** The manifest's checksum, or null. */
  readonly checksum: string | null
  /** The document's created stamp, or null. */
  readonly createdAt: number | null
}

/**
 * The on-disk manifest of a fold checkpoint (R504).
 *
 * v1 inlined the v8 accumulator as base64 in one document. The cold read paid that whole decode
 * (49.2 ms at 100k rows) before it could answer, while the materialised state it needed was only a
 * JSON.parse away (21.8 ms). v2 splits the files: this manifest carries the identities and digests,
 * fold.checkpoint.state.json carries the materialised TeamState (parsed on a cold read), and
 * fold.checkpoint.acc.bin carries the v8 accumulator (verified here, DECODED lazily on first use).
 */
interface FoldCheckpointDocument {
  readonly format: string
  readonly formatVersion: number
  readonly ledgerIdentity: string
  readonly sourceRevision: string
  readonly prefixEndSeq: number
  readonly droppedKinds: readonly string[]
  /** The sha1 content digest of the folded prefix (the whole ledger at save): the R502 prefix proof. */
  readonly prefixDigest: string
  /** SHA-256 of fold.checkpoint.state.json. */
  readonly state: string
  readonly stateBytes: number
  /** SHA-256 of fold.checkpoint.acc.bin. */
  readonly accumulator: string
  readonly accumulatorBytes: number
  readonly checksum: string
  readonly createdAt: number
}

/** One ledger's live fold index. */
interface LiveFold {
  /** The accumulator, or null while a loaded checkpoint's acc.bin has not been decoded yet. */
  acc: TeamFoldAccumulator | null
  /** The sequence folded into acc/state (the checkpoint's prefixEndSeq after a resume). */
  through: number
  /** The materialised state, or null when the accumulator moved since it was built. */
  state: TeamState | null
  /** The sequence state was materialised at. */
  stateSeq: number
  /** The validated checkpoint whose accumulator file is still undecoded, or null. */
  deferred: FoldCheckpointDocument | null
  /** Why the initial checkpoint read was refused, or null when none was tried or it loaded. */
  checkpointReason: string | null
  /** The prefix the checkpoint file was last written at. */
  savedPrefix: number
  /** The idle-refresh timer, or null when checkpointing is off. */
  timer: ReturnType<typeof setInterval> | null
  /** The last checkpoint failure, kept as a reading rather than thrown. */
  lastError: string | null
}

const LIVE_FOLDS = new WeakMap<ControlLog, LiveFold>()

/** Whether this composition runs the fold in a worker thread (read by the capability's mode reading). */
let foldWorkerEnabled = false
const LIVE_LOGS = new Set<ControlLog>()
/** Process-wide fold readings, for the status face and for a gate that measures the paths taken. */
const FOLD_STATS = {
  fullFolds: 0,
  resumedBatches: 0,
  suffixRecords: 0,
  checkpointsSaved: 0,
  checkpointsLoaded: 0,
  checkpointsIgnored: 0,
  checkpointFallbacks: 0,
  /** Checkpoint refusals caused by a failed integrity proof (checksum, prefix digest, corrupt state). */
  checkpointIntegrityFailures: 0,
  /** The last checkpoint refusal reason, or null. */
  lastCheckpointReason: null as string | null,
  lastError: null as string | null,
  /** Ledger sha1 digests computed. Zero for a default composition: the checkpoint never ran (Y4). */
  digestsComputed: 0,
  /** Stamp files read (a parse of the sidecar, not of the ledger). */
  stampsRead: 0,
  /** Opens answered by the opt-in zero-read tie (fold.fastOpen). */
  stampTrusted: 0,
  /** Opens where the streamed prefix hash proved the stamp and only the suffix was parsed. */
  stampVerified: 0,
  /** Stamp writes that landed. */
  stampsWritten: 0,
  /** Stamp files that could not be believed (or writes that failed). */
  stampsIgnored: 0,
  /** The last stamp reading or write failure, or null after a verified open / successful write. */
  lastStampReason: null as string | null,
  /** The last stamp REFUSAL (kept across the rewrite a refused open performs), or null. */
  lastStampRefusal: null as string | null,
  /** Times a worker-mediated fold/checkpoint fell back to the synchronous index (R507/Y6). */
  workerFallbacks: 0,
  /** The last worker failure that caused a fallback, or null. */
  lastWorkerError: null as string | null,
  /** Times a checkpoint's state file was parsed (a cold read does this once). */
  checkpointStateReads: 0,
  /** Times a checkpoint's accumulator file was v8-decoded (deferred off the cold read, R504). */
  checkpointAccumulatorDecodes: 0,
}

/** The path of one ledger's checkpoint manifest. */
function checkpointFileOf(log: FoldLedgerView): string {
  return join(log.directory, FOLD_CHECKPOINT_FILE)
}

/** The path of one ledger's split state file. */
function checkpointStateFileOf(log: FoldLedgerView): string {
  return join(log.directory, FOLD_CHECKPOINT_STATE_FILE)
}

/** The path of one ledger's split accumulator file. */
function checkpointAccFileOf(log: FoldLedgerView): string {
  return join(log.directory, FOLD_CHECKPOINT_ACC_FILE)
}

/**
 * The ledger's own identity: the CONTROL FILE's device and file id, not its modification time.
 *
 * A modification time is changed by an append, by a copy and by a clock correction, so it cannot say
 * "this is the same file". The file id is what a replaced file loses: a rewritten ledger, or a copy
 * restored under another inode, is a different ledger and its checkpoint must not be believed.
 */
function ledgerIdentityOf(log: FoldLedgerView): string {
  const file = join(log.directory, 'control.jsonl')
  try {
    const stats = statSync(file, { bigint: true })
    return String(stats.dev) + ':' + String(stats.ino) + '@' + resolve(file)
  } catch {
    // A ledger whose file does not exist yet has no identity worth trusting; an empty checkpoint is
    // not useful anyway, and this string never matches a saved one because saving skips it.
    return 'unavailable@' + resolve(file)
  }
}

/** The control file's byte length, or 0 when it cannot be read. */
function ledgerBytesOf(log: FoldLedgerView): number {
  try { return Number(statSync(join(log.directory, 'control.jsonl')).size) } catch { return 0 }
}

/** The source revision: which ledger instance, how far it was, and how many bytes it held. */
function sourceRevisionOf(log: FoldLedgerView): string {
  return log.instance + ':' + String(log.lastSeq) + ':' + String(ledgerBytesOf(log))
}

/** The checksum of one manifest: every field that decides whether it may be believed. */
function checkpointChecksum(document: Omit<FoldCheckpointDocument, 'checksum' | 'createdAt'>): string {
  return createHash('sha256')
    .update(document.format + STAMP_NUL + String(document.formatVersion))
    .update(STAMP_NUL + document.ledgerIdentity)
    .update(STAMP_NUL + document.sourceRevision)
    .update(STAMP_NUL + String(document.prefixEndSeq))
    .update(STAMP_NUL + document.droppedKinds.join(','))
    .update(STAMP_NUL + document.prefixDigest)
    .update(STAMP_NUL + document.state)
    .update(STAMP_NUL + String(document.stateBytes))
    .update(STAMP_NUL + document.accumulator)
    .update(STAMP_NUL + String(document.accumulatorBytes))
    .digest('hex')
}

/** A sha256 hex of a string or buffer (one helper so the three split files hash identically). */
function sha256Of(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Build the "nothing was read" info for one path and reason. */
function ignoredCheckpoint(path: string, reason: string, seen: Partial<FoldCheckpointDocument> | null = null): FoldCheckpointInfo {
  return {
    path,
    outcome: 'ignored',
    reason,
    formatVersion: typeof seen?.formatVersion === 'number' ? seen.formatVersion : null,
    ledgerIdentity: typeof seen?.ledgerIdentity === 'string' ? seen.ledgerIdentity : null,
    sourceRevision: typeof seen?.sourceRevision === 'string' ? seen.sourceRevision : null,
    prefixEndSeq: typeof seen?.prefixEndSeq === 'number' ? seen.prefixEndSeq : null,
    droppedKinds: Array.isArray(seen?.droppedKinds) ? seen.droppedKinds : null,
    stateBytes: typeof seen?.stateBytes === 'number' ? seen.stateBytes : null,
    accumulatorBytes: typeof seen?.accumulatorBytes === 'number' ? seen.accumulatorBytes : null,
    checksum: typeof seen?.checksum === 'string' ? seen.checksum : null,
    createdAt: typeof seen?.createdAt === 'number' ? seen.createdAt : null,
  }
}

/** Build the "loaded" info for a validated manifest. */
function loadedCheckpointInfo(path: string, document: FoldCheckpointDocument): FoldCheckpointInfo {
  return {
    path,
    outcome: 'loaded',
    reason: null,
    formatVersion: document.formatVersion,
    ledgerIdentity: document.ledgerIdentity,
    sourceRevision: document.sourceRevision,
    prefixEndSeq: document.prefixEndSeq,
    droppedKinds: document.droppedKinds,
    stateBytes: document.stateBytes,
    accumulatorBytes: document.accumulatorBytes,
    checksum: document.checksum,
    createdAt: document.createdAt,
  }
}

/** Delete every file of one ledger's checkpoint: a cache that failed a proof must not answer again. */
function discardCheckpoint(directory: string): void {
  for (const name of [FOLD_CHECKPOINT_FILE, FOLD_CHECKPOINT_STATE_FILE, FOLD_CHECKPOINT_ACC_FILE]) {
    try { rmSync(join(directory, name), { force: true }) } catch { /* a cache that cannot be deleted is still refused */ }
  }
}

/** A validated checkpoint: its manifest, and the info a reader reports. */
interface CheckpointValidation {
  readonly document: FoldCheckpointDocument | null
  readonly info: FoldCheckpointInfo
}

/**
 * Read and validate a ledger's checkpoint manifest.
 *
 * Every fact that can make the cache wrong is checked and NAMED, and every refusal is fail-open:
 * the caller re-folds the whole ledger, and the poisoned manifest is deleted. The split state and
 * accumulator files are validated by their own readers, so a manifest that names absent files is
 * still refused by name.
 * @param log - the open ledger.
 * @returns the v2 manifest, or the info saying why it was refused.
 */
function validateCheckpoint(log: FoldLedgerView): CheckpointValidation {
  const path = checkpointFileOf(log)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { document: null, info: ignoredCheckpoint(path, 'no-checkpoint-file') }
  }
  const refuse = (reason: string, seen: Partial<FoldCheckpointDocument> | null = null): CheckpointValidation => {
    FOLD_STATS.checkpointIntegrityFailures += 1
    FOLD_STATS.lastCheckpointReason = reason
    discardCheckpoint(log.directory)
    return { document: null, info: ignoredCheckpoint(path, reason, seen) }
  }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return refuse('unreadable-json') }
  if (parsed === null || typeof parsed !== 'object') return refuse('not-a-document')
  const seen = parsed as Partial<FoldCheckpointDocument>
  if (seen.format !== FOLD_CHECKPOINT_FORMAT) return refuse('foreign-format', seen)
  if (seen.formatVersion !== FOLD_CHECKPOINT_VERSION) return refuse('format-version', seen)
  if (!Array.isArray(seen.droppedKinds) || seen.droppedKinds.join(',') !== FOLD_DROPPED_KINDS.join(',')) return refuse('dropped-kinds-changed', seen)
  if (typeof seen.ledgerIdentity !== 'string' || typeof seen.sourceRevision !== 'string'
    || typeof seen.prefixEndSeq !== 'number' || !Number.isInteger(seen.prefixEndSeq) || seen.prefixEndSeq < 0
    || typeof seen.prefixDigest !== 'string' || typeof seen.state !== 'string' || typeof seen.checksum !== 'string'
    || typeof seen.stateBytes !== 'number' || !Number.isInteger(seen.stateBytes) || seen.stateBytes < 0
    || typeof seen.accumulator !== 'string'
    || typeof seen.accumulatorBytes !== 'number' || !Number.isInteger(seen.accumulatorBytes) || seen.accumulatorBytes < 0) {
    return refuse('malformed-document', seen)
  }
  const document = seen as FoldCheckpointDocument
  if (checkpointChecksum(document) !== document.checksum) return refuse('checksum-mismatch', seen)
  // The revision names the ledger INSTANCE that wrote the checkpoint. A directory whose instance file
  // was lost is a new ledger by this bus's own definition, so its checkpoint is not this ledger's cache.
  if (document.ledgerIdentity !== ledgerIdentityOf(log)) return refuse('ledger-identity-changed', seen)
  const revisionParts = document.sourceRevision.split(':')
  if (revisionParts.length !== 3 || revisionParts[0] !== log.instance) return refuse('ledger-instance-changed', seen)
  const recordedLastSeq = Number(revisionParts[1])
  const recordedBytes = Number(revisionParts[2])
  if (!Number.isInteger(recordedLastSeq) || !Number.isInteger(recordedBytes)) return refuse('malformed-revision', seen)
  if (recordedLastSeq > log.lastSeq || recordedBytes > ledgerBytesOf(log)) return refuse('ledger-shrank', seen)
  if (log.damage !== null) return refuse('damaged-ledger', seen)
  // R491 section 3.6's CONSERVATIVE rule, version 1: any change to the source after the checkpoint makes
  // the checkpoint unverifiable, and an unverifiable cache is discarded rather than guessed at. A clean
  // shutdown writes the checkpoint at the end of the ledger (teardown does), so a clean restart resumes;
  // an unclean one re-folds. The feature that matters is that the answer is always exact.
  if (log.lastSeq !== document.prefixEndSeq) return refuse('ledger-grew', seen)
  // R502: THE PREFIX PROOF. Identity, revision, size and the last sequence were all satisfiable by an
  // in-place rewrite that kept inode, size and sequence numbers; the content digest is the fact such a
  // rewrite cannot preserve. The open's digest is a native hash of the bytes it read (R504: streamed,
  // not parsed), so this proof costs a read and no parse.
  if (log.digest !== document.prefixDigest) return refuse('prefix-checksum-mismatch', seen)
  // The edge record only proves anything when the view actually holds the rows. A lazy view proved the
  // same fact with its content digest above, and asking it to page here would parse the whole ledger -
  // the exact cost the cold read removes (R504).
  if (document.prefixEndSeq > 0 && log.recordsMaterialised !== false) {
    const edge = log.page(document.prefixEndSeq - 1, 1)
    if (edge.length !== 1 || edge[0]?.seq !== document.prefixEndSeq) return refuse('prefix-changed', seen)
  }
  return { document, info: loadedCheckpointInfo(path, document) }
}

/** The result of reading one split file. */
interface CheckpointFileReading<T> {
  readonly value: T | null
  readonly reason: string | null
}

/**
 * Read and verify the split state file: sha256 and byte length from the manifest, then parse it.
 * @param log - the open ledger.
 * @param document - its validated manifest.
 * @param parse - whether to JSON.parse the text (a cold read answers from it, so it does).
 * @returns the parsed state (or null when parse is false), or the refusal reason.
 */
function readCheckpointState(log: FoldLedgerView, document: FoldCheckpointDocument, parse: boolean): CheckpointFileReading<TeamState> {
  const path = checkpointStateFileOf(log)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { value: null, reason: 'missing-state-file' }
  }
  if (Buffer.byteLength(text, 'utf8') !== document.stateBytes) return { value: null, reason: 'state-size-mismatch' }
  if (sha256Of(text) !== document.state) return { value: null, reason: 'state-checksum-mismatch' }
  if (!parse) return { value: null, reason: null }
  FOLD_STATS.checkpointStateReads += 1
  try {
    return { value: JSON.parse(text) as TeamState, reason: null }
  } catch (error) {
    return { value: null, reason: 'corrupt-state: ' + String((error as { message?: unknown })?.message ?? error) }
  }
}

/**
 * Read and verify the split accumulator file, decoding the v8 payload.
 *
 * This is the ~49 ms step at 100k rows the split exists to move off the cold path: a cold read
 * verifies it lazily and only a path that needs the accumulator pays the decode.
 * @param log - the open ledger.
 * @param document - its validated manifest.
 * @returns the revived accumulator, or the refusal reason.
 */
function readCheckpointAccumulator(log: FoldLedgerView, document: FoldCheckpointDocument): CheckpointFileReading<TeamFoldAccumulator> {
  const path = checkpointAccFileOf(log)
  let buffer: Buffer
  try {
    buffer = readFileSync(path)
  } catch {
    return { value: null, reason: 'missing-accumulator-file' }
  }
  if (buffer.length !== document.accumulatorBytes) return { value: null, reason: 'accumulator-size-mismatch' }
  if (sha256Of(buffer) !== document.accumulator) return { value: null, reason: 'accumulator-checksum-mismatch' }
  if (buffer.length === 0) return { value: null, reason: 'corrupt-accumulator: empty file' }
  let accumulator: TeamFoldAccumulator
  FOLD_STATS.checkpointAccumulatorDecodes += 1
  try {
    accumulator = decodeFoldAccumulator(buffer.toString('base64'))
  } catch (error) {
    return { value: null, reason: 'corrupt-accumulator: ' + String((error as { message?: unknown })?.message ?? error) }
  }
  if (accumulator.recordCount !== document.prefixEndSeq || accumulator.through !== document.prefixEndSeq) {
    return { value: null, reason: 'prefix-mismatch' }
  }
  return { value: accumulator, reason: null }
}

/** Refuse a checkpoint after a split-file failure: name it, count it, delete it, fail open. */
function refuseCheckpoint(log: FoldLedgerView, reason: string): FoldCheckpointInfo {
  FOLD_STATS.checkpointIntegrityFailures += 1
  FOLD_STATS.lastCheckpointReason = reason
  discardCheckpoint(log.directory)
  return ignoredCheckpoint(checkpointFileOf(log), reason)
}

/**
 * Try to load one ledger's checkpoint into an accumulator (the eager face).
 *
 * Everything that can make it wrong is checked and NAMED, and every refusal is fail-open: the caller
 * re-folds the whole ledger. Nothing here throws for a bad document.
 * @param log - the open ledger.
 * @returns the revived accumulator and info, or a null accumulator and the refusal.
 */
export function loadFoldCheckpoint(log: FoldLedgerView): { readonly accumulator: TeamFoldAccumulator | null, readonly info: FoldCheckpointInfo } {
  const checked = validateCheckpoint(log)
  if (checked.document === null) return { accumulator: null, info: checked.info }
  const document = checked.document
  const stateFile = readCheckpointState(log, document, false)
  if (stateFile.reason !== null) return { accumulator: null, info: refuseCheckpoint(log, stateFile.reason) }
  const loaded = readCheckpointAccumulator(log, document)
  if (loaded.value === null) return { accumulator: null, info: refuseCheckpoint(log, loaded.reason ?? 'corrupt-accumulator') }
  FOLD_STATS.lastCheckpointReason = null
  return { accumulator: loaded.value, info: loadedCheckpointInfo(checkpointFileOf(log), document) }
}

/** One checkpoint resumed far enough to answer a cold read. */
interface ResumedCheckpoint {
  readonly document: FoldCheckpointDocument
  readonly state: TeamState
}

/**
 * Resume a checkpoint far enough to answer a state read: verify the manifest, verify and parse the
 * state file, and leave the accumulator file to be decoded on first use (R504).
 *
 * The state file is the answer a cold read serves; the accumulator is only needed by a caller that
 * folds more records (the write path) or asks for the accumulator itself. Deferring that decode is
 * what removes the measured 49.2 ms from the cold read at 100k rows.
 * @param log - the open ledger.
 * @returns the resumed state, or the refusal info.
 */
function resumeFoldCheckpoint(log: FoldLedgerView): { readonly resumed: ResumedCheckpoint | null, readonly info: FoldCheckpointInfo } {
  const checked = validateCheckpoint(log)
  if (checked.document === null) return { resumed: null, info: checked.info }
  const document = checked.document
  const loadedState = readCheckpointState(log, document, true)
  if (loadedState.value === null) return { resumed: null, info: refuseCheckpoint(log, loadedState.reason ?? 'corrupt-state') }
  FOLD_STATS.lastCheckpointReason = null
  return { resumed: { document, state: loadedState.value }, info: loadedCheckpointInfo(checkpointFileOf(log), document) }
}

/** The accumulator of one live log, after stepping it to the log's current end. */
function liveFoldOf(log: ControlLog): LiveFold {
  const existing = LIVE_FOLDS.get(log)
  if (existing !== undefined) return existing
  // The accumulator starts EMPTY rather than absent: a first run (no checkpoint, or one refused)
  // folds the ledger incrementally from zero, which is the behaviour every earlier build had.
  const created: LiveFold = { acc: emptyTeamFold(), through: 0, state: null, stateSeq: -1, deferred: null, checkpointReason: null, savedPrefix: -1, timer: null, lastError: null }
  LIVE_FOLDS.set(log, created)
  LIVE_LOGS.add(log)
  if (FOLD_SETTINGS_STATE.checkpoint) {
    const resumed = resumeFoldCheckpoint(log)
    if (resumed.resumed !== null) {
      created.state = resumed.resumed.state
      created.through = resumed.resumed.document.prefixEndSeq
      created.stateSeq = created.through
      created.savedPrefix = created.through
      // The accumulator is ABSENT until a path needs it: this is the lazy decode R504 added.
      created.acc = null
      created.deferred = resumed.resumed.document
      FOLD_STATS.checkpointsLoaded += 1
    } else {
      created.checkpointReason = resumed.info.reason
      if (resumed.info.reason !== 'no-checkpoint-file') FOLD_STATS.checkpointsIgnored += 1
    }
  }
  return created
}

/** Re-fold the whole ledger from scratch into one live index, and say why. */
function fullFold(log: ControlLog, live: LiveFold): TeamFoldAccumulator {
  live.acc = emptyTeamFold()
  foldTeamRecords(live.acc, log.replay())
  live.through = live.acc.through
  live.state = finishTeamFold(live.acc)
  live.stateSeq = live.through
  live.deferred = null
  FOLD_STATS.fullFolds += 1
  return live.acc
}

/**
 * Decode the accumulator a resumed checkpoint deferred, verifying its split file.
 * @param log - the open ledger.
 * @param live - its live index.
 * @returns the accumulator, or null after the checkpoint was refused and the index will re-fold.
 */
function ensureCheckpointAccumulator(log: ControlLog, live: LiveFold): TeamFoldAccumulator | null {
  if (live.acc !== null) return live.acc
  const document = live.deferred
  if (document === null) return null
  live.deferred = null
  const loaded = readCheckpointAccumulator(log, document)
  if (loaded.value === null) {
    live.checkpointReason = loaded.reason
    refuseCheckpoint(log, loaded.reason ?? 'corrupt-accumulator')
    return null
  }
  if (loaded.value.through !== live.through) {
    live.checkpointReason = 'prefix-mismatch'
    refuseCheckpoint(log, 'prefix-mismatch')
    return null
  }
  live.acc = loaded.value
  return live.acc
}

/**
 * Bring one live index to the log's current end: step the appended records, or re-fold when the
 * prefix that is already folded must not be trusted.
 * @param log - the open ledger.
 * @param live - its live index.
 * @returns the accumulator at the log's end.
 */
function refreshFold(log: ControlLog, live: LiveFold): TeamFoldAccumulator {
  const lastSeq = log.lastSeq
  // The resumed state already answers the end of the ledger: no accumulator decode, no fold.
  if (live.state !== null && live.stateSeq === live.through && live.through === lastSeq) {
    if (live.acc !== null) return live.acc
    const revived = ensureCheckpointAccumulator(log, live)
    if (revived !== null) return revived
    // The deferred accumulator could not be decoded: fall through and rebuild from the records.
  }
  // A log that moved BACKWARDS was replaced under this handle; its old prefix is not this ledger's.
  if (lastSeq < live.through) return fullFold(log, live)
  if (live.acc === null) {
    // A decoded-checkpoint failure leaves no acc; start from an empty fold and step the records,
    // which is the same answer as a full re-fold and keeps the live index's own accounting.
    if (live.deferred !== null) ensureCheckpointAccumulator(log, live)
    if (live.acc === null) {
      live.acc = emptyTeamFold()
      live.through = 0
      live.state = null
      live.stateSeq = -1
    }
  }
  const acc = live.acc
  if (acc === null) return fullFold(log, live)
  live.through = acc.through
  if (lastSeq === acc.through) {
    if (live.state === null) {
      live.state = finishTeamFold(acc)
      live.stateSeq = acc.through
    }
    return acc
  }
  const suffix = log.page(acc.through)
  if (suffix.length === 0) {
    // No readable record past the folded prefix. Either an append is in flight (its sequence is
    // reserved but its row is not in the log yet) or nothing moved; answering the state the index
    // already describes is exact for both, and the next read picks the append up.
    if (live.state === null) {
      live.state = finishTeamFold(acc)
      live.stateSeq = acc.through
    }
    return acc
  }
  const blocked = foldResumeSafety(acc, suffix)
  if (blocked !== null) {
    FOLD_STATS.checkpointFallbacks += 1
    return fullFold(log, live)
  }
  foldTeamRecords(acc, suffix)
  live.through = acc.through
  FOLD_STATS.resumedBatches += 1
  FOLD_STATS.suffixRecords += suffix.length
  live.state = null
  return acc
}

/** Step one log's live index and answer its materialised state. */
export function foldStateOf(log: ControlLog): TeamState {
  const live = liveFoldOf(log)
  if (FOLD_SETTINGS_STATE.checkpoint && live.timer === null) startCheckpointTimer(log, live)
  // A resumed checkpoint already holds the answer at the ledger's end: answer it WITHOUT decoding
  // the deferred accumulator (R504: this is what removes the 49.2 ms v8 decode at 100k rows).
  const cached = live.state
  if (cached !== null && live.stateSeq === live.through && live.through === log.lastSeq) return cached
  const acc = refreshFold(log, live)
  const state = live.state
  if (state !== null) return state
  live.state = finishTeamFold(acc)
  live.stateSeq = acc.through
  live.through = acc.through
  return live.state
}

/** Step one log's live index and answer the cheap reading (no rows materialised). */
export function foldReadingOf(log: ControlLog): FoldReading {
  const live = liveFoldOf(log)
  if (FOLD_SETTINGS_STATE.checkpoint && live.timer === null) startCheckpointTimer(log, live)
  return foldReading(refreshFold(log, live))
}

/** The accumulator behind one log's live index, after stepping it to the current end (read-only use). */
export function foldAccumulatorOf(log: ControlLog): TeamFoldAccumulator {
  const live = liveFoldOf(log)
  return refreshFold(log, live)
}

/**
 * Write one ledger's checkpoint from an accumulator the caller already holds.
 *
 * The primitive under both the main-thread wrapper and the worker: one format, one validation path,
 * whether the fold it caches ran on this thread or another one. A cache write only: every failure is
 * caught and reported, and no caller's result depends on it.
 *
 * R504 split the document into three files: the materialised state (a cold read's answer), the v8
 * accumulator (lazily decoded), and this manifest (the identity, the prefix proof and both digests).
 * The manifest is written LAST and renamed over its predecessor, so it is the commit point: a reader
 * that sees the new manifest sees a complete set, and a torn write is a cache miss.
 * @param view - the ledger the checkpoint is about.
 * @param accumulator - the fold state to persist, at its own prefix.
 * @param now - the clock for the created stamp.
 * @returns what the write did, or why it did not.
 */
export function writeFoldCheckpoint(view: FoldLedgerView, accumulator: TeamFoldAccumulator, now: () => number = FOLD_SETTINGS_STATE.now): FoldCheckpointInfo {
  const path = checkpointFileOf(view)
  try {
    if (accumulator.recordCount === 0) return ignoredCheckpoint(path, 'empty-ledger')
    if (view.damage !== null) return ignoredCheckpoint(path, 'damaged-ledger')
    // The prefix digest is only provable when the accumulator reaches the end of the ledger: the proof is
    // the whole-ledger digest minus the suffix, and a suffix this index has not folded is not in the
    // accumulator. A behind index is reported rather than made to claim a prefix it does not cover.
    if (view.lastSeq !== accumulator.through) return ignoredCheckpoint(path, 'stale-index')
    const identity = ledgerIdentityOf(view)
    if (identity.startsWith('unavailable@')) return ignoredCheckpoint(path, 'no-ledger-file')
    // At save the accumulator reaches the end of the ledger (the guard above), so the whole-ledger digest
    // IS the prefix digest: one native hash computed at open, continued by every append (R502 A2).
    const prefixDigest = view.digest
    const stateText = JSON.stringify(finishTeamFold(accumulator))
    const accumulatorBuffer = Buffer.from(encodeFoldAccumulator(accumulator), 'base64')
    const body = {
      format: FOLD_CHECKPOINT_FORMAT,
      formatVersion: FOLD_CHECKPOINT_VERSION,
      ledgerIdentity: identity,
      sourceRevision: sourceRevisionOf(view),
      prefixEndSeq: accumulator.through,
      droppedKinds: FOLD_DROPPED_KINDS,
      prefixDigest,
      state: sha256Of(stateText),
      stateBytes: Buffer.byteLength(stateText, 'utf8'),
      accumulator: sha256Of(accumulatorBuffer),
      accumulatorBytes: accumulatorBuffer.length,
    }
    const checksum = checkpointChecksum(body)
    const statePath = checkpointStateFileOf(view)
    const accPath = checkpointAccFileOf(view)
    const suffix = '.' + String(process.pid) + '.' + String(process.hrtime.bigint()) + '.tmp'
    const stateTemporary = statePath + suffix
    const accTemporary = accPath + suffix
    const manifestTemporary = path + suffix
    try {
      writeFileSync(accTemporary, accumulatorBuffer)
      renameSync(accTemporary, accPath)
      writeFileSync(stateTemporary, stateText, 'utf8')
      renameSync(stateTemporary, statePath)
      const document: FoldCheckpointDocument = { ...body, checksum, createdAt: now() }
      writeFileSync(manifestTemporary, JSON.stringify(document), 'utf8')
      renameSync(manifestTemporary, path)
      FOLD_STATS.checkpointsSaved += 1
      return {
        path,
        outcome: 'saved',
        reason: null,
        formatVersion: document.formatVersion,
        ledgerIdentity: document.ledgerIdentity,
        sourceRevision: document.sourceRevision,
        prefixEndSeq: document.prefixEndSeq,
        droppedKinds: document.droppedKinds,
        stateBytes: document.stateBytes,
        accumulatorBytes: document.accumulatorBytes,
        checksum: document.checksum,
        createdAt: document.createdAt,
      }
    } catch (error) {
      for (const temporary of [stateTemporary, accTemporary, manifestTemporary]) {
        try { rmSync(temporary, { force: true }) } catch { /* a leftover temp is reported through the outcome */ }
      }
      throw error
    }
  } catch (error) {
    const reason = String((error as { message?: unknown })?.message ?? error)
    FOLD_STATS.lastError = reason
    return ignoredCheckpoint(path, 'write-failed: ' + reason)
  }
}

/**
 * Write one ledger's checkpoint from its live index.
 *
 * A cache write, and nothing else: it is attempted only from a fold that already answered, every
 * failure is caught and reported, and no caller's result depends on it. A damaged ledger is not
 * checkpointed at all - its prefix cannot be proven to be the prefix a reader would fold.
 * @param log - the open ledger.
 * @returns what the write did, or why it did not.
 */
export function saveFoldCheckpoint(log: ControlLog): FoldCheckpointInfo {
  const live = liveFoldOf(log)
  let accumulator: TeamFoldAccumulator
  try {
    accumulator = refreshFold(log, live)
  } catch (error) {
    live.lastError = String((error as { message?: unknown })?.message ?? error)
    accumulator = live.acc ?? emptyTeamFold()
  }
  const info = writeFoldCheckpoint(log, accumulator)
  if (info.outcome === 'saved') {
    // The checkpoint and the stamp describe the same tail. Refreshing the stamp here also lets the
    // next cold read believe the digest this save just proved (R504).
    STAMP_WRITERS.get(log)?.()
    live.savedPrefix = accumulator.through
    live.lastError = null
  } else if (info.outcome === 'ignored' && info.reason !== null && info.reason.startsWith('write-failed')) {
    live.lastError = info.reason
  }
  return info
}

/** Arm the idle checkpoint timer for one log. The timer never decides anything; it writes a cache. */
function startCheckpointTimer(log: ControlLog, live: LiveFold): void {
  if (live.timer !== null) return
  const timer = setInterval(() => {
    try {
      if (live.savedPrefix === live.through && log.lastSeq === live.through) return
      if (ACTIVE_FOLD_WORKER !== null) {
        // The worker owns the checkpoint when it is armed: serialising the accumulator on this thread
        // would put the measured 73 ms (100k rows) back on the loop the offload exists to free.
        void checkpointViaWorker(log).then(
          (info) => { if (info.outcome === 'saved' && info.prefixEndSeq !== null) live.savedPrefix = info.prefixEndSeq },
          (error) => { live.lastError = String((error as { message?: unknown })?.message ?? error) },
        )
        return
      }
      saveFoldCheckpoint(log)
    } catch (error) {
      live.lastError = String((error as { message?: unknown })?.message ?? error)
    }
  }, FOLD_SETTINGS_STATE.checkpointIntervalMs)
  ;(timer as { unref?: () => void }).unref?.()
  live.timer = timer
}

/** Stop one log's timer and drop its live index. The next read re-folds (or reloads a checkpoint). */
export function disposeFoldLog(log: ControlLog): void {
  const live = LIVE_FOLDS.get(log)
  if (live !== undefined) {
    if (live.timer !== null) clearInterval(live.timer)
    LIVE_FOLDS.delete(log)
  }
  LIVE_LOGS.delete(log)
}

/** The fold readings a gate or a status row can publish: which paths ran, and how much they folded. */
export interface FoldDiagnostics {
  /** The live ledgers the layer is holding an index for. */
  readonly logs: number
  /** How many times a whole ledger was folded from zero. */
  readonly fullFolds: number
  /** How many appended batches were folded into an existing index. */
  readonly resumedBatches: number
  /** How many records those resumed batches carried. */
  readonly suffixRecords: number
  /** Checkpoints written. */
  readonly checkpointsSaved: number
  /** Checkpoints verified and loaded. */
  readonly checkpointsLoaded: number
  /** Checkpoints refused (corrupt, foreign, stale, or non-resumable). */
  readonly checkpointsIgnored: number
  /** Batches that could not resume and forced a whole-ledger re-fold. */
  readonly checkpointFallbacks: number
  /** Checkpoint refusals caused by a failed integrity proof (checksum, prefix digest, corrupt state). */
  readonly checkpointIntegrityFailures: number
  /** The last checkpoint refusal reason, or null after a load or save. */
  readonly lastCheckpointReason: string | null
  /** The last checkpoint error, when there was one. */
  readonly lastError: string | null
  /** Ledger sha1 digests computed. Zero for a default composition: it never reads a checkpoint (Y4). */
  readonly digestsComputed: number
  /** Stamp files read (the sidecar parse, not the ledger's). */
  readonly stampsRead: number
  /** Opens answered by the opt-in zero-read tier (fold.fastOpen). */
  readonly stampTrusted: number
  /** Opens where the streamed prefix hash proved the stamp and only the suffix was parsed. */
  readonly stampVerified: number
  /** Stamp writes that landed. */
  readonly stampsWritten: number
  /** Stamp files that could not be believed, or writes that failed. */
  readonly stampsIgnored: number
  /** The last stamp reading or write failure, or null after a verified open or a successful write. */
  readonly lastStampReason: string | null
  /** The last stamp refusal, kept across the corrective rewrite a refused open performs. */
  readonly lastStampRefusal: string | null
  /** Times a worker-mediated fold/checkpoint fell back to the synchronous index (R507/Y6). */
  readonly workerFallbacks: number
  /** The last worker failure that caused a fallback, or null. */
  readonly lastWorkerError: string | null
  /** Times a checkpoint's state file was parsed (a cold read does this once). */
  readonly checkpointStateReads: number
  /** Times a checkpoint's accumulator file was v8-decoded (deferred off the cold read, R504). */
  readonly checkpointAccumulatorDecodes: number
}

/** Read the fold diagnostics. */
export function foldDiagnostics(): FoldDiagnostics {
  return { logs: LIVE_LOGS.size, ...FOLD_STATS }
}

/** Reset the fold diagnostics counters (a gate's own reading, not a product behaviour). */
export function resetFoldDiagnostics(): void {
  FOLD_STATS.fullFolds = 0
  FOLD_STATS.resumedBatches = 0
  FOLD_STATS.suffixRecords = 0
  FOLD_STATS.checkpointsSaved = 0
  FOLD_STATS.checkpointsLoaded = 0
  FOLD_STATS.checkpointsIgnored = 0
  FOLD_STATS.checkpointFallbacks = 0
  FOLD_STATS.checkpointIntegrityFailures = 0
  FOLD_STATS.digestsComputed = 0
  FOLD_STATS.stampsRead = 0
  FOLD_STATS.stampTrusted = 0
  FOLD_STATS.stampVerified = 0
  FOLD_STATS.stampsWritten = 0
  FOLD_STATS.stampsIgnored = 0
  FOLD_STATS.lastStampReason = null
  FOLD_STATS.lastStampRefusal = null
  FOLD_STATS.workerFallbacks = 0
  FOLD_STATS.lastWorkerError = null
  FOLD_STATS.checkpointStateReads = 0
  FOLD_STATS.checkpointAccumulatorDecodes = 0
  FOLD_STATS.lastCheckpointReason = null
  FOLD_STATS.lastError = null
}



/* ------------------------------------------------------------------------------------------------
 * Fold queries, and the worker that answers them (R496, R491 section 3.3/3.5).
 *
 * A write handler does not need the whole projected state after its append: it needs one named
 * answer — does the fold now allow this pair, what is the board row, is the owner isolated. Asking
 * for the answer rather than materialising the graph is what lets the fold move to a worker without
 * moving an object graph back: the frame out carries only the appended records as JSON text, the
 * reply carries only the tail sequence, the counters and those named answers. The expanded state
 * never crosses the boundary — R491 section 3.5 measured that moving it is slower than folding here.
 *
 * The worker owns the accumulator and the checkpoint; the main thread keeps its own cheap index for
 * the synchronous readers that exist today (`state()` on the teams route). Both answer from the same
 * fold implementation and the same checkpoint file, so neither can drift from the other.
 * ---------------------------------------------------------------------------------------------- */

/** One named question a write handler needs answered from the fold AFTER its append. */
export type FoldWorkerQuery =
  | { readonly kind: 'mayExchange', readonly from: string, readonly to: string }
  | { readonly kind: 'mayMerge', readonly from: string, readonly to: string }
  | { readonly kind: 'boardRow', readonly key: string }
  | { readonly kind: 'quarantined', readonly member: string }

/** The board answer a `boardRow` query gives. */
export interface FoldBoardAnswer {
  /** The status of the winning claim. */
  readonly status: string
  /** Its owner, or null. */
  readonly owner: string | null
}

/**
 * Answer one named query from an accumulator.
 *
 * The rules are the published functions': `mayExchange` and `mayMerge` are called after the two small
 * folds they read are materialised; no rule is re-derived here, so a query cannot answer differently
 * from the same question asked of the full state.
 * @param state - the accumulator to answer from.
 * @param query - the question.
 * @returns the answer in the query's own shape.
 */
export function answerFoldQuery(state: TeamFoldAccumulator, query: FoldWorkerQuery): unknown {
  switch (query.kind) {
    case 'mayExchange': {
      const peers = finishPeers(state.peers)
      return peers.pairs.find((pair) => pair.from === query.from && pair.to === query.to)?.state === 'granted'
    }
    case 'mayMerge': {
      const peers = finishPeers(state.peers)
      const granted = peers.pairs.find((pair) => pair.from === query.from && pair.to === query.to)?.state === 'granted'
      if (!granted) return false
      const merges = finishMerges(state.merges)
      return merges.pairs.find((pair) => pair.from === query.from && pair.to === query.to)?.state === 'granted'
    }
    case 'boardRow': {
      const board = finishBoard(state.board)
      const row = board.tasks.find((task) => task.key === query.key)
      return row === undefined ? null : { status: row.status, owner: row.owner }
    }
    case 'quarantined': {
      return finishQuarantine(state.quarantine).some((row) => row.memberId === query.member)
    }
    default:
      return null
  }
}

/** One compact reply from the fold worker: the tail sequence, the readings, and the named answers. */
export interface FoldWorkerReply {
  /** False when the worker refused the frame; `error` says why. */
  readonly ok: boolean
  /** The failure, when `ok` is false. */
  readonly error?: string
  /** The highest sequence the worker's accumulator holds after the frame. */
  readonly through: number
  /** How many records the worker's accumulator holds. */
  readonly records: number
  /** The counters of the fold, the same readings a status document carries. */
  readonly counts: TeamState['counts']
  /** Named teams. */
  readonly teams: number
  /** Message flow. */
  readonly messages: { readonly journal: number, readonly inbox: number, readonly source: 'none' | 'journal' | 'inbox' | 'both', readonly scope: 'none' | 'both-directions' | 'this-end-only' }
  /** The prefix the worker's checkpoint file holds (0 when it holds none). */
  readonly checkpointPrefix: number
  /** The answers to the frame's queries, in order. */
  readonly answers: readonly unknown[]
  /** True when the worker could not resume and re-read the whole ledger. */
  readonly reloaded: boolean
  /** Why the worker could not resume, when it could not. */
  readonly reason: string | null
  /** The worker process's RSS, when it reported one. */
  readonly rssBytes?: number
}

/** What the fold worker has been asked to do, and how it went. */
export interface FoldWorkerStatus {
  /** Whether a worker is armed. */
  readonly enabled: boolean
  /** Whether the worker thread is still alive. */
  readonly running: boolean
  /** Frames sent. */
  readonly frames: number
  /** Total bytes of the frames sent (the stringified single-frame transport). */
  readonly frameBytes: number
  /** Frames answered. */
  readonly completed: number
  /** Frames that failed. */
  readonly failed: number
  /** Frames in flight. */
  readonly pending: number
  /** The wall time of the last request, in milliseconds. */
  readonly lastWallMs: number | null
  /** The last failure, or null. */
  readonly lastError: string | null
}

/** The handle the main thread holds for one fold worker. */
export interface FoldWorkerHandle {
  /** What the worker has done so far. */
  readonly status: FoldWorkerStatus
  /** Send one stringified frame and await its compact reply. */
  request(frameJson: string): Promise<FoldWorkerReply>
  /** Stop the worker. Pending requests reject. */
  close(): Promise<void>
}

/** The armed worker, or null. One per plugin process: the fold is one authority, not one per caller. */
let ACTIVE_FOLD_WORKER: FoldWorkerHandle | null = null

/** Arm (or disarm, with null) the worker every write handler's AFTER fold goes through. */
export function activateFoldWorker(handle: FoldWorkerHandle | null): void {
  ACTIVE_FOLD_WORKER = handle
  foldWorkerEnabled = handle !== null
}

/** The armed worker, for a reading that has to say whether the offload is on. */
export function activeFoldWorker(): FoldWorkerHandle | null {
  return ACTIVE_FOLD_WORKER
}

/**
 * Start a fold worker that loads THIS module and folds through it.
 *
 * The module URL is passed in the worker data so the worker runs the shipped fold, not a copy: there
 * is one implementation of every rule, and the frame protocol is {@link foldResumeFrame} plus the
 * worker-source's own compact bookkeeping.
 * @param moduleUrl - the module the worker imports. Defaults to this module's own URL.
 * @returns the handle, or null when a worker could not be started (the synchronous index stays in use).
 */
export function startFoldWorker(moduleUrl?: string): FoldWorkerHandle | null {
  const stats = { frames: 0, frameBytes: 0, completed: 0, failed: 0, lastWallMs: null as number | null, lastError: null as string | null }
  let running = true
  const pending = new Map<number, { resolve: (reply: FoldWorkerReply) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout>, started: number }>()
  let id = 0
  let worker: Worker
  try {
    worker = new Worker(FOLD_WORKER_SOURCE, { eval: true, workerData: { moduleUrl: moduleUrl ?? import.meta.url } })
  } catch (error) {
    console.error('[dsh-link-collab] fold worker could not start: ' + String((error as { message?: unknown })?.message ?? error))
    return null
  }
  const settle = (failed: boolean, describe: (reply: FoldWorkerReply) => string): void => {
    for (const [requestId, entry] of [...pending.entries()]) {
      clearTimeout(entry.timer)
      pending.delete(requestId)
      const message = describe({ ok: false, through: 0, records: 0, counts: { folded: 0, unknown: 0, tasks: 0, members: 0, teams: 0, unattributed: 0 }, teams: 0, messages: { journal: 0, inbox: 0, source: 'none', scope: 'none' }, checkpointPrefix: 0, answers: [], reloaded: false, reason: null })
      entry.reject(new Error(message))
    }
    if (failed) stats.failed += 1
  }
  worker.on('message', (raw: unknown) => {
    let parsed: { id?: unknown, reply?: FoldWorkerReply }
    try { parsed = JSON.parse(String(raw)) as { id?: unknown, reply?: FoldWorkerReply } } catch { return }
    const requestId = typeof parsed.id === 'number' ? parsed.id : -1
    const entry = pending.get(requestId)
    if (entry === undefined) return
    clearTimeout(entry.timer)
    pending.delete(requestId)
    const reply = parsed.reply
    if (reply === undefined || typeof reply !== 'object') {
      stats.failed += 1
      entry.reject(new Error('fold worker: a reply was not a reply'))
      return
    }
    stats.completed += 1
    entry.resolve(reply)
  })
  worker.on('error', (error: Error) => {
    running = false
    stats.lastError = String(error?.message ?? error)
    settle(true, () => 'fold worker error: ' + String(error?.message ?? error))
  })
  worker.on('exit', (code: number) => {
    running = false
    if (pending.size > 0) settle(true, () => 'fold worker exited (code ' + String(code) + ') with requests in flight')
  })
  const handle: FoldWorkerHandle = {
    get status() {
      return {
        enabled: true,
        running,
        frames: stats.frames,
        frameBytes: stats.frameBytes,
        completed: stats.completed,
        failed: stats.failed,
        pending: pending.size,
        lastWallMs: stats.lastWallMs,
        lastError: stats.lastError,
      }
    },
    request(frameJson) {
      return new Promise<FoldWorkerReply>((resolve, reject) => {
        if (!running) { reject(new Error('fold worker is not running')); return }
        id += 1
        const requestId = id
        stats.frames += 1
        stats.frameBytes += Buffer.byteLength(frameJson, 'utf8')
        const started = performance.now()
        const timer = setTimeout(() => {
          pending.delete(requestId)
          stats.failed += 1
          reject(new Error('fold worker: request timed out after 60 s'))
        }, 60_000)
        ;(timer as { unref?: () => void }).unref?.()
        pending.set(requestId, {
          resolve: (reply) => { stats.lastWallMs = Math.round((performance.now() - started) * 1000) / 1000; resolve(reply) },
          reject: (error) => { stats.lastError = String(error.message); reject(error) },
          timer,
          started,
        })
        try {
          worker.postMessage(JSON.stringify({ id: requestId, frame: frameJson }))
        } catch (error) {
          pending.delete(requestId)
          clearTimeout(timer)
          reject(new Error('fold worker: could not post the frame: ' + String((error as { message?: unknown })?.message ?? error)))
        }
      })
    },
    async close() {
      running = false
      settle(false, () => 'fold worker closed with requests in flight')
      await worker.terminate()
    },
  }
  console.log('[dsh-link-collab] fold worker started (module ' + String(moduleUrl ?? import.meta.url) + ')')
  return handle
}

/** One worker session for one ledger directory: how far the worker has folded, as the main thread knows it. */
interface FoldWorkerSession {
  readonly directory: string
  knownSeq: number
  opened: boolean
}
const FOLD_WORKER_SESSIONS = new Map<string, FoldWorkerSession>()

/** The worker session for one log. */
function foldWorkerSessionOf(log: ControlLog): FoldWorkerSession {
  const directory = resolve(log.directory)
  let session = FOLD_WORKER_SESSIONS.get(directory)
  if (session === undefined) {
    session = { directory, knownSeq: 0, opened: false }
    FOLD_WORKER_SESSIONS.set(directory, session)
  }
  return session
}

/**
 * The stringified single frame for one worker call.
 *
 * The first call for a directory sends `open` (the worker reads the ledger and its checkpoint itself,
 * so the whole ledger never crosses the boundary); every later call sends only the records the worker
 * has not folded yet, as JSON text.
 */
function foldWorkerFrame(log: ControlLog, session: FoldWorkerSession, queries: readonly FoldWorkerQuery[], op: 'sync' | 'checkpoint' = 'sync'): string {
  if (!session.opened) {
    session.opened = true
    return JSON.stringify({ op: 'open', dir: session.directory, checkpoint: FOLD_SETTINGS_STATE.checkpoint, queries })
  }
  if (op === 'checkpoint') return JSON.stringify({ op: 'checkpoint', dir: session.directory })
  const records = log.page(session.knownSeq)
  return JSON.stringify({ op: 'sync', dir: session.directory, records: JSON.stringify(records), queries, checkpoint: FOLD_SETTINGS_STATE.checkpoint })
}

/**
 * Answer named queries from the fold AFTER an append.
 *
 * With a worker armed the frame carries only the appended records and the questions; the reply is a
 * handful of scalars. Without one this is the synchronous index, so every caller has exactly one
 * contract and the default path is unchanged.
 * @param log - the ledger that just moved.
 * @param queries - what the caller needs to know.
 * @returns the answers, in query order.
 */
export async function foldAfterQueries(log: ControlLog, queries: readonly FoldWorkerQuery[] = []): Promise<readonly unknown[]> {
  const worker = ACTIVE_FOLD_WORKER
  if (worker === null) {
    const accumulator = refreshFold(log, liveFoldOf(log))
    return queries.map((query) => answerFoldQuery(accumulator, query))
  }
  const session = foldWorkerSessionOf(log)
  try {
    const reply = await worker.request(foldWorkerFrame(log, session, queries))
    if (!reply.ok) throw new Error('fold worker: ' + String(reply.error ?? 'refused the frame'))
    session.knownSeq = reply.through
    return reply.answers
  } catch (error) {
    // R507/Y6: the append already landed, so the write succeeded and the caller's tool call must not
    // fail because the OPTIONAL offload did. Latch to the synchronous incremental index - the same
    // fold implementation, the same answers - and record the fallback by name instead of continuing
    // silently (the native path's rule: count it, name it, keep answering).
    const message = String((error as { message?: unknown })?.message ?? error)
    FOLD_STATS.workerFallbacks += 1
    FOLD_STATS.lastWorkerError = message
    FOLD_STATS.lastError = message
    const accumulator = refreshFold(log, liveFoldOf(log))
    return queries.map((query) => answerFoldQuery(accumulator, query))
  }
}

/** Write one ledger's checkpoint through the worker, when one is armed; the local index otherwise. */
export async function checkpointViaWorker(log: ControlLog): Promise<FoldCheckpointInfo> {
  const worker = ACTIVE_FOLD_WORKER
  if (worker === null) return saveFoldCheckpoint(log)
  const session = foldWorkerSessionOf(log)
  try {
    // Sync first so the checkpoint the worker writes covers everything the ledger holds.
    const synced = await worker.request(foldWorkerFrame(log, session, []))
    if (!synced.ok) throw new Error(String(synced.error ?? 'sync refused'))
    session.knownSeq = synced.through
    const reply = await worker.request(JSON.stringify({ op: 'checkpoint', dir: session.directory }))
    if (!reply.ok) throw new Error(String(reply.error ?? 'checkpoint refused'))
    const answer = reply as FoldWorkerReply & { checkpoint?: FoldCheckpointInfo }
    const info = answer.checkpoint
    if (info !== undefined) return info
    return ignoredCheckpoint(checkpointFileOf(log), 'worker-wrote-no-info')
  } catch (error) {
    // R507/Y6: a checkpoint is a cache write; when the worker cannot write it, the local writer can.
    // Record the fallback and still answer the caller with what the write did.
    const message = String((error as { message?: unknown })?.message ?? error)
    FOLD_STATS.workerFallbacks += 1
    FOLD_STATS.lastWorkerError = message
    FOLD_STATS.lastError = message
    return saveFoldCheckpoint(log)
  }
}

/* ------------------------------------------------------------------------------------------------
 * Recording what the kernel's Team service actually does.
 *
 * The Team service publishes no events of its own, and cordis interception merges configuration
 * rather than wrapping methods. It does, however, append every task and member change to its
 * Lead Session's log — \`team/task\`, \`team/member\`, \`team/message/queued\`, \`team/message/delivered\`
 * (packages/experimental/agent-team/src/journal.ts:9). The Session publishes those appends as
 * \`session/event\`, which is a documented feed
 * (packages/core/session/src/index.ts:74, post-commit and fire-and-forget).
 *
 * That feed is the observation point. It is the kernel's own, it is post-commit, and it needs
 * neither polling the service nor wrapping it — so nothing here freezes a service shape the
 * compatibility layer would have to survive. What this module owns is the mapping: one session
 * event becomes one control record, and the projection above folds those records back into the
 * same state the Team service keeps.
 */

/** The session event types this recorder understands. */
export const TEAM_EVENT_KINDS = ['team/task', 'team/member', 'team/message/queued', 'team/message/delivered', 'agent/inbox/spliced'] as const

/**
 * Translate one session event into the control record it becomes, or null when the event is not
 * a Team event this recorder knows.
 *
 * @param event - the appended session event, as the Session published it.
 * @returns the record to append, without a sequence, or null.
 */
export function teamEventToRecord(event: unknown): { kind: string, actor?: string, subject?: string, payload: unknown } | null {
  const row = event as { type?: unknown, data?: unknown } | undefined
  if (row === undefined || typeof row.type !== 'string') return null
  const data = (row.data ?? {}) as Record<string, unknown>

  if (row.type === 'team/task') {
    const task = data.task as Record<string, unknown> | undefined
    if (task === undefined || typeof task.id !== 'string') return null
    // The Team service's own vocabulary is kept verbatim — \`pending\`/\`in_progress\`/\`completed\`/
    // \`deleted\` and \`ownerName\` — so a reader of this ledger and a reader of the service agree
    // on what a task row says. Translating the words here would create two vocabularies for one
    // fact, and the projection's output is exactly the place a reader would notice that.
    return {
      kind: TASK_KIND,
      ...(typeof data.teamId === 'string' ? { actor: data.teamId } : {}),
      subject: task.id,
      payload: {
        id: task.id,
        state: typeof task.status === 'string' ? task.status : 'pending',
        // The event carries the durable SNAPSHOT (TeamTaskSnapshot.ownerId, types.ts:80); `ownerName`
        // belongs to the runtime VIEW (types.ts:94) and is never present here, so reading it recorded
        // an ownerless row and the ledger answered "nobody is doing this" for work that was
        // in_progress. Measured before this line changed: grep '"owner"' over the live control.jsonl
        // returned 0 hits across 49 rows, and the pane drew every row's owner as null. `ownerId`
        // first, with `ownerName` kept as the fallback for a producer that hands over the view.
        ...(typeof task.ownerId === 'string' ? { owner: task.ownerId } : typeof task.ownerName === 'string' ? { owner: task.ownerName } : {}),
        ...(typeof task.revision === 'number' ? { revision: task.revision } : {}),
        ...(typeof task.subject === 'string' ? { title: task.subject } : {}),
        // `blockedBy` is the kernel's own dependency list on the task snapshot
        // (packages/experimental/agent-team/src/types.ts:81) and the only field in the snapshot the
        // projection's graph reads by name: `projectBoard` resolves `payload.deps` into the edges,
        // the unmet list, the missing/orphan list and the cycle search (:1636-1669). Copied rather
        // than translated, like the rest of the row, and copied even when empty: one snapshot is the
        // whole task, so "this revision blocks on nothing" has to be able to clear a graph an
        // earlier revision declared. A kernel that publishes no `blockedBy` publishes no `deps`, and
        // the fold then leaves the previous declaration alone instead of reading absence as empty.
        ...(Array.isArray(task.blockedBy)
          ? { deps: task.blockedBy.filter((dep): dep is string => typeof dep === 'string' && dep !== '') }
          : {}),
      },
    }
  }

  if (row.type === 'team/member') {
    const member = data.member as Record<string, unknown> | undefined
    if (member === undefined || typeof member.id !== 'string') return null
    return {
      kind: MEMBER_KIND,
      ...(typeof data.teamId === 'string' ? { actor: data.teamId } : {}),
      subject: member.id,
      payload: {
        id: member.id,
        state: typeof member.phase === 'string' ? member.phase : 'active',
        ...(typeof member.name === 'string' ? { name: member.name } : {}),
        ...(typeof member.role === 'string' ? { role: member.role } : {}),
        // R484-P3: a multi-level roster row carries its spawn edge. Without this pass-through the
        // ledger dropped it (measured: 2,163 / 6,476 / 21,574 rows at 10k/30k/100k), so the ledger
        // could only rebuild the tree from subagent/catalog parent edges and never knew depth.
        // Additive and conditional: a single-level (or pre-patch) row writes exactly the old payload.
        ...(typeof member.spawnedBy === 'string' ? { spawnedBy: member.spawnedBy } : {}),
        ...(typeof member.depth === 'number' ? { depth: member.depth } : {}),
      },
    }
  }

  // R217: the 0.2.1-alpha.5 line stopped writing the Team mailbox events. Its journal declares the
  // mutable kinds as member and task only (packages/experimental/agent-team/src/journal.ts:9), and a
  // team message is steered into the TARGET's own inbox (agent-team/src/index.ts:237-245) with
  // source = { kind: 'agent-message', form: 'relay', senderSessionId }. The queued/delivered kinds
  // below stay readable because an upgraded log still holds them - they are history, not a source.
  // What this branch adds is the new line's shape, filtered on that source: every other inbox splice
  // is a user steer or a prompt, and recording those as team messages would fill the ledger with
  // facts that are not the bus's.
  if (row.type === 'agent/inbox/spliced') {
    const inserted = Array.isArray(data.inserted) ? data.inserted as Array<Record<string, unknown>> : []
    const relay = inserted.find((one) => {
      const source = one?.source as Record<string, unknown> | undefined
      return source !== undefined && source.kind === 'agent-message'
    })
    if (relay === undefined) return null
    const source = relay.source as Record<string, unknown>
    const id = typeof relay.id === 'string' ? relay.id : null
    if (id === null) return null
    const senderId = typeof source.senderSessionId === 'string' ? source.senderSessionId : null
    const target = typeof data.target === 'string' ? data.target : null
    return {
      kind: 'team.message',
      ...(senderId === null ? {} : { actor: senderId }),
      ...(target === null ? {} : { subject: target }),
      payload: {
        id,
        // 'accepted' rather than 'delivered': the new contract says acceptance follows the target's own
        // persistence and does not await the model (agent-team/src/types.ts:186), so claiming delivery
        // would be the bus asserting something the kernel explicitly does not promise.
        state: 'accepted',
        scope: 'this-end',
        ...(senderId === null ? {} : { senderId }),
        ...(target === null ? {} : { target }),
      },
    }
  }

  if (row.type === 'team/message/queued' || row.type === 'team/message/delivered') {
    // The two message events carry different shapes, and the kernel's own declaration says so
    // rather than leaving it to be guessed
    // (packages/experimental/agent-team/src/types.ts:236-243): `queued` carries the whole
    // snapshot ({ id, senderId, senderName, targetId, content }), while `delivered` carries
    // only an acknowledgement ({ messageId, targetId }).
    const queued = row.type === 'team/message/queued'
    const snapshot = queued ? (data.message as Record<string, unknown> | undefined) : undefined
    const messageId = queued
      ? (typeof snapshot?.id === 'string' ? snapshot.id : null)
      : (typeof data.messageId === 'string' ? data.messageId : null)
    if (messageId === null) return null
    // Message flow is recorded as control, not data: it is who-told-whom, which an audit needs,
    // and it is small. The message *body* is not copied — that belongs to the session log, and
    // duplicating it here would double the storage for a fact already written down.
    const senderName = queued ? snapshot?.senderName : undefined
    const senderId = queued ? snapshot?.senderId : undefined
    const targetId = queued ? snapshot?.targetId : data.targetId
    return {
      kind: 'team.message',
      ...(typeof senderName === 'string' ? { actor: senderName } : {}),
      ...(typeof targetId === 'string' ? { subject: targetId } : {}),
      payload: {
        id: messageId,
        state: queued ? 'queued' : 'delivered',
        ...(typeof senderId === 'string' ? { senderId } : {}),
        ...(typeof targetId === 'string' ? { targetId } : {}),
      },
    }
  }

  return null
}

/** What a recorder hands back to its caller. */
export interface TeamRecorder {
  /**
   * What the recorder has seen:
   *
   *   seen      session events delivered to this listener at all, whatever their type
   *   recorded  those that were Team events and reached the log
   *   ignored   those that were not Team events of interest
   *   failed    Team events whose append failed
   *
   * `seen` is separate from `recorded` because the two failures this recorder can have look
   * identical from the outside: no records appear either when nothing arrives, or when things
   * arrive that are not team events. One counter cannot tell those apart, and the difference
   * decides whether the problem is the feed or the mapping.
   */
  readonly counts: { readonly seen: number, readonly recorded: number, readonly ignored: number, readonly failed: number }
  /**
   * What the subscription itself found, recorded rather than logged.
   *
   * A listener can be installed correctly, with `global: true` and the right event name, and still
   * never run. These readings separate the two mechanisms that decide it: whether the hook is in
   * the registry the publisher dispatches from, and whether the hook survived its own teardown
   * wiring. Service-object identity is deliberately NOT among them — see `recordTeamEvents`.
   */
  readonly diagnostics: {
    /** The listener was installed (the disposer came back). */
    readonly subscriptionInstalled: boolean
    /** How many hooks the registry holds for session/event, or -1 when it holds none. */
    readonly hooksForSessionEvent: number
    /** Why the hook count could not be read, when the read threw. */
    readonly hooksError: string | null
    /** Whether the root context's events service was reachable for comparison. */
    readonly rootObtained: boolean
    /** Whether the root's events service dispatches from the same hook registry, or null if unknown. */
    readonly sameHooksRegistry: boolean | null
    /** session/event hooks in the registry right now, re-read on every access. */
    readonly liveHooks: number
  }
  /** Stop recording. */
  dispose(): void
}

/** The slice of a cordis context this recorder needs. */
export interface RecorderContext {
  on?: (
    name: string,
    listener: (session: unknown, event: unknown) => void,
    options?: { global?: boolean },
  ) => () => void
  events?: unknown
  root?: { events?: unknown }
  /** Runs the body now and keeps the disposer it returns (vendor/cordis/src/fiber.ts:404-418). */
  effect?: (work: () => () => void) => unknown
}

/**
 * Record the kernel's Team events into a control log.
 *
 * @param ctx - the plugin context; only \`on\` and \`effect\` are used.
 * @param log - the log to append to.
 * @returns the recorder, whose counts let a caller see whether anything is arriving at all.
 */
export function recordTeamEvents(ctx: RecorderContext, log: ControlLog): TeamRecorder {
  const counts = { seen: 0, recorded: 0, ignored: 0, failed: 0 }
  const diagnostics: { subscriptionInstalled: boolean, hooksForSessionEvent: number, hooksError: string | null, rootObtained: boolean, sameHooksRegistry: boolean | null, liveHooks: number } =
    { subscriptionInstalled: false, hooksForSessionEvent: -1, hooksError: null, rootObtained: false, sameHooksRegistry: null, liveHooks: -1 }
  let stopped = false
  // R487: read once per recorder, so a mount-time switch decides this recorder's behavior.
  const trace = traceEnabled()

  // Appends are fire-and-forget on purpose: the feed is documented as post-commit and
  // fire-and-forget, so a listener that awaited would either lose events or make the committed
  // append wait on this log. A failed append is counted rather than thrown, because an observer
  // must not be able to break the writer it observes.
  // `global` because the feed is dispatched with a scope filter: a listener owned by a scope
  // only hears sessions on its own branch of the scope chain (packages/core/scope/src/index.ts:
  // 160-181), and an observer of the whole host is not on every session's branch. Without it the
  // listener is installed and never called, which is what this plugin did until a real kernel
  // showed it — see docs/handoff/R8-scope-dispatch-negative-result.md.
  // There is exactly ONE events service per application: `new EventsService(self)` runs once in the
  // Context constructor (vendor/cordis/src/context.ts:80) and child contexts inherit it
  // prototypally (context.ts:99-107), so no plugin can be reading a different bus. Its `_hooks` map
  // (events.ts:132) is the single registry `dispatch` resolves listeners from (events.ts:165-175).
  // Service identity through the context proxy is NOT evidence of anything: every read of a
  // tracker-declared service returns a fresh traceable proxy (vendor/cordis/src/reflect.ts:141 ->
  // utils.ts:117-125,165-173), so two reads of the same service are never ===. The two rounds that
  // argued a channel split were reading that artifact. The registry behind the proxy CAN be
  // compared, because `_hooks` is a plain own property and comes back unwrapped (utils.ts:183-186).
  const diag = ctx as Record<string, unknown> & { events?: unknown, root?: { events?: unknown } }
  const eventsLike = diag.events as { _hooks?: Record<string, unknown> } | undefined

  const off = ctx.on?.('session/event', (_session, event) => {
    if (stopped) return
    counts.seen += 1
    if (trace) console.log('[dsh-link-collab] DIAG event received: ' + String((event as { type?: unknown })?.type))
    const record = teamEventToRecord(event)
    if (record === null) { counts.ignored += 1; return }
    void log.append(record).then(() => { counts.recorded += 1 }, () => { counts.failed += 1 })
  }, { global: true })

  diagnostics.subscriptionInstalled = typeof off === 'function'
  // The hook list lives behind an undeclared property on the service proxy, and such a read
  // throws rather than returning undefined. A throw is not a count, so it is recorded as a
  // distinct outcome instead of being folded into the -1 that also means "no hooks registered".
  try {
    diagnostics.hooksForSessionEvent = Array.isArray(eventsLike?._hooks?.['session/event'])
      ? (eventsLike?._hooks?.['session/event'] as unknown[]).length
      : -1
  } catch (error) {
    diagnostics.hooksError = String((error as { message?: unknown })?.message ?? error)
  }
  // Same question, asked against a value that can answer it: does the root's events service
  // dispatch from the very registry this listener was pushed into? Both sides are obtained and
  // reported, so a missing one reads as unknown rather than as a difference.
  try {
    const root = diag.root
    diagnostics.rootObtained = root !== undefined && root !== null
    const rootHooks = diagnostics.rootObtained ? (root?.events as { _hooks?: unknown } | undefined)?._hooks : undefined
    diagnostics.sameHooksRegistry = rootHooks === undefined || eventsLike?._hooks === undefined
      ? null
      : rootHooks === eventsLike._hooks
  } catch (error) {
    diagnostics.sameHooksRegistry = null
    console.log('[dsh-link-collab] root comparison failed: ' + String((error as { message?: unknown })?.message ?? error))
  }

  const stop = (): void => {
    stopped = true
    off?.()
  }
  // Read again on every access, not once at load: a hook that was present at boot and gone later
  // (or the reverse) is a lifetime question, and a snapshot cannot tell the two apart.
  Object.defineProperty(diagnostics, 'liveHooks', {
    enumerable: true,
    configurable: true,
    get: () => (Array.isArray(eventsLike?._hooks?.['session/event']) ? (eventsLike._hooks['session/event'] as unknown[]).length : -1),
  })
  // `fiber.effect` RUNS its body immediately and keeps the disposers the body RETURNS
  // (vendor/cordis/src/fiber.ts:404-418, and `register` in events.ts:254-259 does the same).
  // `ctx.effect(stop)` therefore executed the teardown at load: the listener was unregistered a
  // moment after it was installed, and the recorder then counted zero forever while every
  // `global: true` hook looked correctly placed. The body returns the disposer instead.
  ctx.effect?.(() => stop)

  return {
    counts,
    diagnostics,
    dispose: stop,
  }
}

/** The capability this plugin publishes. */
/** What one run of the retry rule did. */
export interface RetryRun {
  /** The sequences appended by this run, empty when nothing was stale. */
  readonly written: readonly number[]
  /** The stale dispatches this run refused to retry, with their reasons. */
  readonly blocked: readonly RedispatchBlocked[]
  /** `ok`, or why the run did nothing: `in-flight`, `disabled` or `failed`. */
  readonly reason: 'ok' | 'in-flight' | 'disabled' | 'failed'
}

export interface LinkCollab {
  /**
   * Retrying work that was never answered.
   *
   * The rule itself is always here; the timer is not, unless the row asked for it. `run` is the same
   * pass the timer performs, exposed so a caller (and a gate) can drive it without waiting for a clock.
   */
  readonly retry: {
    /** Whether a timer is installed for this row. */
    readonly enabled: boolean
    /** Whether an interval is installed right now. Readable without a label or a private field: after
     * R64 the timer is not a second `ctx.effect`, so "is it installed" needed a public answer. */
    readonly timerInstalled: boolean
    /** The interval in milliseconds, or null when no timer is installed. */
    readonly everyMs: number | null
    /** Run the rule once now. Never throws: a failure is counted and reported as `failed`. */
    run(): Promise<RetryRun>
    /**
     * How many passes ran, how many attempts they wrote, how many were skipped and how many failed —
     * and how many times the interval callbacks fired at all.
     *
     * `ticks` is counted first thing in the callback, before any guard, so it answers a different
     * question than `runs`: a timer that fires and is refused is visible as `ticks > runs`, while a
     * timer that never fires again leaves `ticks` standing still. Those two were indistinguishable
     * through `runs` alone (R65's real-boot reading).
     */
    readonly counts: {
      readonly runs: number
      readonly written: number
      readonly skipped: number
      readonly failed: number
      readonly ticks: number
      /** Claims on retrying a root that this end wrote. */
      readonly claimed: number
      /** Claims this end wrote and then lost: after re-reading the ledger, another end holds the root. */
      readonly lost: number
    }
    /** The last failure, or null. */
    readonly lastError: string | null
    /** Why the last pass answered what it did, or null when no pass has run yet. */
    readonly lastReason: 'ok' | 'in-flight' | 'disabled' | 'failed' | null
    /** How many passes in a row have written nothing. 0 right after a pass that made progress. */
    readonly idle: number
    /**
     * The delay the pending pass was scheduled with, or null when nothing is pending.
     *
     * Readable rather than inferred: with a backoff, "when will it look again" is a decision the rule
     * made, and a reader (or a gate) should not have to time the timer to learn it.
     */
    readonly nextDelayMs: number | null
  }
  /**
   * Open a control log.
   * @param options - where to write it, and the limit of the data channel.
   * @returns the open log; the caller closes it when its fiber unloads.
   */
  open(options: LogOptions): ControlLog
  /**
   * The log this plugin opened for itself, which the Team events are recorded into.
   *
   * A plugin that records the team's changes has to own that log rather than wait for a caller
   * to open one, or the recording only happens when somebody remembers. This is the log a reader
   * folds to see the team state; a caller wanting its own ledger can still open another.
   */
  readonly log: ControlLog
  /** What the built-in recorder has seen so far. */
  readonly recorded: { readonly seen: number, readonly recorded: number, readonly ignored: number, readonly failed: number }
  /**
   * The team state this plugin's own ledger folds to, recomputed from the log on every call.
   *
   * A reader needs a board, not a file. Folding here rather than in the caller means the durable
   * records stay the only authority: a restart, a second reader, or the shell all derive the same
   * board from the same log.
   */
  state(): TeamState
  /**
   * The resumable fold behind {@link LinkCollab.state}: the live incremental index, the optional
   * checkpoint file, and the readings that say which path answered.
   *
   * The index is what makes `state()` cost the appended records rather than the whole ledger, and it
   * is what the write path reads its AFTER state from. The checkpoint is a cache beside the ledger;
   * it is never an authority, and every failure to read or write it is reported here and ignored.
   */
  readonly fold: {
    /** Which paths this composition configured. */
    readonly mode: { readonly checkpoint: boolean, readonly worker: boolean, readonly fastOpen: boolean }
    /** How many folds ran, which of them resumed, and what the checkpoints did. */
    readonly status: FoldDiagnostics
    /** Step the index to the log's current end and answer the state (the same value `state()` gives). */
    state(): TeamState
    /** The cheap reading of the index: the counters and the message flow, without materialising rows. */
    reading(): FoldReading
    /** Write the checkpoint now. Never throws: `outcome` and `reason` say what happened. */
    checkpointNow(): FoldCheckpointInfo
    /** Load the checkpoint beside the ledger (diagnostic: the next read does this by itself). */
    loadCheckpoint(): FoldCheckpointInfo
    /** Drop the index; the next read re-folds (or loads the checkpoint). */
    reset(): void
  }
  /**
   * One page of the control ledger, with the state that page folds to.
   *
   * What a surface needs to render the exchange in progress: the rows since a cursor, each with the
   * sequence, kind, actor, subject and instant it was written at, plus the fold of everything up to
   * the page. Pure in the sense every reading here is — no clock is read and none is accepted — so
   * two calls over the same ledger return the same page, and a caller wanting a verdict at an instant
   * passes its own.
   * @param options - where to resume from, and how many rows to take.
   * @returns the page, the fold through it, and what the log's reader could not parse.
   */
  records(options?: ControlPageOptions): ControlPage
  /**
   * The declaring tools this composition registered, and how that went.
   *
   * Readable rather than assumed: a composition whose context cannot inject a tool registry keeps its
   * ledger, its recorder and its folds, and this says why no `team_declare_*` tool is offered instead
   * of leaving a caller to guess. `available` is true only when every declared tool was registered.
   */
  readonly tools: { readonly available: boolean, readonly names: readonly string[], readonly reason: string | null }
  /**
   * Release one in-flight task whose owner went silent, and isolate that owner.
   *
   * The rule (`RECLAIM_SILENT_OWNER`) is always reachable through here — it is the tool that is
   * opt-in, not the capability. A refused reclaim throws {@link ReclaimRefusal} with the rule's own
   * code, and appends nothing: the ledger is byte for byte as it was.
   * @param options - the task, the team when the id is ambiguous, the caller's reason, and the instant.
   * @returns what was written, and the board as the ledger folds after it.
   */
  reclaim(options: { readonly task: string, readonly team?: string | null, readonly reason?: string | null, readonly at?: number }): Promise<ReclaimOutcome>
  /**
   * Our own remote-provider facade (R183, md:376-382).
   *
   * **This is not the kernel's service broker and not an RPC provider.** No kernel provider is
   * injected, no key space of the kernel's is touched, and nothing here reaches the network: the keys
   * are a reading of this ledger (`remote:<end>:<key>`, generated only by {@link brokerKeys}), and the
   * transport a caller uses to act on them is the relay that already exists. `TODO.md:70` draws that
   * line and the R183 ruling (§6.3 #1) made writing it down part of opening this face at all.
   *
   * Both calls are pure: they read the state the caller hands over, take `now` as a parameter, and
   * write nothing. `lastCode` is the only memory here, and it is the last verdict `call` gave.
   */
  readonly broker: {
    /** Every provider this end may call, by key. */
    keys(state: TeamState, now: number, options: CapabilityOptions): readonly BrokerKeyRow[]
    /** Decide one call against the key space. */
    call(state: TeamState, key: string, now: number, options: BrokerCallOptions): BrokerCallResult
    /** The code the last `call` answered with, or null when none has been made. */
    readonly lastCode: BrokerCode | null
  }
  /**
   * Send this log's own records to a peer's relay route.
   * @param options - the receiver, the shared token, and where to resume.
   * @returns the receiver's answer.
   */
  relayTo(options: RelayPushOptions): Promise<RelayPushResult>
  /** Where peers post relay batches, and how they have been answered. */
  readonly relay: RelayService
  /**
   * The reading this package publishes about itself, and whether the page can reach it.
   *
   * The LINK panel's status row reads the same document over {@link STATUS_PATH}; this face is how a
   * host-side caller reads it without an HTTP round trip, and how "the route is not bound" is a named
   * fact rather than a silence (the relay's absence is reported the same way).
   */
  readonly status: {
    /** Whether the read-only route is bound in this composition. */
    readonly bound: boolean
    /** The path it is bound on, spelled once in status-path.ts. */
    readonly path: string
    /** How many GETs the route has answered. */
    readonly served: number
    /** How many it could not answer, with the last reason. */
    readonly refused: number
    readonly lastError: string | null
    /** Build the document now, from the live ledger. Never writes. */
    read(): BusStatus
  }
  /**
   * The compute shadow diagnostics (R505). Empty while the engine is 'ts'; one row per control-log
   * directory once 'native-shadow' is configured. Fixed shape; never carries ledger payload content.
   */
  readonly computeShadow: {
    readonly diagnostics: ReadonlyArray<ComputeShadowDiagnostics>
  }
  /** What the built-in recorder found about its own subscription. */
  readonly diagnostics: {
    readonly subscriptionInstalled: boolean
    readonly hooksForSessionEvent: number
    readonly hooksError: string | null
    readonly rootObtained: boolean
    readonly sameHooksRegistry: boolean | null
    readonly liveHooks: number
  }
}

/** The slice of a cordis context this plugin is applied with. */
export interface CollabContext {
  /** Subscribe to a kernel event; the returned function removes the listener again. */
  on?: (name: string, listener: (session: unknown, event: unknown) => void, options?: { global?: boolean }) => () => void
  /** The events service on this context, read for the recorder's diagnostics. */
  events?: unknown
  /** The root context, read so the recorder can compare hook registries. */
  root?: unknown
  /** Runs the body now and keeps the disposer it returns (vendor/cordis/src/fiber.ts:404-418). */
  effect?: (work: () => () => void) => unknown
  /** Read a kernel service by name. */
  get?: (name: string) => unknown
  /** Publish a service this plugin provides. */
  provide?: (name: string, value: unknown) => void
  /** Run a body against a scope holding the named services. */
  inject?: (names: string[], work: (scoped: { get?: (name: string) => unknown }) => void) => void
  /** A logger, when the composition provides one. */
  logger?: (name: string) => { info?: (message: string) => void }
}

/** How a composition configures this plugin. */
export interface CollabConfig {
  /**
   * The resumable fold (R496).
   *
   * The in-memory index runs always: it is the same answer at the cost of the appended records, and
   * the differential suite pins it to the full fold byte for byte. The checkpoint is a CACHE FILE
   * beside the ledger and is **off unless a composition asks for it** — a program that writes a second
   * file beside a ledger nobody asked to cache is a surprise, not a default.
   */
  readonly fold?: {
    /** Persist and load a checkpoint beside the ledger. @default false */
    readonly checkpoint?: boolean
    /** How often an idle ledger's checkpoint is refreshed, in milliseconds. @default 5000 */
    readonly checkpointIntervalMs?: number
    /** Run the fold in a `worker_threads` worker. @default false */
    readonly worker?: boolean
    /**
     * Trust the writer's stamp without re-reading the ledger when every binding matches (R504).
     *
     * OFF by default: this is the zero-read tier, and it can only be as strong as the OS timestamps
     * it compares. The default tier reads and hashes the bytes once, which keeps R502's A1 guarantee.
     * A stale digest is re-verified after `stampVerifyMs`. See R496 section 8.3. @default false
     */
    readonly fastOpen?: boolean
    /** How old a stamp's digest may be before an open re-hashes the ledger. @default 60000 */
    readonly stampVerifyMs?: number
    /**
     * Compute backend for the read path (R505).
     *
     * 'ts' (default) is the existing fold, byte for byte. 'native-shadow' additionally samples the
     * native byte-batched index and reports differences; it never answers a read. Sampling is
     * throttled and budgeted inside compute-engine.ts and runs off the response path.
     * @default 'ts'
     */
    readonly engine?: 'ts' | 'native-shadow'
  }
  /** Where inside the DSH home this plugin's own control channel lives. */
  readonly logDir?: string
  /** Whether to take the writer lock when the process that held it is gone. */
  readonly reclaimLock?: boolean
  /** The relay: without a token no route is bound, and nothing of this plugin is exposed to peers. */
  readonly relay?: { readonly token?: string, readonly path?: string }
  /**
   * Whether this instance folds the official subagent lifecycle into its ledger.
   *
   * **Absent unless a composition asks for it.** The subscription records facts about agents this composition
   * owns, so a deployment that never asked for it must not grow a listener; the rule is always available, the
   * subscription is the opt-in. \`localTeamId\` names the scope being observed (null at a root).
   */
  readonly subagentFacts?: { readonly localTeamId: string | null }
  /**
   * Reclaiming the work a silent owner is holding (md:208-218).
   *
   * **On unless a composition turns it off.** The rule (`reclaimVerdict`/`reclaimReading`), the
   * isolation fold and `linkCollab.reclaim` are always there; what this switch takes away is
   * {@link RECLAIM_TOOL_NAME} from the model's tool list. It is on by default because md:208-218 is a
   * mechanism of the bus rather than an extra: a deployment that configured nothing still gets the
   * recovery path, and "an owner went silent" must not be answerable only on installations whose
   * author happened to wire a switch. `enabled: false` is how a composition asks for the three
   * declaring tools and nothing else - the shape `retry` and `subagentFacts` have.
   *
   * This reverses an earlier default: until R181 the fourth tool had to be asked for, because
   * `scripts/verify-collab-declare.mjs` asserted the registry held exactly the three declaring
   * tools. That assertion now owns the switch instead of the count (gate 107's reading 1 is
   * `TOOL_NAMES` plus whichever extra names the build carries), so the surface is still a graded
   * fact - it is just no longer a fixed number.
   */
  readonly reclaim?: {
    /** Whether to register {@link RECLAIM_TOOL_NAME}. @default true */
    readonly enabled?: boolean
    /**
     * How long a member may hold a task without beating before its work may be taken.
     * @default {@link RECLAIM_DEFAULT_TTL_MS}
     */
    readonly timeoutMs?: number
  }
  /**
   * Retrying work that was never answered, on a timer.
   *
   * **Off unless a composition asks for it.** A shipped default that appends records to the ledger on
   * a timer would rewrite history on every deployment that never asked for it; the rule (R62) is always
   * available, the clock is the opt-in.
   */
  readonly retry?: {
    /** Whether to run the retry rule on a timer. @default false */
    readonly enabled?: boolean
    /** How often to look, in milliseconds. Required when enabled. */
    readonly everyMs?: number
    /** How long a dispatch may wait before it counts as unanswered. Required when enabled. */
    readonly timeoutMs?: number
    /** How many attempts one unit of work may have, including the first. Required when enabled. */
    readonly maxAttempts?: number
    /** The team whose members are addressed. @default 'team-1' */
    readonly team?: string
    /** This end's own name, used to resolve routes. @default 'end-A' */
    readonly localEnd?: string
    /**
     * Backing off when the passes stop making progress.
     *
     * Absent means today's behaviour, byte for byte: the delay is `everyMs`, always. Present means both
     * fields are present — a half-configured backoff is a delay nobody chose.
     */
    readonly schedule?: {
      /** How fast the delay grows per idle pass. Finite and > 1. */
      readonly factor?: number
      /** The ceiling the delay never passes. A positive integer, and at least `everyMs`. */
      readonly maxMs?: number
    }
    /**
     * A deterministic fraction of the delay to spread out, in [0, 1].
     *
     * Deterministic on purpose: the same idle streak always produces the same delay, so a reading can
     * predict it instead of tolerating a range. @default 0
     */
    readonly jitter?: number
  }
}

/** What one delay calculation reads. */
  export interface RetryDelayOptions {
    /** The base interval, a positive integer. */
    readonly everyMs: number
    /** The backoff factor; absent means no backoff. */
    readonly factor?: number
    /** The ceiling; absent means no ceiling. */
    readonly maxMs?: number
    /** The spread fraction, in [0, 1]. @default 0 */
    readonly jitter?: number
    /** The idle streak: how many passes in a row wrote nothing. */
    readonly idle: number
  }

  /**
   * The delay before the next retry pass.
   *
   * One owner: the timer never computes a delay itself, it asks here. Every branch is a closed form of
   * the idle streak, so a replay of the same streak is the same number — the jitter included.
   * @param options - the base interval, the optional backoff, the jitter, and the idle streak.
   * @returns the delay in milliseconds, a non-negative integer.
   */
  export function retryDelay(options: RetryDelayOptions): number {
    const everyMs = Number(options?.everyMs)
    const idle = Number(options?.idle)
    const jitter = Number(options?.jitter ?? 0)
    if (!Number.isInteger(everyMs) || everyMs <= 0) throw new TypeError('retryDelay: everyMs must be a positive integer')
    if (!Number.isInteger(idle) || idle < 0) throw new TypeError('retryDelay: idle must be a non-negative integer')
    if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) throw new TypeError('retryDelay: jitter must be within [0, 1]')
    const factor = options?.factor
    const maxMs = options?.maxMs
    let raw = everyMs
    if (factor !== undefined) {
      if (!Number.isFinite(factor) || factor <= 1) throw new TypeError('retryDelay: factor must be finite and > 1')
      raw = everyMs * Math.pow(factor, idle)
    }
    const capped = maxMs === undefined ? raw : Math.min(raw, Number(maxMs))
    if (jitter === 0) return Math.round(capped)
    // The fraction is a fixed hash of the streak, computed exactly: `idle * 2654435761` leaves the exact
    // integer range once the streak is large, and a float product would then round to a different
    // fraction than the same formula computed on paper.
    const spread = Number((BigInt(idle) * 2654435761n) % 4294967296n) / 4294967296
    return Math.round(capped * (1 - jitter + jitter * spread))
  }

// ---------------------------------------------------------------- R179: what a model declares

/**
 * The model-facing declaring tools this plugin registers, in the order it registers them.
 *
 * The ledger had no product-level producer before this round: `capability/state`, `team/state` and
 * `member/heartbeat` were appended by gates alone, so a live ledger held none of them and every fold
 * over a real installation answered "nobody declared anything". The recorder covers what the kernel's
 * Team service does; these three cover what a member says about itself, which no kernel event carries.
 */
export const DECLARE_TOOL_NAMES = ['team_declare_capability', 'team_declare_subteam', 'team_heartbeat'] as const

/**
 * The one grammar a name is read by here: a member, a team, a capability.
 *
 * 1-64 characters, starting with a letter or a digit, then letters, digits and `. _ - : @`. Every name
 * this ledger already writes is inside that set (`lead-a`, `end-A`, `team-1`, `probe-tool`), and a
 * session id passes it too, so the grammar refuses a mistake rather than an older row.
 *
 * Whitespace is refused rather than trimmed: `worker a` and `worker a ` are two names no caller means
 * as one, and quietly trimming one into the other is how a member acquires a second row that no
 * reader looks at again.
 */
const DECLARED_NAME = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}$/

/**
 * A declaring tool refused its input, with a code naming which rule was broken.
 *
 * The code is the first thing in the message because that is what reaches the model: the tool registry
 * renders a thrown error as `Error: <message>` (core/deepseek-harness/packages/core/tools/src/index.ts:1909-1917),
 * so `DECLARE_PARENT_SELF: ...` names the rule while a bare "invalid input" names nothing.
 */
export class DeclareRefusal extends Error {
  /** The stable code this refusal is named by. */
  readonly code: string
  /**
   * @param code - the code, e.g. `DECLARE_PARENT_SELF`.
   * @param detail - what was refused, and what the tool takes instead.
   */
  constructor(code: string, detail: string) {
    super(code + ': ' + detail)
    this.name = 'DeclareRefusal'
    this.code = code
  }
}

/** Render a refused or accepted value for a message a model reads. */
function describeValue(value: unknown): string {
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text
  } catch {
    // A value that cannot be serialised is reported by its own conversion, so the refusal path does
    // not fail with a second error about the error.
    return String(value)
  }
}

/** Read the argument object a declaring tool was called with, or refuse it. */
function declarationInput(args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new DeclareRefusal('DECLARE_INPUT', 'this tool takes one object of arguments; got ' + describeValue(args))
  }
  return args as Record<string, unknown>
}

/**
 * Read one required name.
 *
 * The codes are derived from the field, so the pair is symmetric and a reader can predict it:
 * `member` refuses with `DECLARE_MEMBER_EMPTY` or `DECLARE_MEMBER_NAME`.
 * @param value - the field as the model sent it.
 * @param field - the parameter name.
 * @returns the name, as written.
 */
function requiredName(value: unknown, field: string, prefix = 'DECLARE_', refuse: (code: string, detail: string) => Error = (code, detail) => new DeclareRefusal(code, detail)): string {
  const code = prefix + field.toUpperCase()
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    throw refuse(code + '_EMPTY', field + ' is required and must not be empty; got ' + describeValue(value ?? null))
  }
  if (typeof value !== 'string' || !DECLARED_NAME.test(value)) {
    throw refuse(code + '_NAME', field + ' ' + describeValue(value)
      + ' is not a name; use 1-64 characters from letters, digits and . _ - : @, starting with a letter or a digit')
  }
  return value
}

/**
 * Read one optional name: absent or null stays null, anything else must be a name.
 * @param value - the field as the model sent it.
 * @param field - the parameter name, which also names the refusal codes.
 * @returns the name, or null when none was given.
 */
function optionalName(value: unknown, field: string, prefix = 'DECLARE_'): string | null {
  return value === undefined || value === null ? null : requiredName(value, field, prefix)
}

/**
 * Read a capability declaration's list.
 *
 * An empty list is refused rather than folded: a declaration replaces the member's whole set, so an
 * empty one would read as "this member can do nothing", which is a different statement from the one a
 * member makes by never declaring at all — unknown rather than incapable.
 * @param value - the list as the model sent it.
 * @returns the names, as written.
 */
function capabilityNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DeclareRefusal('DECLARE_CAPABILITY_LIST', 'capabilities must be a non-empty array of names; got ' + describeValue(value ?? null))
  }
  const names: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim() === '') {
      throw new DeclareRefusal('DECLARE_CAPABILITY_EMPTY', 'capabilities carries an empty name; every entry must name one capability')
    }
    if (typeof entry !== 'string' || !DECLARED_NAME.test(entry)) {
      throw new DeclareRefusal('DECLARE_CAPABILITY_NAME', 'capabilities carries ' + describeValue(entry)
        + ', which is not a name; use 1-64 characters from letters, digits and . _ - : @')
    }
    names.push(entry)
  }
  return names
}

/**
 * Read the instant a heartbeat is stamped with.
 * @param value - the instant the caller supplied, or the injected clock's reading.
 * @returns the instant, a non-negative integer of milliseconds since the epoch.
 */
function heartbeatInstant(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new DeclareRefusal('DECLARE_HEARTBEAT_AT', 'at must be a non-negative integer of milliseconds since the epoch; got ' + describeValue(value))
  }
  return value
}

/**
 * One model-facing tool, in the fields the kernel's tool registry reads.
 *
 * Declared structurally rather than built by the kernel's `defineTool`, because this plugin's host
 * bundle shares nothing with the kernel but cordis and schemastery: importing the tool package would
 * inline a second copy of the registry's own validation into this file. The fields are the four
 * `defineTool` produces (core/deepseek-harness/packages/core/tools/src/schema.ts:580-602), and the
 * registry accepts a plain definition — the kernel surface probe registers one exactly this way
 * (scripts/probe-kernel-surface.mjs, `collectTools`).
 */
export interface DeclaringTool {
  /** The model-facing tool name. */
  readonly name: string
  /** What the call records, in the model's terms. */
  readonly description: string
  /** JSON Schema for the arguments, in the subset the tool runtime supports. */
  readonly parameters: Record<string, unknown>
  /** The canonical value declaration the registry requires and validates every result against. */
  readonly output: {
    readonly schema: Record<string, unknown>
    /**
     * Project one canonical value into model-facing content.
     * @param args - the arguments the call was made with.
     * @param value - the canonical value the tool returned.
     * @returns the content blocks.
     */
    render(args: unknown, value: unknown): { type: 'text', text: string }[]
  }
  /**
   * Append the declaration this call names, and return the record it wrote.
   * @param args - the model's arguments, as the registry parsed them.
   * @returns the canonical value declared by `output.schema`.
   */
  execute(args: unknown): Promise<Record<string, unknown>>
}

/** What {@link declaringTools} needs. */
export interface DeclaringToolsOptions {
  /** The ledger the declarations are appended to. */
  readonly log: ControlLog
  /**
   * The clock a heartbeat is stamped with when its caller names no instant.
   *
   * Injectable for the reason the log's own clock is (`LogOptions.now`): a reading that depends on wall
   * time cannot be reproduced, and the appending side is where the clock belongs — every decision made
   * from the ledger takes its instant from the caller. @default Date.now
   */
  readonly now?: () => number
}

/**
 * Build the declaring tools.
 * @param options - the ledger, and the clock a heartbeat falls back to.
 * @returns the three tools, in registration order.
 */
export function declaringTools(options: DeclaringToolsOptions): readonly DeclaringTool[] {
  const clock = options.now ?? ((): number => Date.now())
  return [capabilityTool(options.log), subteamTool(options.log), heartbeatTool(options.log, clock)]
}

/** The content one declaring tool's result renders to. JSON, because that is exactly what was written. */
function declaringText(value: unknown): { type: 'text', text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** The tool that declares what one member can do. */
function capabilityTool(log: ControlLog): DeclaringTool {
  return {
    name: DECLARE_TOOL_NAMES[0],
    description: 'Declare what one Team member can offer, as a durable fact in the collaboration ledger. '
      + 'The call replaces everything the ledger holds about that member, so send the complete set every time. '
      + 'Declare before offering work that needs a capability: eligibility is read from these declarations, not from who is on the roster.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        member: { type: 'string', description: 'The member or adapter that declares, named as the rest of the ledger names it.' },
        capabilities: { type: 'array', items: { type: 'string' }, description: 'Every capability this member offers. Names are compared as written.' },
        team: { type: 'string', description: 'The team the member belongs to. Omit when the declaration is not attributed to a team.' },
      },
      required: ['member', 'capabilities'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          seq: { type: 'integer', description: 'The sequence the ledger assigned this record.' },
          kind: { type: 'string', const: CAPABILITY_KIND },
          member: { type: 'string' },
          capabilities: { type: 'array', items: { type: 'string' }, description: 'The set as written: sorted and deduplicated.' },
          team: { type: 'string' },
        },
        required: ['seq', 'kind', 'member', 'capabilities'],
      },
      render: (_args: unknown, value: unknown) => declaringText(value),
    },
    async execute(args: unknown): Promise<Record<string, unknown>> {
      const input = declarationInput(args)
      const member = requiredName(input.member, 'member')
      const capabilities = capabilityNames(input.capabilities)
      const team = optionalName(input.team, 'team')
      // The record comes from the same export the folds already read, so a tool cannot invent a
      // spelling the projection would not recognize. The team rides on `actor`, the field the kernel's
      // own team events carry it in and the field `teamOf` reads first (:1306-1310).
      const record = capabilityRecord(member, capabilities)
      const seq = await log.append({ ...record, ...(team === null ? {} : { actor: team }) })
      return {
        seq,
        kind: record.kind,
        member,
        capabilities: record.payload.capabilities,
        ...(team === null ? {} : { team }),
      }
    },
  }
}

/** The tool that places one team in the tree. */
function subteamTool(log: ControlLog): DeclaringTool {
  return {
    name: DECLARE_TOOL_NAMES[1],
    description: 'Declare where one team sits in the team tree by naming its parent team. '
      + 'Omit parent for a top-level team. The tree is folded from these declarations, so a team that never declares one still reads: it simply has no parent yet.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        team: { type: 'string', description: 'The team being placed, named as the rest of the ledger names it.' },
        parent: { type: 'string', description: 'The team directly above it. Omit, or pass null, for a top-level team. A team cannot be its own parent.' },
        lead: { type: 'string', description: 'The lead of this team, when it has one.' },
      },
      required: ['team'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          seq: { type: 'integer', description: 'The sequence the ledger assigned this record.' },
          kind: { type: 'string', const: TEAM_KIND },
          team: { type: 'string', description: 'The team this declaration is about.' },
          parent: { type: 'string', description: 'Its parent, when the declaration named one.' },
          lead: { type: 'string', description: 'Its lead, when the declaration named one.' },
        },
        required: ['seq', 'kind', 'team'],
      },
      render: (_args: unknown, value: unknown) => declaringText(value),
    },
    async execute(args: unknown): Promise<Record<string, unknown>> {
      const input = declarationInput(args)
      const team = requiredName(input.team, 'team')
      const parent = optionalName(input.parent, 'parent')
      // A team that is its own parent is refused rather than recorded. The fold reports a loop
      // instead of following it, but a self-edge is never a fact anybody meant, and it is the one
      // cycle a writer can see in its own arguments alone. A longer cycle stays the fold's business:
      // catching it here would mean reading the whole ledger on every declaration, and a later
      // declaration is allowed to break it.
      if (parent !== null && parent === team) {
        throw new DeclareRefusal('DECLARE_PARENT_SELF', 'team ' + describeValue(team)
          + ' cannot be its own parent; name the team above it, or omit parent for a top-level team')
      }
      const lead = optionalName(input.lead, 'lead')
      const record = teamRecord(team, parent, lead === null ? undefined : lead)
      const seq = await log.append(record)
      return {
        seq,
        kind: record.kind,
        team,
        ...(parent === null ? {} : { parent }),
        ...(lead === null ? {} : { lead }),
      }
    },
  }
}

/** The tool a member beats with. */
function heartbeatTool(log: ControlLog, clock: () => number): DeclaringTool {
  return {
    name: DECLARE_TOOL_NAMES[2],
    description: 'Say that one Team member is still alive, by appending a heartbeat to the collaboration ledger. '
      + 'Liveness, quarantine and recovery are decided from the latest heartbeat and an instant the reader supplies, so a member that stops beating is reported unhealthy instead of being assumed gone.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        member: { type: 'string', description: 'The member or adapter that is alive.' },
        at: { type: 'integer', description: 'The instant to record, in milliseconds since the epoch. Omit to use this end\'s clock.' },
        team: { type: 'string', description: 'The team the member belongs to. Omit when the heartbeat is not attributed to a team.' },
      },
      required: ['member'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          seq: { type: 'integer', description: 'The sequence the ledger assigned this record.' },
          kind: { type: 'string', const: HEARTBEAT_KIND },
          member: { type: 'string' },
          at: { type: 'integer', description: 'The instant written to the record and to its payload.' },
          team: { type: 'string' },
        },
        required: ['seq', 'kind', 'member', 'at'],
      },
      render: (_args: unknown, value: unknown) => declaringText(value),
    },
    async execute(args: unknown): Promise<Record<string, unknown>> {
      const input = declarationInput(args)
      const member = requiredName(input.member, 'member')
      const team = optionalName(input.team, 'team')
      // The instant is data, not a reading taken inside a fold: it is either the caller's or this end's
      // clock, and the same value is written to the payload the folds read and to the record's own `at`,
      // so no reader can find a heartbeat that happened at two different times.
      const at = input.at === undefined || input.at === null ? heartbeatInstant(clock()) : heartbeatInstant(input.at)
      const record = heartbeatRecord(member, at)
      const seq = await log.append({ ...record, ...(team === null ? {} : { actor: team }), at })
      return {
        seq,
        kind: record.kind,
        member,
        at,
        ...(team === null ? {} : { team }),
      }
    },
  }
}

// ---------------------------------------------------------------- R181: reclaiming, and the tool that does it

/**
 * A reclaim refused, with a code naming which rule was broken.
 *
 * The same shape as {@link DeclareRefusal}, and for the same reason: the tool registry renders a
 * thrown error as `Error: <message>`, so the code has to be the first thing in the message or the
 * model reads "something went wrong" instead of a rule. The codes this class carries are the
 * {@link ReclaimCode} values plus the argument-level ones — `RECLAIM_TASK_EMPTY`,
 * `RECLAIM_TASK_EMPTY`, `RECLAIM_TASK_NAME`, `RECLAIM_TEAM_NAME`, `AMBIGUOUS_TASK`,
 * `UNKNOWN_TASK`, `TIMEOUT`, `AT`, `RECLAIM_REASON_EMPTY`, `RECLAIM_REASON_LONG`.
 */
export class ReclaimRefusal extends Error {
  /** The stable code this refusal is named by. */
  readonly code: string
  /**
   * @param code - the code, e.g. `OWNER_ALIVE`.
   * @param detail - what was refused, and what the caller should do instead.
   */
  constructor(code: string, detail: string) {
    super(code + ': ' + detail)
    this.name = 'ReclaimRefusal'
    this.code = code
  }
}

/**
 * The model-facing tool that releases the work of a silent owner.
 *
 * The name says what it is for rather than what it does internally: `reclaim` is the word md:214
 * uses for this step, and the sibling declaring tools already carry the `team_` prefix.
 */
export const RECLAIM_TOOL_NAME = 'team_reclaim_task'

/** What {@link reclaimTask} needs. */
export interface ReclaimWriteOptions {
  /** The task id, as the board names it. */
  readonly task: string
  /** The team the task belongs to. Omit to resolve the id across the whole board. */
  readonly team?: string | null
  /** How long a member may go without a beat before its work may be taken. */
  readonly timeoutMs: number
  /** The instant to decide and stamp at. Read from a clock only by the caller. */
  readonly now: number
  /** Why the caller is reclaiming, carried into the ledger row. Free text; omitted when absent. */
  readonly reason?: string | null
  /** Who is reclaiming, carried into the ledger row. @default the log's own writer name */
  readonly by?: string | null
}

/**
 * One reclaim, as the ledger was left by it.
 *
 * The two records are reported rather than described, so a caller can compare what it was told with
 * what the log holds, and `after` is folded back from the log rather than assumed: a write that was
 * then overruled by a later claim would otherwise be reported as a success nobody can see.
 */
export interface ReclaimOutcome {
  /** What the rule said, at the instant the write used. */
  readonly reading: ReclaimReading
  /** The sequence the `task/state` record was given. */
  readonly seq: number
  /** That record, as appended. */
  readonly task: { readonly kind: string, readonly subject: string, readonly payload: Record<string, unknown> }
  /**
   * The isolation fact written about the reclaimed owner, or null when the row named no owner.
   *
   * `isolated` is the fold's own answer — whether the isolation table holds this member now — so a
   * caller can tell "a record was appended" from "the ledger reads it as isolated".
   */
  readonly isolation: { readonly seq: number, readonly kind: string, readonly subject: string, readonly payload: Record<string, unknown>, readonly isolated: boolean } | null
  /** The board row after the write, folded back from the ledger. */
  readonly after: { readonly status: string, readonly owner: string | null }
}

/**
 * Build the `task/state` record that releases one task.
 *
 * **One row, four facts.** A release writes one record, and that record is the whole act:
 *
 * - `state: 'pending'` — the task goes back onto the board, md:214;
 * - the owner is **not written at all**, which is how this vocabulary clears it: the fold reads
 *   `payload.owner` and an absent one is `null`, so "the owner was cleared" is the same spelling as
 *   "nobody owns this" and there is no third state to interpret (`projectBoard`, `src/index.ts:1581`);
 * - `revision` continues the count the task already carried, so a reader can see the release is a
 *   later revision rather than a rewrite of an old row. When the ledger never carried one, none is
 *   invented;
 * - `reclaimed` says who was cleared, which rule took it, when, by whom and why — the isolation of
 *   that member **and** the release are one act taken at one instant, so they are one record.
 *   `projectQuarantine` folds the isolation out of this block (`quarantineFact`), which is what
 *   makes the isolated member appear in the isolation table rather than only in this row.
 *
 * Two records were considered and rejected: the isolation is not a second act. A second row would
 * also be a second thing a reader has to decide how to join, and this ledger's readers have been
 * bitten by exactly that (two rows, two owners of one fact).
 * @param taskId - the task being released.
 * @param owner - the owner being cleared, or null when no owner was recorded.
 * @param code - the rule's named answer.
 * @param carry - the revision and title the task's own last row held, and the caller's reason.
 * @returns the record to append, without a sequence.
 */
export function reclaimTaskRecord(taskId: string, owner: string | null, code: ReclaimCode, carry: { revision?: number | null, title?: string | null, reason?: string | null, by?: string | null, at?: number | null } = {}): { kind: string, subject: string, payload: Record<string, unknown> } {
  if (typeof taskId !== 'string' || taskId === '') throw new TypeError('reclaimTaskRecord: taskId must be a non-empty string')
  const revision = carry.revision ?? null
  const title = carry.title ?? null
  return {
    kind: TASK_KIND,
    subject: taskId,
    payload: {
      id: taskId,
      state: 'pending',
      ...(revision === null ? {} : { revision }),
      ...(title === null ? {} : { title }),
      reclaimed: {
        from: owner,
        rule: RECLAIM_RULE,
        code,
        ...(carry.at === undefined || carry.at === null ? {} : { at: carry.at }),
        ...(carry.reason === undefined || carry.reason === null ? {} : { reason: carry.reason }),
        ...(carry.by === undefined || carry.by === null ? {} : { by: carry.by }),
      },
    },
  }
}

/**
 * Resolve the board key one call means.
 *
 * A board key is (team, id), and a caller that names no team is not asking about the unnamed bucket —
 * it is asking about the task. When the id is on the board once, that row is the answer; when teams
 * share an id, guessing would release one team's work on another team's evidence, so the call is
 * refused and asked to name the team. Two teams choosing the same task id is the normal case here,
 * not an exotic one: it is why the board is keyed by the pair.
 * @param state - a folded state.
 * @param task - the task id the caller named.
 * @param team - the team the caller named, or null.
 * @returns the board key, or throws the named refusal.
 */
function reclaimTarget(state: TeamState, task: string, team: string | null): string {
  if (team !== null) {
    const key = boardKey(team, task)
    if (!state.board.tasks.some((row) => row.key === key)) {
      throw new ReclaimRefusal('UNKNOWN_TASK', 'no task ' + describeValue(task) + ' is on the board under team ' + describeValue(team))
    }
    return key
  }
  const rows = state.board.tasks.filter((row) => row.id === task)
  if (rows.length === 0) throw new ReclaimRefusal('UNKNOWN_TASK', 'no task ' + describeValue(task) + ' is on the board')
  if (rows.length > 1) {
    throw new ReclaimRefusal('AMBIGUOUS_TASK', 'task ' + describeValue(task) + ' is on the board in ' + String(rows.length)
      + ' teams (' + rows.map((row) => describeValue(row.team ?? '(none)')).join(', ') + '); name the team this call is about')
  }
  return rows[0].key
}

/**
 * The revision and title the task's own last row carried.
 *
 * Read from the records rather than from the fold because the fold keeps neither: a task's revision
 * is the writer's count of how many times the row changed, and a release has to continue it rather
 * than restart it. This is the only place a reclaim looks at the raw ledger, and it is read-only.
 * @param records - every record read from the log.
 * @param team - the team the task belongs to.
 * @param id - the task id.
 * @returns the last revision and title, either null when the ledger never carried one.
 */
function lastTaskRow(records: readonly ControlRecord[], team: string | null, id: string): { revision: number | null, title: string | null } {
  let revision: number | null = null
  let title: string | null = null
  for (const record of orderedRecords(records)) {
    if (record.kind !== TASK_KIND) continue
    const payload = record.payload as { id?: unknown, revision?: unknown, title?: unknown } | undefined
    const rowId = typeof payload?.id === 'string' && payload.id !== '' ? payload.id : record.subject
    if (rowId !== id || teamOf(record) !== team) continue
    if (typeof payload?.revision === 'number' && Number.isInteger(payload.revision)) revision = payload.revision
    if (typeof payload?.title === 'string' && payload.title !== '') title = payload.title
  }
  return { revision, title }
}

/**
 * Release the work of a silent owner, and isolate that owner.
 *
 * The decision is {@link reclaimReading}'s and is taken **before** anything is appended: a refusal
 * therefore leaves the ledger byte for byte as it was, which is the control this round is measured
 * against. A successful call appends **exactly one** `task/state` record — see
 * {@link reclaimTaskRecord} for why the release and the isolation are one row.
 *
 * Nothing here calls the kernel's Team service. md:214's "the task is released back onto the board"
 * is a fact about **this** board, which is the ledger: the kernel's own board is the Lead's, and only
 * a Lead may reassign there (`task-board.ts:172-187`). Handing the task out again is the next step
 * and is not this function's business — the existing dispatch/redispatch rule (R62) and the Lead's
 * own claim both work from `pending`.
 *
 * The same function is what the model-facing tool and `linkCollab.reclaim` both call: one
 * implementation, so the two doors cannot refuse differently or write different records.
 * @param log - the ledger to append to.
 * @param options - the task, the threshold, the instant, and the caller's own words.
 * @returns what was written, and the board as the ledger folds after it.
 */
export function reclaimTask(log: ControlLog, options: ReclaimWriteOptions): Promise<ReclaimOutcome> {
  const task = requiredName(options?.task, 'task', 'RECLAIM_')
  const team = optionalName(options?.team, 'team', 'RECLAIM_')
  const timeoutMs = options?.timeoutMs
  if (!Number.isInteger(timeoutMs) || (timeoutMs as number) <= 0) {
    throw new ReclaimRefusal('TIMEOUT', 'timeoutMs must be a positive integer of milliseconds; got ' + describeValue(timeoutMs))
  }
  const now = options?.now
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new ReclaimRefusal('AT', 'now must be a finite instant in milliseconds; got ' + describeValue(now))
  }
  const reason = options?.reason ?? null
  const by = options?.by ?? log.writer
  const records = log.replay()
  const before = foldStateOf(log)
  const key = reclaimTarget(before, task, team)
  const reading = reclaimReading(before, key, now, { timeoutMs: timeoutMs as number })
  // Refused before the first append, so the control is a property of the code path rather than of a
  // rollback: a caller that is not entitled to release this task cannot have written anything.
  if (!reading.reclaimable) throw new ReclaimRefusal(reading.code, reading.reason)
  // A release stamped before the claim it releases would lose that claim silently: the board crowns
  // claims by (at, seq) — \`foldClaim\` — so an older \`at\` leaves both rows in the ledger and the task
  // still reading \`in_progress\` with its old owner. Measured while writing this round's readings: the
  // call returned seq 9 and the fold still said \`in_progress\`/\`r181a-holder\`. A caller that names an
  // instant is making a claim about the clock, so an instant that cannot win is refused by name rather
  // than performed invisibly. Equality is fine: the tie goes to the later sequence, which is this row.
  const winner = before.tasks.find((task) => boardKey(task.team, task.id) === key) ?? null
  const claimAt = winner === null ? null : winner.claim.at
  if (claimAt !== null && now < claimAt) {
    throw new ReclaimRefusal('STALE_AT', 'the instant ' + String(now) + ' is older than the claim this reclaim releases (' + String(claimAt)
      + '), so the board would keep the older claim and the release would be invisible; pass an instant at or after it')
  }
  const previous = lastTaskRow(records, reading.team, reading.taskId)
  const written = reclaimTaskRecord(reading.taskId, reading.owner, reading.code, {
    revision: previous.revision === null ? null : previous.revision + 1,
    title: previous.title,
    reason,
    by,
    at: now,
  })
  // Everything above runs before the first `await`, so a refusal is thrown **synchronously**: a caller
  // (or a probe) that catches around the call catches the refusal itself, and no asynchronous work has
  // started when the control arm proves the ledger did not move.
  return (async (): Promise<ReclaimOutcome> => {
    const seq = await log.append({
      ...written,
      ...(reading.team === null ? {} : { actor: reading.team }),
      at: now,
    })
    // The isolation of the member whose work was taken back. One reclaim writes it, and there is
    // nothing to write when the row named no owner: nobody is holding the work, so nobody is being
    // kept out of more of it.
    let isolation: ReclaimOutcome['isolation'] = null
    if (reading.owner !== null) {
      const record = quarantineRecord(reading.owner, now, { reason: reading.code, task: reading.taskId, by })
      const isolationSeq = await log.append({
        ...record,
        ...(reading.team === null ? {} : { actor: reading.team }),
        at: now,
      })
      isolation = { seq: isolationSeq, ...record }
    }
    // The AFTER reading is two named answers, not the whole projected state: the fold may run in a
    // worker, and R491 section 3.5 measured that moving the expanded graph back is slower than folding.
    const answers = await foldAfterQueries(log, [
      { kind: 'boardRow', key: reading.key },
      ...(reading.owner === null ? [] : [{ kind: 'quarantined' as const, member: reading.owner }]),
    ])
    const row = answers[0] as FoldBoardAnswer | null
    return {
      reading,
      seq,
      task: written,
      // Reported and read back: the fold is what makes an isolation a fact rather than a note, so the
      // outcome says both what was appended and whether the isolation table holds it now.
      isolation: isolation === null ? null : {
        ...isolation,
        isolated: reading.owner !== null && answers[1] === true,
      },
      after: { status: row?.status ?? 'unknown', owner: row?.owner ?? null },
    }
  })()
}

/** What {@link reclaimTools} needs. */
export interface ReclaimToolOptions {
  /** The ledger the reclaims are appended to. */
  readonly log: ControlLog
  /**
   * The clock a reclaim is stamped with when its caller names no instant.
   *
   * Injectable for the reason the heartbeat's clock is: the decision and the record must carry one
   * instant, and a gate that supplies its own can measure the threshold without waiting for it.
   * @default Date.now
   */
  readonly now?: () => number
  /** The threshold the tool passes to the rule. @default {@link RECLAIM_DEFAULT_TTL_MS} */
  readonly timeoutMs?: number
}

/** Read the caller's own words for a reclaim: free text, bounded, or absent. */
function reclaimReason(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ReclaimRefusal('RECLAIM_REASON_EMPTY', 'reason must be a non-empty string when it is given; got ' + describeValue(value))
  }
  if (value.length > 200) {
    throw new ReclaimRefusal('RECLAIM_REASON_LONG', 'reason must be at most 200 characters; got ' + String(value.length))
  }
  return value
}

/**
 * The tool a caller reclaims with.
 * @param options - the ledger, the clock, and the threshold.
 * @returns the tool, in the fields the kernel's registry reads.
 */
function reclaimTool(options: ReclaimToolOptions): DeclaringTool {
  const clock = options.now ?? ((): number => Date.now())
  const timeoutMs = options.timeoutMs ?? RECLAIM_DEFAULT_TTL_MS
  return {
    name: RECLAIM_TOOL_NAME,
    description: 'Release an in_progress Task whose owner went silent, back to pending, and isolate that owner. '
      + 'The rule is named: an owner that beat inside the threshold is refused by code and nothing is written. '
      + 'An owner that never beat, or whose last beat is at least the threshold ago, or a row with no owner recorded, is released. '
      + 'The release is a fact in the collaboration ledger — the kernel\'s own board is the Lead\'s to change.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task: { type: 'string', description: 'The task id to release, as the board names it.' },
        team: { type: 'string', description: 'The team the task belongs to. Omit when the id is unambiguous; the call is refused when two teams share it.' },
        reason: { type: 'string', description: 'Why the caller is reclaiming, up to 200 characters. Recorded on the ledger row. Omit when there is nothing to say.' },
        at: { type: 'integer', description: 'The instant to decide and stamp at, in milliseconds since the epoch. Omit to use this end\'s clock.' },
      },
      required: ['task'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          seq: { type: 'integer', description: 'The sequence the task/state record was given.' },
          kind: { type: 'string', const: TASK_KIND, description: 'The kind of the record written.' },
          subject: { type: 'string', description: 'What the record is about: the task id.' },
          task: { type: 'string', description: 'The task that was released.' },
          id: { type: 'string', description: 'The task id, as the record carries it. The same value as task.' },
          team: { type: 'string', description: 'The team the task was resolved to, when it has one.' },
          state: { type: 'string', description: 'The state the task was released back to: pending.' },
          code: { type: 'string', description: 'The rule\'s named answer: NEVER_BEAT, HEARTBEAT_STALE or NO_OWNER.' },
          revision: { type: 'integer', description: 'The revision written, when the task already carried one.' },
          reclaimedFrom: { type: 'string', description: 'The owner that was cleared and isolated, when the row named one.' },
          reclaimedSeq: { type: 'integer', description: 'The sequence the isolation of that owner is folded from: the same row.' },
        },
        required: ['seq', 'kind', 'subject', 'task', 'id', 'state', 'code'],
      },
      render: (_args: unknown, value: unknown) => declaringText(value),
    },
    async execute(args: unknown): Promise<Record<string, unknown>> {
      const input = declarationInput(args)
      const task = requiredName(input.task, 'task', 'RECLAIM_')
      const team = optionalName(input.team, 'team', 'RECLAIM_')
      const reason = reclaimReason(input.reason)
      // The instant is data, not a reading taken inside the rule: the same value decides the verdict
      // and stamps the record, so no reader can find one reclaim that happened at two times.
      const at = input.at === undefined || input.at === null ? heartbeatInstant(clock()) : heartbeatInstant(input.at)
      const outcome = await reclaimTask(options.log, { task, team, timeoutMs, now: at, reason })
      // The answer carries the row's own fields, read back from the record that was appended rather
      // than assembled from the intent: a caller comparing answer and ledger must find one story.
      return {
        seq: outcome.seq,
        kind: outcome.task.kind,
        subject: outcome.task.subject,
        task: outcome.reading.taskId,
        id: outcome.reading.taskId,
        ...(outcome.reading.team === null ? {} : { team: outcome.reading.team }),
        state: outcome.after.status,
        code: outcome.reading.code,
        ...(outcome.task.payload.revision === undefined ? {} : { revision: outcome.task.payload.revision as number }),
        ...(outcome.reading.owner === null ? {} : { reclaimedFrom: outcome.reading.owner, reclaimedSeq: outcome.seq }),
      }
    },
  }
}

/**
 * Build the reclaim tool.
 *
 * **Registered by default**, because md:208-218 is a mechanism of the bus rather than an optional
 * extra: a member that dies holding work has to be recoverable on a deployment that never configured
 * anything. `config.reclaim.enabled === false` is the way out for a deployment that does not want a
 * writer in its tool list — and the rule, the fold and `linkCollab.reclaim` are there either way.
 *
 * (The shipped tool surface is itself a graded fact: `scripts/verify-collab-declare.mjs:442-449`
 * asserts the registry holds exactly the three declaring tools. Registering a fourth is a change to
 * that assertion, reported rather than smuggled — see `docs/handoff/R181-A-reclaim.md`.)
 * @param options - the ledger, the clock and the threshold.
 * @returns the tool, as the one-element list the installer appends.
 */
export function reclaimTools(options: ReclaimToolOptions): readonly DeclaringTool[] {
  return [reclaimTool(options)]
}

// ---------------------------------------------------------------- R182: what two leads settle between themselves

/**
 * The model-facing tools that settle a handshake between two leads.
 *
 * 《DSH LINK.md》md:244-246 and md:274 ask for leads that find one another, handshake, and only then send
 * work across: under the runtime's depth=1 ceiling the edge between sessions is the one fractal edge left.
 * The fold for it has been here since R38 - the peer/state kind, projectPeers(), mayExchange() and
 * pendingRequests() - and gates were its only writer, so a live ledger held no handshake at all and
 * "may these two exchange?" answered false on every installation. These two tools are that fold's producer,
 * and each writes exactly the record its fold reads.
 *
 * The pair is ordered in the arguments as well as in the ledger: from asks, to answers, and the answer keeps
 * that direction. A grant therefore says one thing - from may reach to - and nothing about the way back,
 * which needs its own request and its own answer.
 */
export const PEER_TOOL_NAMES = ['team_request_peer', 'team_answer_peer'] as const

/**
 * A handshake tool refused its input, with a code naming which rule was broken.
 *
 * The codes are this family's own (PEER_*) rather than the declaring tools', the argument itself included:
 * a model that reads PEER_FROM_NAME learns which tool refused and which field it refused, and a code shared
 * across three tool families would name neither. The code is the first thing in the message for the reason
 * DeclareRefusal states it: the tool registry renders a thrown error as "Error: <message>".
 */
export class PeerRefusal extends Error {
  /** The stable code this refusal is named by. */
  readonly code: string
  /**
   * @param code - the code, e.g. PEER_SELF.
   * @param detail - what was refused, and what the caller should send instead.
   */
  constructor(code: string, detail: string) {
    super(code + ': ' + detail)
    this.name = 'PeerRefusal'
    this.code = code
  }
}

/** The longest request one lead may put on a row: a sentence, not a document. */
export const PEER_REQUEST_MAX = 200

/** Read the argument object a handshake tool was called with, or refuse it under this family's own name. */
function peerInput(args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new PeerRefusal('PEER_INPUT', 'this tool takes one object of arguments; got ' + describeValue(args))
  }
  return args as Record<string, unknown>
}

/**
 * Read what one lead is asking for.
 *
 * Free text rather than a name: the declaring tools' grammar exists so a row can be looked up by a member or
 * a team, and a request is a sentence nothing is keyed by - the ordered pair is the key. Bounded and
 * non-empty for the reason a reclaim's reason is: an empty request is a row the other lead can be shown and
 * not answered.
 * @param value - the request as the model sent it.
 * @returns the request, as written.
 */
function peerRequest(value: unknown): string {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    throw new PeerRefusal('PEER_REQUEST_EMPTY', 'request is required and must not be empty; got ' + describeValue(value ?? null))
  }
  if (typeof value !== 'string') {
    throw new PeerRefusal('PEER_REQUEST_TEXT', 'request must be a string; got ' + describeValue(value))
  }
  if (value.length > PEER_REQUEST_MAX) {
    throw new PeerRefusal('PEER_REQUEST_LONG', 'request must be at most ' + String(PEER_REQUEST_MAX) + ' characters; got ' + String(value.length))
  }
  return value
}

/**
 * Read the two leads a handshake is between.
 *
 * A lead cannot handshake with itself: the fold's key is the ordered pair, so from === to would be a row
 * about a direction with no other end. It is refused here because it is the one malformed pair a writer can
 * see in its own arguments alone - there is no longer cycle to leave to the fold, in a table with no edges
 * to follow.
 * @param input - the arguments, already read as an object.
 * @returns the asking lead and the answering lead, as written.
 */
function peerPair(input: Record<string, unknown>): { from: string, to: string } {
  // One grammar, two families: the name is read by the same function the declaring tools use, and refused
  // as this family's refusal, so a caller that catches a handshake failure never catches a class belonging
  // to a tool it did not call.
  const refuse = (code: string, detail: string): Error => new PeerRefusal(code, detail)
  const from = requiredName(input.from, 'from', 'PEER_', refuse)
  const to = requiredName(input.to, 'to', 'PEER_', refuse)
  if (from === to) {
    throw new PeerRefusal('PEER_SELF', 'lead ' + describeValue(from)
      + ' cannot handshake with itself; name the lead at the other end, or exchange inside one team instead')
  }
  return { from, to }
}

/**
 * Read the answer one lead gives.
 *
 * Only granted and denied are answers. A requested state is refused by name rather than accepted: a tool
 * that answered with it would open requests through the answering side, and the two doors to one state would
 * disagree about who asked - one of them cannot say.
 * @param value - the state as the model sent it.
 * @returns the answer, as written.
 */
function peerAnswerState(value: unknown): 'granted' | 'denied' {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    throw new PeerRefusal('PEER_STATE_EMPTY', 'state is required and must be granted or denied; got ' + describeValue(value ?? null))
  }
  if (value !== 'granted' && value !== 'denied') {
    throw new PeerRefusal('PEER_STATE', 'state ' + describeValue(value) + ' is not an answer; use granted or denied'
      + (value === 'requested' ? ' - a request is opened with ' + PEER_TOOL_NAMES[0] : ''))
  }
  return value
}

/** The row the ledger holds for one ordered direction, or undefined when it holds none. */
function peerRowOn(state: TeamState, from: string, to: string): PeerPair | undefined {
  return state.peers.pairs.find((pair) => pair.from === from && pair.to === to)
}

/**
 * The tool one lead asks another with.
 * @param log - the ledger the request is appended to.
 * @returns the tool, in the fields the kernel's registry reads.
 */
function peerRequestTool(log: ControlLog): DeclaringTool {
  return {
    name: PEER_TOOL_NAMES[0],
    description: 'Ask another Team lead to exchange with you directly (《DSH LINK.md》md:244-246). '
      + 'The handshake is a fact in the collaboration ledger, and the pair is ordered: this call records that '
      + 'from is asking to, so it grants neither side anything yet - only the answer does, and it keeps this direction. '
      + 'The other lead answers with ' + PEER_TOOL_NAMES[1] + '.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: { type: 'string', description: 'The lead asking - the asking end of the ordered pair.' },
        to: { type: 'string', description: 'The lead being asked. It cannot be the asking lead itself.' },
        request: { type: 'string', description: 'What is being asked for, in the caller\'s own words, up to ' + String(PEER_REQUEST_MAX) + ' characters.' },
      },
      required: ['from', 'to', 'request'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          seq: { type: 'integer', description: 'The sequence the ledger assigned this record.' },
          kind: { type: 'string', const: PEER_KIND },
          subject: { type: 'string', description: 'The ordered pair, as the record spells it: from->to.' },
          from: { type: 'string' },
          to: { type: 'string' },
          request: { type: 'string' },
          state: { type: 'string', const: 'requested', description: 'The state written: a request is not permission.' },
          allowed: { type: 'boolean', description: 'Whether the fold now allows from to reach to: false for a request.' },
          reversed: { type: 'boolean', description: 'Whether the fold allows to to reach from - the other direction, which this row says nothing about.' },
        },
        required: ['seq', 'kind', 'subject', 'from', 'to', 'request', 'state', 'allowed', 'reversed'],
      },
      render: (_args: unknown, value: unknown) => declaringText(value),
    },
    async execute(args: unknown): Promise<Record<string, unknown>> {
      const input = peerInput(args)
      const { from, to } = peerPair(input)
      const request = peerRequest(input.request)
      // A request against a standing grant is refused rather than written: the fold keeps the highest sequence
      // per pair, so a second request would silently clear a permission both leads had already settled. An
      // answer of denied is the way to reopen a negotiation, and it says what it did.
      const before = foldStateOf(log)
      if (peerRowOn(before, from, to)?.state === 'granted') {
        throw new PeerRefusal('PEER_ALREADY_GRANTED', 'the ledger already holds ' + from + ' -> ' + to
          + ' as granted, and a request would clear it; answer that pair with ' + PEER_TOOL_NAMES[1] + ' (denied) to reopen it')
      }
      // The record comes from the same export the folds already read, so a tool cannot invent a spelling the
      // projection would not recognize. actor names the asking side, which is who caused the row.
      const record = peerRecord(from, to, request, 'requested')
      const seq = await log.append({ ...record, actor: from })
      // The answer carries the direction the fold now gives, read back from the ledger instead of assumed:
      // allowed is this direction's verdict and reversed the other one, so a caller reading the answer sees
      // the asymmetry the ledger keeps.
      // One named question per direction, answered by the fold after the append.
      const answers = await foldAfterQueries(log, [
        { kind: 'mayExchange', from, to },
        { kind: 'mayExchange', from: to, to: from },
      ])
      return {
        seq,
        kind: record.kind,
        subject: record.subject,
        from,
        to,
        request,
        state: 'requested',
        allowed: answers[0] === true,
        reversed: answers[1] === true,
      }
    },
  }
}

/**
 * The tool one lead answers with: the grant, and the denial that clears one.
 * @param log - the ledger the answer is appended to.
 * @returns the tool, in the fields the kernel's registry reads.
 */
function peerAnswerTool(log: ControlLog): DeclaringTool {
  return {
    name: PEER_TOOL_NAMES[1],
    description: 'Answer a lead\'s request to exchange: grant it, or deny it. '
      + 'The pair keeps the direction that was asked - from is the asking lead and to is the answering lead - so a grant '
      + 'records that from may reach to and says nothing about to reaching from, which needs its own request and its own answer. '
      + 'A later denial clears an earlier grant because the higher sequence wins, not by a second mechanism.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: { type: 'string', description: 'The lead that asked - the asking end of the ordered pair, as the request wrote it.' },
        to: { type: 'string', description: 'The lead answering. It cannot be the asking lead itself.' },
        state: { type: 'string', description: 'The answer: granted or denied. A request is not an answer.' },
        request: { type: 'string', description: 'What this answer is about. Omit to carry the request the ledger already holds for the pair.' },
      },
      required: ['from', 'to', 'state'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          seq: { type: 'integer', description: 'The sequence the ledger assigned this record.' },
          kind: { type: 'string', const: PEER_KIND },
          subject: { type: 'string', description: 'The ordered pair, as the record spells it: from->to.' },
          from: { type: 'string' },
          to: { type: 'string' },
          request: { type: 'string', description: 'The request written on the answer row.' },
          state: { type: 'string', description: 'The state written: granted or denied.' },
          allowed: { type: 'boolean', description: 'Whether the fold now allows from to reach to.' },
          reversed: { type: 'boolean', description: 'Whether the fold allows to to reach from - the other direction, which this answer does not decide.' },
        },
        required: ['seq', 'kind', 'subject', 'from', 'to', 'request', 'state', 'allowed', 'reversed'],
      },
      render: (_args: unknown, value: unknown) => declaringText(value),
    },
    async execute(args: unknown): Promise<Record<string, unknown>> {
      const input = peerInput(args)
      const { from, to } = peerPair(input)
      const state = peerAnswerState(input.state)
      const before = foldStateOf(log)
      const pair = peerRowOn(before, from, to)
      // An answer is about a request: the fold keeps one request per ordered pair, and answering a pair nobody
      // asked about would write a permission with nothing behind it. The refusal names the direction, because
      // the other direction is a different pair and a caller who swapped them learns that here.
      if (pair === undefined) {
        throw new PeerRefusal('PEER_REQUEST_NONE', 'the ledger holds no request from ' + from + ' to ' + to
          + '; ask first with ' + PEER_TOOL_NAMES[0] + ' (the pair is ordered, and the other direction is a different pair)')
      }
      // Carried, not invented: the answer repeats the request it answers unless the caller names one, so the
      // row can be read on its own.
      const request = input.request === undefined || input.request === null ? pair.request : peerRequest(input.request)
      if (request === '') {
        throw new PeerRefusal('PEER_REQUEST_BLANK', 'the ledger holds a ' + from + ' -> ' + to
          + ' row that carries no request text; name the request this answer is about')
      }
      const record = peerRecord(from, to, request, state)
      // actor names the answering side: the row was caused by the lead the request was addressed to.
      const seq = await log.append({ ...record, actor: to })
      const answers = await foldAfterQueries(log, [
        { kind: 'mayExchange', from, to },
        { kind: 'mayExchange', from: to, to: from },
      ])
      return {
        seq,
        kind: record.kind,
        subject: record.subject,
        from,
        to,
        request,
        state,
        allowed: answers[0] === true,
        reversed: answers[1] === true,
      }
    },
  }
}

/** What {@link peerTools} needs. */
export interface PeerToolOptions {
  /** The ledger the handshakes are appended to. */
  readonly log: ControlLog
}

/**
 * Build the two handshake tools.
 *
 * Registered with the declaring tools and by the same rule: a deployment that configured nothing still gets
 * the producer, because md:244-246 is a mechanism of the bus rather than an extra. There is no switch here,
 * and that is deliberate - the three declaring tools have none either, and a switch would make "these two
 * leads may not exchange" indistinguishable from "nobody wired the tool".
 * @param options - the ledger.
 * @returns the two tools, in registration order.
 */
export function peerTools(options: PeerToolOptions): readonly DeclaringTool[] {
  return [peerRequestTool(options.log), peerAnswerTool(options.log)]
}


/** The two model-visible merge tools, in registration order. */
export const MERGE_TOOL_NAMES = ['team_request_merge', 'team_answer_merge'] as const

/** Read the argument object a merge tool was called with, or refuse it under this family's own name. */
function mergeInput(args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new MergeRefusal('MERGE_INPUT', 'this tool takes one object of arguments; got ' + describeValue(args))
  }
  return args as Record<string, unknown>
}

/** The refusal constructor the shared name grammar reports through, so a bad field is refused as MERGE_*. */
function mergeRefuse(code: string, detail: string): Error {
  return new MergeRefusal(code, detail)
}

/**
 * Read the direction a request names.
 *
 * Both directions are refused when they are not one of the two words: `mode` decides which side becomes
 * the other's child, so a value this layer guessed at would move a team the caller never named.
 * @param value - the mode as the model sent it.
 * @returns the direction, as written.
 */
function mergeMode(value: unknown): MergeMode {
  if (value === undefined || value === null) {
    throw new MergeRefusal('MERGE_MODE', 'mode is required and must be join or absorb; got ' + describeValue(value ?? null))
  }
  if (value !== 'join' && value !== 'absorb') {
    throw new MergeRefusal('MERGE_MODE', 'mode ' + describeValue(value) + ' is not a direction; use join (this team is taken in) or absorb (this team takes the other in)')
  }
  return value
}

/**
 * The teams one writer's own lead speaks for, as the tree fold read them.
 *
 * This is how a merge tool learns which team is asking without being told twice: the ledger already
 * holds every `team/state` row's `lead`, and the log knows who is writing. Two teams led by one
 * writer is refused rather than resolved — a caller that leads two teams has to name the one it means,
 * and picking either for it would put the choice in this layer instead of in the call.
 * @param state - a folded state.
 * @param writer - the ledger's own writer name.
 * @returns the teams whose declaration names this writer as lead.
 */
function teamsLedBy(state: TeamState, writer: string): readonly string[] {
  return state.teams.teams.filter((team) => team.lead === writer).map((team) => team.id)
}

/**
 * The tool one team asks another with.
 *
 * `team` is always the team at the **other** end: with `join` it is the team that takes this one in,
 * with `absorb` it is the team this one takes in. The asking team is the one this ledger's writer
 * leads, which is a fact the ledger holds rather than an argument the model repeats.
 * @param options - the ledger and the clock the row is stamped with.
 * @returns the tool, in the fields the kernel's registry reads.
 */
function mergeRequestTool(options: MergeToolOptions): DeclaringTool {
  const log = options.log
  const clock = options.now ?? ((): number => Date.now())
  return {
    name: MERGE_TOOL_NAMES[0],
    description: 'Ask another Team to merge with yours — to take this team in (mode join), or to be taken in by it (mode absorb). '
      + 'The ask is a fact in the collaboration ledger and it changes no tree: only the answer does, and only the party being merged in writes its own parent. '
      + 'The two leads must already have a granted handshake, and the other team answers with ' + MERGE_TOOL_NAMES[1] + '.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        team: { type: 'string', description: 'The team at the other end: with join, the team that takes yours in; with absorb, the team yours takes in.' },
        mode: { type: 'string', description: 'join (your team is taken in) or absorb (your team takes the other in).' },
      },
      required: ['team', 'mode'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          seq: { type: 'integer', description: 'The sequence the ledger assigned this record.' },
          kind: { type: 'string', const: MERGE_KIND },
          subject: { type: 'string', description: 'The asking team, which is what the record is about.' },
          from: { type: 'string', description: 'The asking team — this ledger writer\'s own team.' },
          to: { type: 'string', description: 'The team being asked.' },
          mode: { type: 'string', description: 'The direction written.' },
          state: { type: 'string', const: 'requested', description: 'The state written: a request is not a permission.' },
          by: { type: 'string', description: 'Who asked — this ledger\'s writer, as the row carries it.' },
          at: { type: 'integer', description: 'The instant written on the row.' },
          mayExchange: { type: 'boolean', description: 'Whether the two leads may exchange, read back from the ledger.' },
          mayMerge: { type: 'boolean', description: 'Whether the fold now allows this merge — false for a request.' },
        },
        required: ['seq', 'kind', 'subject', 'from', 'to', 'mode', 'state', 'by', 'at', 'mayExchange', 'mayMerge'],
      },
      render: (_args: unknown, value: unknown) => declaringText(value),
    },
    async execute(args: unknown): Promise<Record<string, unknown>> {
      const input = mergeInput(args)
      const team = requiredName(input.team, 'team', 'MERGE_', mergeRefuse)
      const mode = mergeMode(input.mode)
      const before = foldStateOf(log)
      const led = teamsLedBy(before, log.writer)
      if (led.length !== 1) {
        throw new MergeRefusal('MERGE_LOCAL_TEAM', led.length === 0
          ? 'this ledger records no team led by ' + describeValue(log.writer) + ', so there is no asking team; declare it first (team/state with lead) and ask again'
          : 'this ledger records ' + String(led.length) + ' teams led by ' + describeValue(log.writer) + ' (' + led.join(', ') + '); a request comes from one team, so name your own team as the team this ledger leads')
      }
      const from = led[0]
      if (from === team) {
        throw new MergeRefusal('MERGE_SELF', 'team ' + describeValue(from) + ' cannot merge with itself; name the team at the other end (a team cannot be its own parent)')
      }
      // 先握手后合并: the handshake is the precondition of the whole act, in both directions of the asking.
      // The question is mayExchange's and nothing else's — it is called, never re-derived here.
      if (!mayExchange(before, from, team)) {
        throw new MergeRefusal('MERGE_PEER_REQUIRED', from + ' and ' + team + ' have no granted handshake in that direction, and a merge needs one; '
          + 'settle it first with the lead handshake tools (the pair is ordered: ' + from + ' -> ' + team + ' is its own question)')
      }
      const standing = before.merges.pairs.find((pair) => pair.from === from && pair.to === team)
      // A second request against a standing grant is refused rather than written: the fold keeps the
      // highest sequence per pair, so the request would silently clear an agreement both sides had
      // settled. Answering with denied is the way to reopen it, and it says what it did.
      if (standing?.state === 'granted') {
        throw new MergeRefusal('MERGE_ALREADY_GRANTED', 'the ledger already holds ' + from + ' -> ' + team + ' as granted, and a request would clear it; '
          + 'answer that pair with ' + MERGE_TOOL_NAMES[1] + ' (grant false) to reopen it')
      }
      const record = mergeRecord({ from, to: team, mode, state: 'requested', by: log.writer, at: clock() })
      const seq = await log.append({ ...record, actor: from })
      // Read back from the ledger instead of assumed, the rule R182's peer tools were fixed to follow:
      // an answer that says more than the ledger holds is a model reading a fact nobody wrote.
      const answers = await foldAfterQueries(log, [
        { kind: 'mayExchange', from, to: team },
        { kind: 'mayMerge', from, to: team },
      ])
      return {
        seq,
        kind: record.kind,
        subject: record.subject,
        from,
        to: team,
        mode,
        state: 'requested',
        by: log.writer,
        at: record.payload.at,
        mayExchange: answers[0] === true,
        mayMerge: answers[1] === true,
      }
    },
  }
}

/**
 * The tool one team answers with: the agreement, and the denial that clears one.
 *
 * **Two facts, one call.** A grant is the moment a tree changes, so it writes the answering party's
 * own `team/state` row (its parent is the team taking it in) and then the authorization that names who
 * did it. The two rows are separate on purpose: the tree is a different question from the agreement
 * that explains it, and a reader that had only one of them would have to guess the other.
 *
 * The parent row repeats the lead it found on the team's own last declaration, because the fold reads
 * a row that carries no lead as "no lead at all" — clearing one fact while writing another is exactly
 * what this layer refuses everywhere else.
 * @param options - the ledger and the clock the rows are stamped with.
 * @returns the tool, in the fields the kernel's registry reads.
 */
function mergeAnswerTool(options: MergeToolOptions): DeclaringTool {
  const log = options.log
  const clock = options.now ?? ((): number => Date.now())
  return {
    name: MERGE_TOOL_NAMES[1],
    description: 'Answer a team\'s request to merge: grant it, or deny it. '
      + 'Only the party being merged in may answer, and a grant writes exactly two rows: that team\'s own team/state (its parent is the team taking it in) and the merge row that names who authorized it. '
      + 'A denial writes one row and changes no tree, and a later denial clears an earlier grant because the higher sequence wins.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: { type: 'string', description: 'The team that asked — the asking team of the request being answered, as the request wrote it.' },
        team: { type: 'string', description: 'The team answering. Omit to read it from this ledger (the team its writer leads). It must be the party being merged in; naming anybody else is refused and nothing is written.' },
        grant: { type: 'boolean', description: 'true to merge, false to deny. A request is not an answer.' },
      },
      required: ['from', 'grant'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          seq: { type: 'integer', description: 'The sequence the merge record was given.' },
          kind: { type: 'string', const: MERGE_KIND },
          subject: { type: 'string', description: 'The asking team, which is what the record is about.' },
          from: { type: 'string' },
          to: { type: 'string' },
          mode: { type: 'string', description: 'The direction of the request that was answered.' },
          state: { type: 'string', description: 'The answer written: granted or denied.' },
          by: { type: 'string', description: 'Who answered — this ledger\'s writer, as the row carries it.' },
          at: { type: 'integer', description: 'The instant written on the merge row.' },
          treeSeq: { type: 'integer', description: 'The sequence of the team/state row written by a grant. Absent on a denial: a denial writes one row.' },
          treeTeam: { type: 'string', description: 'The team whose parent was written, when a grant wrote one.' },
          treeParent: { type: 'string', description: 'The parent written, when a grant wrote one.' },
          mayExchange: { type: 'boolean', description: 'Whether the two leads may exchange, read back from the ledger.' },
          mayMerge: { type: 'boolean', description: 'Whether the fold now allows this merge, read back from the ledger.' },
        },
        required: ['seq', 'kind', 'subject', 'from', 'to', 'mode', 'state', 'by', 'at', 'mayExchange', 'mayMerge'],
      },
      render: (_args: unknown, value: unknown) => declaringText(value),
    },
    async execute(args: unknown): Promise<Record<string, unknown>> {
      const input = mergeInput(args)
      const from = requiredName(input.from, 'from', 'MERGE_', mergeRefuse)
      const grant = input.grant
      if (typeof grant !== 'boolean') {
        throw new MergeRefusal('MERGE_GRANT', 'grant must be true or false; got ' + describeValue(grant ?? null))
      }
      const named = optionalName(input.team, 'team', 'MERGE_')
      const before = foldStateOf(log)
      // The party being merged in is decided by the direction, and the direction is read from the row:
      // join takes the asking team in, absorb takes the asked team in.
      const mergedInOf = (pair: MergeRow): string => (pair.mode === 'join' ? pair.from : pair.to)
      // An answer is about a row that stands: the fold keeps one row per ordered pair, and a pair nobody
      // ever wrote about has nothing to answer. The optional team narrows it to the party being merged
      // in — the one fact that tells two requests from one asking team apart.
      const rows = before.merges.pairs.filter((pair) => pair.from === from)
      const standing = named === null ? rows : rows.filter((pair) => mergedInOf(pair) === named)
      if (standing.length === 0) {
        throw new MergeRefusal('MERGE_REQUEST_NONE', 'the ledger holds no standing merge row from ' + from
          + (named === null ? '' : ' whose party being merged in is ' + describeValue(named))
          + '; ask first with ' + MERGE_TOOL_NAMES[0] + ' (the pair is ordered, and the other direction is a different pair)')
      }
      // Two rows for one asking team and no team named: the answer would have to guess which agreement
      // it is, and a guess here moves a team tree. Name the party being merged in instead.
      if (standing.length > 1) {
        throw new MergeRefusal('MERGE_REQUEST_AMBIGUOUS', 'the ledger holds ' + String(standing.length) + ' merge rows from ' + from
          + ' (' + standing.map((pair) => pair.to + '/' + pair.mode).join(', ') + '); name team as the party being merged in, so the answer names the one agreement it settles')
      }
      const request = standing[0]
      const to = request.to
      const mode = request.mode
      const mergedIn = mergedInOf(request)
      const parent = mode === 'join' ? to : from
      const led = teamsLedBy(before, log.writer)
      const caller = named ?? (led.length === 1 ? led[0] : null)
      if (caller === null) {
        throw new MergeRefusal('MERGE_NOT_AUTHORIZED', 'this ledger records no team led by ' + describeValue(log.writer)
          + ' and the call named none, so there is no answering lead; name team (' + mergedIn + ' is the party being merged in) or declare that team\'s lead first')
      }
      // A named team is a claim about who is writing, and a claim that contradicts the ledger is refused
      // rather than believed: this is what keeps "only the party being merged in answers" a fact about
      // the ledger instead of a sentence a caller may assert about somebody else's team.
      if (led.length > 0 && led.includes(caller) !== true) {
        throw new MergeRefusal('MERGE_NOT_AUTHORIZED', 'this ledger records ' + describeValue(log.writer) + ' as the lead of '
          + led.join(', ') + ', and ' + describeValue(caller) + ' is not one of them; an agreement is written by the party being merged in, speaking for its own team')
      }
      if (caller !== mergedIn) {
        throw new MergeRefusal('MERGE_NOT_AUTHORIZED', 'a merge writes the parent of ' + describeValue(mergedIn) + ' (the party being merged in), and ' + describeValue(caller)
          + ' is not it; only that party\'s own lead may answer, because two writers of one parent is two answers to one question')
      }
      if (!mayExchange(before, from, to)) {
        throw new MergeRefusal('MERGE_PEER_REQUIRED', from + ' and ' + to + ' have no granted handshake in that direction, and a merge needs one; '
          + 'settle it first with the lead handshake tools (the pair is ordered: ' + from + ' -> ' + to + ' is its own question)')
      }
      const at = clock()
      let tree: { seq: number, kind: string, subject: string, payload: Record<string, unknown> } | null = null
      if (grant) {
        const standing = before.teams.teams.find((team) => team.id === mergedIn)
        // The row carries the lead the ledger already holds: projectTeams reads a row without one as
        // "no lead", so writing the parent alone would silently unseat the team's own lead.
        const declaration = teamRecord(mergedIn, parent, ...(standing?.lead === null || standing?.lead === undefined ? [] : [standing.lead]))
        const treeSeq = await log.append({ ...declaration, actor: log.writer })
        tree = { seq: treeSeq, kind: declaration.kind, subject: declaration.subject, payload: declaration.payload }
      }
      const record = mergeRecord({ from, to, mode, state: grant ? 'granted' : 'denied', by: log.writer, at })
      const seq = await log.append({ ...record, actor: mergedIn })
      const answers = await foldAfterQueries(log, [
        { kind: 'mayExchange', from, to },
        { kind: 'mayMerge', from, to },
      ])
      return {
        seq,
        kind: record.kind,
        subject: record.subject,
        from,
        to,
        mode,
        state: grant ? 'granted' : 'denied',
        by: log.writer,
        at,
        ...(tree === null ? {} : { treeSeq: tree.seq, treeTeam: tree.subject, treeParent: parent }),
        mayExchange: answers[0] === true,
        mayMerge: answers[1] === true,
      }
    },
  }
}

/** What {@link mergeTools} needs. */
export interface MergeToolOptions {
  /** The ledger the merges are appended to. */
  readonly log: ControlLog
  /**
   * The clock a row is stamped with. Injectable for the reason every other clock here is: a reading
   * that depends on wall time cannot be reproduced. @default Date.now
   */
  readonly now?: () => number
}

/**
 * Build the two merge tools.
 *
 * Registered with the declaring and handshake tools and by the same rule: a deployment that configured
 * nothing still gets the producer, because md:274 is a mechanism of the bus rather than an extra.
 * There is no switch, for the reason the handshake pair has none — a switch would make "these two
 * teams may not merge" indistinguishable from "nobody wired the tool".
 * @param options - the ledger and the clock.
 * @returns the two tools, in registration order.
 */
export function mergeTools(options: MergeToolOptions): readonly DeclaringTool[] {
  return [mergeRequestTool(options), mergeAnswerTool(options)]
}

// ---------------------------------------------------------------- R179: the ledger page a surface reads

/** Where a page starts, and how much of it comes back. */
export interface ControlPageOptions {
  /** Exclusive lower bound on `seq`. @default 0 */
  readonly since?: number
  /** Maximum rows to return; a larger request is capped at {@link CONTROL_PAGE_MAX}. @default 100 */
  readonly limit?: number
  /** What the log's own reader could not parse, carried through by the caller that holds the log. */
  readonly damage?: DamageReport | null
}

/** One control record, as a surface renders it. */
export interface ControlRow {
  /** The sequence this record holds in the ledger. */
  readonly seq: number
  /** What happened, in the writer's vocabulary (`capability/state`, `team/state`, `member/heartbeat`). */
  readonly kind: string
  /** The instant the writer stamped it, in milliseconds. */
  readonly at: number
  /** Who caused it, when the record names anyone. */
  readonly actor?: string
  /** What it happened to, when the record names anything. */
  readonly subject?: string
  /** The rest of the record, as the writer left it: the capability set, the parent, the instant. */
  readonly payload?: unknown
}

/**
 * One page of the control ledger, with the state that page folds to.
 *
 * The pair is one reading rather than two: `state` folds every record up to {@link ControlPage.through},
 * so a surface rendering "what is happening right now" holds rows and a state that agree with each
 * other, and carries `next` forward as its cursor.
 */
export interface ControlPage {
  /** The cursor the page started after, echoed. */
  readonly from: number
  /** The highest sequence the page reached, or `from` when it returned nothing. */
  readonly through: number
  /** The cursor to ask from next time; equal to `through`. */
  readonly next: number
  /** The page's rows, in sequence order. */
  readonly rows: readonly ControlRow[]
  /** The state every record up to `through` folds to. */
  readonly state: TeamState
  /** How many records the ledger holds, how many came back, and whether more remain. */
  readonly counts: { readonly total: number, readonly returned: number, readonly more: boolean }
  /** What the log's reader could not parse, or null when the ledger read clean. */
  readonly damage: DamageReport | null
}

/** The largest page a caller may ask for. */
export const CONTROL_PAGE_MAX = 1000
/** What a page returns when its caller names no limit. */
const CONTROL_PAGE_DEFAULT = 100

/**
 * Fold one page of a ledger out of its records.
 *
 * Pure: no clock is read and none is accepted, so two calls over the same records are the same page,
 * and a caller that needs a verdict at an instant supplies its own — the same rule `livenessOf` and
 * its neighbours follow. Records are ordered by sequence before the page is taken, so the answer does
 * not depend on how the caller's array happened to be arranged.
 * @param records - every record read from the log, in any order.
 * @param options - where to resume, how much to take, and what the reader reported as damage.
 * @returns the page, and the fold through it.
 */
export function controlPage(records: readonly ControlRecord[], options: ControlPageOptions = {}): ControlPage {
  const since = options.since ?? 0
  const requested = options.limit ?? CONTROL_PAGE_DEFAULT
  if (!Number.isInteger(since) || since < 0) throw new TypeError('controlPage: since must be a non-negative integer')
  if (!Number.isInteger(requested) || requested < 1) throw new TypeError('controlPage: limit must be a positive integer')
  const ordered = orderedRecords(records)
  const after = ordered.filter((record) => record.seq > since)
  const page = after.slice(0, Math.min(requested, CONTROL_PAGE_MAX))
  const through = page.length === 0 ? since : page[page.length - 1].seq
  return {
    from: since,
    through,
    next: through,
    rows: page.map((record) => ({
      seq: record.seq,
      kind: record.kind,
      at: record.at,
      ...(record.actor === undefined ? {} : { actor: record.actor }),
      ...(record.subject === undefined ? {} : { subject: record.subject }),
      ...(record.payload === undefined ? {} : { payload: record.payload }),
    })),
    // The fold stops at the page, never at the end of the ledger: folding everything would answer
    // with a state the rows above do not produce, and a cursor whose two halves disagree is worse
    // than no cursor at all.
    state: projectTeamState(ordered.filter((record) => record.seq <= through)),
    counts: { total: ordered.length, returned: page.length, more: after.length > page.length },
    damage: options.damage ?? null,
  }
}

/** The slice of the kernel's tool registry this plugin registers through. */
export interface DeclaringToolRegistry {
  /**
   * Register one tool.
   * @param definition - the definition, in the fields the registry reads.
   * @returns the exact disposer that unregisters it.
   */
  register(definition: DeclaringTool): () => void
}

/** What a composition can read about the declaring tools it registered. */
export interface DeclaringToolsState {
  /** Whether every declared tool was registered. */
  registered: boolean
  /** The names registered, in the order they were registered. */
  readonly names: string[]
  /** Why they are not all registered, or null when they are. */
  reason: string | null
}

/**
 * Register the declaring tools on this composition's tool registry.
 *
 * Nothing here touches `ctx.agentTeams`. The tools append to this plugin's own ledger, which is the
 * arrangement this module exists for: a tool that wrapped the Team service would freeze one of the
 * kernel shapes the compatibility layer exists to survive, and the ledger would stop being the
 * authority on what a member declared.
 *
 * A composition with no tool registry keeps everything else — the ledger opens, the recorder runs,
 * `state()` and `records()` answer — and this reading says so, because a plugin that disappears when
 * one optional service is absent is the failure this project keeps finding.
 * @param ctx - the plugin context.
 * @param log - the ledger the tools append to.
 * @param state - the reading the caller publishes; the same object is updated and returned.
 * @returns the reading object that was passed in.
 */
export interface DeclaringToolInstallOptions {
  /**
   * The reclaim tool, when this composition leaves it on.
   *
   * Absent means registered - a composition that configured nothing still gets it. `enabled: false`
   * means the registry holds the three declaring tools and nothing else. The capability method
   * (`linkCollab.reclaim`) exists either way; this is only about what the model is offered.
   */
  readonly reclaim?: {
    /** Whether to register {@link RECLAIM_TOOL_NAME}. @default true */
    readonly enabled?: boolean
    /** The threshold the tool decides with. @default {@link RECLAIM_DEFAULT_TTL_MS} */
    readonly timeoutMs?: number
    /** The clock the tool stamps a reclaim it was given no instant for. @default Date.now */
    readonly now?: () => number
  }
}

export function installDeclaringTools(ctx: CollabContext, log: ControlLog, state: DeclaringToolsState, options: DeclaringToolInstallOptions = {}): DeclaringToolsState {
  const inject = ctx.inject
  if (inject === undefined) {
    state.reason = 'this context cannot inject the tools service'
    return state
  }
  state.reason = 'waiting for the tools service'
  inject.call(ctx, ['tools'], (scoped) => {
    const registry = scoped.get?.('tools') as DeclaringToolRegistry | undefined
    if (registry === undefined || typeof registry.register !== 'function') {
      state.reason = 'this composition mounts no tool registry'
      return
    }
    // The reclaim tool is appended, never substituted: a composition that asks for it keeps every
    // declaring tool as well, so enabling recovery cannot quietly remove the way a member declares.
    const definitions = [
      ...declaringTools({ log }),
      // R181 lead ruling: default ON, with `config.reclaim.enabled === false` as the way out - which is
      // what this option's own JSDoc above already promised ("the way out for a deployment that does not
      // want a reclaim tool"). The first cut had it inverted (opt-in), so the shipped composition
      // registered no reclaimer and the gate's reading 8 was right to call it out.
      ...(options.reclaim?.enabled !== false
        ? reclaimTools({
          log,
          ...(options.reclaim.timeoutMs === undefined ? {} : { timeoutMs: options.reclaim.timeoutMs }),
          ...(options.reclaim.now === undefined ? {} : { now: options.reclaim.now }),
        })
        : []),
      // R182: the handshake producer, registered with the declaring tools and by the same rule. These two
      // names are a change to the shipped tool face, which two gates pin from their own sides - gate 107 by
      // name (ALL_TOOL_NAMES) and gate 108's reading 8 by count. The change is reported rather than smuggled:
      // docs/handoff/R182-A-peer-tools.md names the two tools and the exact widening each gate needs.
      ...peerTools({ log }),
      // R183: the merge pair, registered with the declaring tools and by the same rule. These two names
      // are a change to the shipped tool face, which gate 107 pins by name (ALL_TOOL_NAMES): reported
      // rather than smuggled - docs/handoff/R183-A-ledger.md names the two tools and the exact widening.
      ...mergeTools({ log }),
    ]
    let failure: string | null = null
    for (const definition of definitions) {
      try {
        const dispose = registry.register(definition)
        // The registration is an effect of this plugin's fiber, like every other contribution it
        // makes: unloading the plugin unregisters the tools, so a disposed plugin cannot leave one
        // pointing at a ledger it has closed.
        if (ctx.effect !== undefined) ctx.effect(() => dispose)
        state.names.push(definition.name)
      } catch (error) {
        failure = 'registering ' + definition.name + ' failed: ' + String((error as { message?: unknown })?.message ?? error)
        console.error('[dsh-link-collab] ' + failure)
      }
    }
    state.registered = state.names.length === definitions.length
    state.reason = state.registered ? null : (failure ?? 'the tool registry accepted none of the declaring tools')
  })
  return state
}


/**
 * Apply the plugin: open the control channel, start recording Team events, and bind the relay route.
 *
 * @param ctx - the cordis context this plugin is applied to.
 * @param config - the row's own configuration; empty means the DSH home and no relay.
 */
export function apply(ctx: CollabContext, config: CollabConfig = {}): void {
  const context = ctx
  // The fold layer's configuration is read BEFORE the ledger opens: whether a checkpoint may be read
  // and written is a decision the first fold must already know, and a bad value is reported here
  // where the row's own field names are still visible.
  const foldConfig = config.fold ?? {}
  if (foldConfig.checkpoint !== undefined && typeof foldConfig.checkpoint !== 'boolean') throw new TypeError('dsh-link-collab: fold.checkpoint must be a boolean')
  if (foldConfig.worker !== undefined && typeof foldConfig.worker !== 'boolean') throw new TypeError('dsh-link-collab: fold.worker must be a boolean')
  const foldCheckpointEnabled = foldConfig.checkpoint === true
  const foldCheckpointEveryMs = foldConfig.checkpointIntervalMs === undefined ? 5_000 : Number(foldConfig.checkpointIntervalMs)
  if (!Number.isInteger(foldCheckpointEveryMs) || foldCheckpointEveryMs <= 0) throw new TypeError('dsh-link-collab: fold.checkpointIntervalMs must be a positive integer')
  if (foldConfig.fastOpen !== undefined && typeof foldConfig.fastOpen !== 'boolean') throw new TypeError('dsh-link-collab: fold.fastOpen must be a boolean')
  const foldStampVerifyMs = foldConfig.stampVerifyMs === undefined ? 60_000 : Number(foldConfig.stampVerifyMs)
  if (!Number.isInteger(foldStampVerifyMs) || foldStampVerifyMs <= 0) throw new TypeError('dsh-link-collab: fold.stampVerifyMs must be a positive integer')
  configureFold({ checkpoint: foldCheckpointEnabled, checkpointIntervalMs: foldCheckpointEveryMs, fastOpen: foldConfig.fastOpen === true, stampVerifyMs: foldStampVerifyMs })
  // The worker is opt-in and one per process. A worker that cannot start is a reading, not a failed
  // load: the synchronous index keeps answering and the line says the offload did not happen.
  if (foldConfig.worker === true) {
    const worker = startFoldWorker()
    activateFoldWorker(worker)
    if (worker === null) console.error('[dsh-link-collab] fold.worker was requested but a worker could not start; the synchronous index stays in use')
  } else {
    activateFoldWorker(null)
  }
  // `dshHomePath` is a FUNCTION — `dshHomePath(...segments): string` — not a service with a
  // `path` field (packages/util/home-paths/src/index.ts:98-100). The first version of this plugin
  // read `.path` off it, got undefined, and fell through to DSH_HOME... which in the kernel is
  // unset, so the ledger was written to `./collab` relative to the process's working directory,
  // which is the kernel checkout. Nothing appeared to be missing because nothing failed: the log
  // opened, the recorder started, and everything landed in a directory nobody looks at.
  const home = ((): string => {
    const provided = context.get?.('dshHomePath')
    if (typeof provided === 'function') return String((provided as (...segments: string[]) => string)('collab'))
    return join(process.env.DSH_HOME ?? '.', 'collab')
  })()

  const live = new Set<ControlLog>()
  // The plugin's own ledger and its recorder. Without this the recording exists but never
  // starts: the capability would be a recorder nobody called, which is exactly the shape this
  // project keeps finding — present, enabled, and doing nothing.
  let own: ControlLog
  try {
    own = openControlLog({ dir: config.logDir === undefined ? home : join(home, config.logDir), reclaim: config.reclaimLock === true })
  } catch (error) {
    // A ledger this plugin cannot open is a loud failure, not a plugin that vanishes: the announce
    // line the health gate grades is replaced by a line naming the reason, so a refused writer lock
    // reads as a refused writer lock instead of as a plugin that never loaded.
    console.error('[dsh-link-collab] control channel unavailable under ' + home + ': ' + String((error as { message?: unknown })?.message ?? error))
    return
  }
  live.add(own)
  const recorder = recordTeamEvents(context as RecorderContext, own)

  // The relay: one route, one token, no session state. Everything a peer can do here is "apply
  // this batch", which is the same operation a local caller performs, so the endpoint cannot
  // grant a peer more than the log's own rules already allow.
  const requestedToken = typeof config.relay?.token === 'string' ? config.relay.token : ''
  // A token made only of whitespace cannot be presented: the transport strips it, so the route would
  // bind and then refuse every caller forever. That is a misconfiguration, and it is reported as one
  // at load rather than discovered by a peer.
  const relayToken = requestedToken.trim() === '' ? null : requestedToken
  if (relayToken === null && requestedToken !== '') {
    console.error('[dsh-link-collab] relay token is whitespace only; no route bound (a token that cannot be sent is not a token)')
  }
  // R203: the ABSENCE of a relay is a fact a reader has to be able to see. Before this line the ordinary
  // no-token path bound nothing and said nothing, so 'is the relay bound?' could only be answered by a
  // silence - and a silence is not a reading.
  if (relayToken === null && requestedToken === '') {
    console.log('[dsh-link-collab] relay not bound: no relay token configured (set relay.token to accept peer batches)')
  }
  const relayPath = config.relay?.path === undefined ? RELAY_PATH : config.relay.path
  const relayState = { bound: false, path: relayPath, accepted: 0, refused: 0, lastCode: null as string | null }

  // The route the kernel mounts and the route a test mounts are the same handler: this is the shipped
  // factory, so there is no second copy of the authentication rule to drift away from the graded one.
  const endpoint = relayToken === null ? null : createRelayEndpoint({ token: relayToken, log: own, path: relayPath })

  /** Apply one relay request, and count it. */
  const handleRelay = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (endpoint === null) {
      // Without a token nothing is bound, so the route never reaches this; a direct caller gets a
      // 404 rather than a handler that would authenticate against a secret nobody configured.
      res.statusCode = 404
      res.end('no route')
      return
    }
    const outcome = await endpoint.handler(req, res)
    if (outcome.ok) relayState.accepted += 1
    else {
      relayState.refused += 1
      relayState.lastCode = outcome.code ?? 'RELAY_REFUSED'
    }
  }

  if (relayToken !== null) {
    const inject = context.inject
    if (inject === undefined) {
      console.error('[dsh-link-collab] relay configured but this context cannot inject webServer; no route bound')
    } else {
      inject.call(context, ['webServer'], (scoped) => {
        const server = scoped.get?.('webServer') as { register?: (route: { kind: 'exact', path: string, handler: (req: IncomingMessage, res: ServerResponse) => void }) => () => void } | undefined
        if (server?.register === undefined) {
          console.error('[dsh-link-collab] relay configured but the web server offers no register(); no route bound')
          return
        }
        context.effect?.(() => server.register({
          kind: 'exact',
          path: relayPath,
          handler: (req, res) => { void handleRelay(req, res) },
        }))
        relayState.bound = true
        console.log('[dsh-link-collab] relay route bound on ' + relayPath + ' (bearer token required)')
      })
    }
  }
  /**
   * Send this log's own records to a peer's relay route.
   *
   * The sender is a log, not a session: what travels is `ownPage()`, so a peer never receives
   * back the records it relayed here in the first place.
   *
   * @param options - the receiver, the shared token, and where to resume.
   * @returns the receiver's answer.
   */
  const relayTo = async (options: RelayPushOptions): Promise<RelayPushResult> => {
    const identity = options.as ?? { writer: own.writer, instance: own.instance }
    const records = own.ownPage(options.since ?? 0).map((record) => ({
      seq: record.originSeq ?? record.seq,
      kind: record.kind,
      ...(record.actor === undefined ? {} : { actor: record.actor }),
      ...(record.subject === undefined ? {} : { subject: record.subject }),
      ...(record.payload === undefined ? {} : { payload: record.payload }),
      ...(record.at === undefined ? {} : { at: record.at }),
    }))
    const batch: RelayBatch = { writer: identity.writer, instance: identity.instance, records }
    // The wire format is the endpoint's, not a second copy of it: a private fetch here would be a
    // second contract that only this end could change, and the peer would learn about it by failing.
    const push = { token: options.token, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) }
    return endpoint === null
      ? pushBatch(options.url, push.token, batch, push.timeoutMs)
      : endpoint.relayTo(options.url, batch, push)
  }
  // The retry pass: the rule from R62, driven by a timer when — and only when — the row asks for one.
  // The interval is validated here rather than defaulted: a row that says "retry" but names no
  // threshold would otherwise append attempts against a rule nobody chose.
  const retryConfig = config.retry ?? {}
  const retryEnabled = retryConfig.enabled === true
  const retryTeam = retryConfig.team ?? 'team-1'
  const retryLocalEnd = retryConfig.localEnd ?? 'end-A'
  let retryEveryMs: number | null = null
  let retryFactor: number | undefined
  let retryMaxMs: number | undefined
  let retryJitter = 0
  let retryOptions: { team: string, localEnd: string, now: number, timeoutMs: number, maxAttempts: number } | null = null
  if (retryEnabled) {
    const everyMs = Number(retryConfig.everyMs)
    const timeoutMs = Number(retryConfig.timeoutMs)
    const maxAttempts = Number(retryConfig.maxAttempts)
    if (!Number.isInteger(everyMs) || everyMs <= 0) throw new TypeError('dsh-link-collab: retry.everyMs must be a positive integer')
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('dsh-link-collab: retry.timeoutMs must be a positive integer')
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) throw new TypeError('dsh-link-collab: retry.maxAttempts must be a positive integer')
    // The backoff is validated here, where the row's own field names are still visible: a delay nobody
    // chose must not start a timer that then behaves differently from every other row.
    const schedule = retryConfig.schedule
    if (schedule !== undefined && schedule !== null) {
      const factor = Number(schedule.factor)
      const maxMs = Number(schedule.maxMs)
      if (schedule.factor === undefined || !Number.isFinite(factor) || factor <= 1) throw new TypeError('dsh-link-collab: retry.schedule.factor must be finite and greater than 1')
      if (schedule.maxMs === undefined || !Number.isInteger(maxMs) || maxMs < everyMs) throw new TypeError('dsh-link-collab: retry.schedule.maxMs must be a positive integer of at least retry.everyMs')
      retryFactor = factor
      retryMaxMs = maxMs
    }
    const jitter = Number(retryConfig.jitter ?? 0)
    if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) throw new TypeError('dsh-link-collab: retry.jitter must be within [0, 1]')
    retryJitter = jitter
    retryEveryMs = everyMs
    retryOptions = { team: retryTeam, localEnd: retryLocalEnd, now: Date.now(), timeoutMs, maxAttempts }
  }
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  // The idle streak and the delay already scheduled: the first is what the delay is computed from, the
  // second is what a reader (and a gate) can see without waiting for the timer to fire.
  let retryIdle = 0
  let retryNextDelay: number | null = null
  const retryCounts = { runs: 0, written: 0, skipped: 0, failed: 0, ticks: 0, claimed: 0, lost: 0 }
  let retryInFlight = false
  let retryLastError: string | null = null
  let retryLastReason: 'ok' | 'in-flight' | 'disabled' | 'failed' | null = null
  const retryRun = async (): Promise<RetryRun> => {
    if (!retryEnabled || retryOptions === null) { retryLastReason = 'disabled'; return { written: [], blocked: [], reason: 'disabled' } }
    // One pass at a time: two overlapping passes would each plan against the same ledger and both
    // append the attempt they planned, which the fold then refuses as a duplicate — noisy, and the
    // work would look dispatched twice. Skipping is the honest answer for a pass that is late.
    if (retryInFlight) { retryCounts.skipped += 1; retryLastReason = 'in-flight'; return { written: [], blocked: [], reason: 'in-flight' } }
    retryInFlight = true
    try {
      const options = { ...retryOptions, now: Date.now() }
      const plan = redispatchPlan(foldStateOf(own), options)
      const written = await appendRedispatches(foldStateOf(own), own, options)
      retryCounts.runs += 1
      retryCounts.written += written.length
      // Claims this pass wrote are read back from the ledger by sequence, not assumed: what was
      // written is a fact about the log, and so is whether the claim still holds once the re-fold has
      // seen every record — including one that arrived while this pass was writing.
      if (written.length > 0) {
        const after = foldStateOf(own)
        const claimed = after.retryLeases.filter((lease) => written.includes(lease.seq))
        retryCounts.claimed += claimed.length
        for (const root of new Set(claimed.map((lease) => lease.root))) {
          if (!retryOwner(after.retryLeases, { root, localEnd: retryLocalEnd, now: Date.now() }).mine) retryCounts.lost += 1
        }
      }
      // A pass that wrote something made progress; a pass that wrote nothing joins the streak. This is
      // the only place the streak moves, so "how long has this been idle" has one answer.
      retryIdle = written.length > 0 ? 0 : retryIdle + 1
      retryLastError = null
      retryLastReason = 'ok'
      return { written, blocked: plan.blocked, reason: 'ok' }
    } catch (error) {
      // A failing pass must not kill the timer: the next tick is the retry, and a plugin that stops
      // retrying because one append failed is quieter than the problem it hides.
      retryCounts.failed += 1
      // A failure is not progress either: the streak grows, so the next delay backs off as well.
      retryIdle += 1
      retryLastError = String((error as { message?: unknown })?.message ?? error)
      retryLastReason = 'failed'
      return { written: [], blocked: [], reason: 'failed' }
    } finally {
      retryInFlight = false
    }
  }
  // The timer carries a delay the rule computed; it never computes one itself. It belongs to the
  // plugin's own fiber and is cleared by its own teardown, and it is a SELF-CHAINED timeout rather than
  // an interval because the delay changes between passes — an interval would have to be re-armed anyway,
  // and the passes between re-arms would run on a stale delay.
  const currentDelay = (): number => retryDelay({
    everyMs: retryEveryMs as number,
    ...(retryFactor === undefined ? {} : { factor: retryFactor }),
    ...(retryMaxMs === undefined ? {} : { maxMs: retryMaxMs }),
    jitter: retryJitter,
    idle: retryIdle,
  })
  const armRetry = (delayMs: number): void => {
    const timer = setTimeout(() => {
      // Counted before any guard: "the callback fired" and "a pass did something" are two facts, and
      // R65 lost a round to their being one number.
      retryCounts.ticks += 1
      retryTimer = null
      retryNextDelay = null
      // Re-armed after the pass settles, whichever way it settled: the delay is read from the streak the
      // pass just moved, so a run that made progress goes back to the base interval immediately.
      void retryRun().then(() => { armRetry(currentDelay()) }, () => { armRetry(currentDelay()) })
    }, delayMs)
    // A retry timer is not a reason for a process to stay alive. (R65 measured that this is not what
    // stops our timer in a real boot: removing `unref` left the tick series at exactly one.)
    ;(timer as { unref?: () => void }).unref?.()
    retryTimer = timer
    retryNextDelay = delayMs
  }
  if (retryEnabled && retryEveryMs !== null) armRetry(currentDelay())
  // The model-facing declaring tools: this ledger's product-level producer. Registered through the
  // composition's own tool registry when it has one, and reported on the capability either way, so
  // "no tool was offered" has an answer other than silence.
  // The threshold is read here, where the row's own field names are still visible: a value nobody
  // chose must not become a rule the tool applies to somebody's work.
  // R181: the reclaimer ships with the plugin (opt OUT with `reclaim.enabled === false`), which is what
  // this option's JSDoc promises and what the round's two gates pin: `verify-collab-declare` requires the
  // shipped tool face to hold four names, and `verify-collab-reclaim` requires the DEFAULT composition to
  // admit exactly one writer beyond the declaring tools. The first cut read `=== true` here, so the option
  // object never reached installDeclaringTools and both gates were right to call the face three-named.
  const reclaimEnabled = config.reclaim?.enabled !== false
  let reclaimTimeoutMs = RECLAIM_DEFAULT_TTL_MS
  if (config.reclaim?.timeoutMs !== undefined) {
    const requested = Number(config.reclaim.timeoutMs)
    if (!Number.isInteger(requested) || requested <= 0) throw new TypeError('dsh-link-collab: reclaim.timeoutMs must be a positive integer')
    reclaimTimeoutMs = requested
  }
  const toolsState: DeclaringToolsState = { registered: false, names: [], reason: null }
  installDeclaringTools(context, own, toolsState, { reclaim: { enabled: reclaimEnabled, timeoutMs: reclaimTimeoutMs } })
  // R505: the compute backend switch. Default 'ts' adds one boolean test per read and nothing else;
  // 'native-shadow' builds a diagnostics-only shadow that observes reads without answering them.
  // resolveFoldEngine throws on an unknown value, i.e. at load, not on a read.
  const foldEngine = resolveFoldEngine(config)
  const computeShadow = foldEngine.engine === 'native-shadow'
    ? computeShadowFor({ directory: own.directory, getService: () => context.get?.('linkCompute') })
    : null
  // R505/P3: the shadow is process-owned shared state keyed by ledger directory. Release THIS
  // composition's entry when the row unloads, so a hot reload (or a switch back to engine=ts)
  // cannot leave a stale shadow sampling in the background or answer with old diagnostics.
  if (computeShadow !== null) context.effect?.(() => () => disposeComputeShadow(own.directory))
  // The facade's own memory: the code the last call answered with, so a surface can show the last
  // verdict without folding anything itself. A call sets it; nothing else does, and nothing persists.
  let lastBrokerCode: BrokerCode | null = null
  // THE READING THIS PACKAGE PUBLISHES ABOUT ITSELF: the numbers a person can act on - how much
  // ledger there is, how many teams/members/tasks it folds to, whether a peer can reach this end at
  // all - taken from the live log at the instant of the read rather than asserted somewhere. One
  // function builds it, and the route, the capability and the panel's status row all read THAT
  // function, so the three cannot answer differently.
  let statusRouteBound = false
  const statusCounts = { served: 0, refused: 0, lastError: null as string | null }
  const relayReading = (): RelayReading => ({
    bound: relayState.bound,
    path: relayState.path,
    accepted: relayState.accepted,
    refused: relayState.refused,
    lastCode: relayState.lastCode,
  })
  /**
   * How much message flow the ledger holds, and which kernel's writing it came from.
   *
   * The two counts stay apart rather than summed: 'journal' rows come from the Team mailbox only
   * alpha.1 writes (both directions, because it wrote into the Lead's own log), and 'inbox' rows come
   * from the target's inbox splice that alpha.5 writes (this end only). One total would make the two
   * mean the same thing, which is the silent zero this field exists to prevent.
   */
  const readStatus = (): BusStatus => {
    // The status document is a COUNT reading, not a rendering: the live index answers it without
    // materialising a single task row, which is what makes the panel's 2 s poll cheap (R487 hotspot 8).
    const reading = foldReadingOf(own)
    return busStatus({
      at: Date.now(),
      path: STATUS_PATH,
      log: { lastSeq: own.lastSeq, writer: own.writer, instance: own.instance, damage: own.damage },
      records: reading.records,
      teams: reading.teams,
      counts: reading.counts,
      relay: relayReading(),
      messages: reading.messages,
      recorded: recorder.counts,
    })
  }
  // R340/R496: the fold is the one computation that grows with the team. It used to be a cached full
  // fold (recomputed after every append, and paid BEFORE and AFTER every write); the live index below
  // steps only the appended records, so a read after an append costs the suffix plus the materialised
  // rows, and the write path asks the SAME index for its before and after states.
  const teamState = (): TeamState => {
    const state = foldStateOf(own)
    // READ-ONLY: observe() counts and schedules; it never reads, folds, throws or changes the answer.
    computeShadow?.observe(state)
    return state
  }
  const foldOf = (log: ControlLog): TeamState => foldStateOf(log)
  const capability: LinkCollab = {
    open: (options) => {
      const log = openControlLog(options)
      live.add(log)
      return log
    },
    log: own,
    // The live index: the same answer a full fold gives, at the cost of the appended records.
    state: () => teamState(),
    fold: {
      get mode() { return { checkpoint: foldSettings().checkpoint, worker: foldWorkerEnabled, fastOpen: foldSettings().fastOpen } },
      get status() { return foldDiagnostics() },
      state: () => foldStateOf(own),
      reading: () => foldReadingOf(own),
      checkpointNow: () => saveFoldCheckpoint(own),
      loadCheckpoint: () => loadFoldCheckpoint(own).info,
      reset: () => { disposeFoldLog(own) },
    },
    records: (options) => controlPage(own.replay(), { ...options, damage: own.damage }),
    tools: {
      get available() { return toolsState.registered },
      get names() { return [...toolsState.names] },
      get reason() { return toolsState.reason },
    },
    // The rule's own door, open whether or not the tool was asked for. A caller holding this
    // capability reclaims through exactly the function the tool calls: one implementation, so the
    // two cannot refuse differently or write different records.
    reclaim: async (options) => reclaimTask(own, {
      task: options.task,
      ...(options.team === undefined || options.team === null ? {} : { team: options.team }),
      timeoutMs: reclaimTimeoutMs,
      now: options.at ?? Date.now(),
      ...(options.reason === undefined || options.reason === null ? {} : { reason: options.reason }),
    }),
    // R183: our own facade, and the sentence that has to hold with it — not the kernel's service
    // broker, not an RPC provider (TODO.md:70). The two calls read the ledger the caller hands over
    // and nothing else: no file is opened, no clock is read, no socket is touched.
    broker: {
      keys: (state, now, options) => brokerKeys(state, now, options),
      call: (state, key, now, options) => {
        const result = brokerCall(state, key, now, options)
        lastBrokerCode = result.code
        return result
      },
      get lastCode() { return lastBrokerCode },
    },
    relayTo,
    relay: {
      get bound() { return relayState.bound },
      get path() { return relayState.path },
      get accepted() { return relayState.accepted },
      get refused() { return relayState.refused },
      get lastCode() { return relayState.lastCode },
    },
    status: {
      get bound() { return statusRouteBound },
      path: STATUS_PATH,
      get served() { return statusCounts.served },
      get refused() { return statusCounts.refused },
      get lastError() { return statusCounts.lastError },
      read: readStatus,
    },
    // R505: the shadow's fixed diagnostics shape (empty under the default engine).
    computeShadow: {
      get diagnostics() { return computeShadowDiagnostics() },
    },
    recorded: recorder.counts,
    diagnostics: recorder.diagnostics,
    retry: {
      enabled: retryEnabled,
      get timerInstalled() { return retryTimer !== null },
      everyMs: retryEveryMs,
      run: retryRun,
      get counts() { return { ...retryCounts } },
      /** How many passes in a row have written nothing. */
      get idle() { return retryIdle },
      /** The delay already scheduled, or null when nothing is pending. */
      get nextDelayMs() { return retryNextDelay },
      get lastError() { return retryLastError },
      get lastReason() { return retryLastReason },
    },
  }

  if (context.provide !== undefined) context.provide('linkCollab', capability)
  // THE ROUTE THE PANEL'S ROW READS: one GET, no query parameter that selects a mutation, and no
  // writer anywhere on the path, so a person's row and a curl of the same path answer the same
  // document. It is bound BESIDE the relay rather than through it: a relay needs a token and must be
  // absent on an ordinary install, while "how much ledger is there, and can anyone reach me" has to
  // answer there too. A composition with no web server (a headless boot, a probe world) has no page to
  // answer: nothing is bound, and `linkCollab.status.bound` says so instead of a silence.
  const statusHandler = (req: IncomingMessage, res: ServerResponse): void => {
    const answer = (status: number, text: string): void => {
      res.statusCode = status
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(text)
    }
    if (req.method !== undefined && req.method !== 'GET' && req.method !== 'HEAD') {
      statusCounts.refused += 1
      statusCounts.lastError = 'method ' + req.method + ' is not GET'
      answer(405, JSON.stringify({ ok: false, error: { code: 'STATUS_READ_ONLY', message: 'this route answers GET only' } }))
      return
    }
    try {
      // R505: the shadow diagnostics ride the existing read-only status route (no payload content,
      // empty array under the default engine). This is what makes the e2e phase readable over HTTP
      // without a kernel RPC: GET /api/dsh-link-collab/status carries one `computeShadow` field.
      answer(200, JSON.stringify({ ...readStatus(), computeShadow: computeShadowDiagnostics() }))
      statusCounts.served += 1
    } catch (error) {
      // A ledger nothing can fold is a failure of THIS route, not of the bus: the recorder, the tools
      // and the relay keep working, and the row that reads this path shows the named code.
      const message = String((error as { message?: unknown })?.message ?? error)
      statusCounts.refused += 1
      statusCounts.lastError = message
      answer(500, JSON.stringify({ ok: false, error: { code: 'STATUS_UNREADABLE', message } }))
    }
  }
  if (context.inject !== undefined) {
    context.inject.call(context, ['webServer'], (scoped) => {
      const server = scoped.get?.('webServer') as { register?: (route: { kind: 'exact', path: string, handler: (request: IncomingMessage, response: ServerResponse) => void }) => () => void } | undefined
      if (server?.register === undefined) return
      context.effect?.(() => server.register({ kind: 'exact', path: STATUS_PATH, handler: statusHandler }))
      statusRouteBound = true
      console.log('[dsh-link-collab] status route bound on ' + STATUS_PATH)
    })
  }
  // Closing every log this fiber opened is what makes unloading the plugin leave no lock and
  // no open handle behind. The body RETURNS the teardown: `fiber.effect` runs its body
  // immediately (vendor/cordis/src/fiber.ts:404-405,418) and keeps the disposers the body
  // returns, so the previous form — the teardown written AS the body — ran at load. It disposed
  // the recorder and closed the ledger a moment after opening it, which is why the plugin
  // announced itself, published its capability, and recorded nothing for several rounds. Fixing
  // the recorder's own effect was not enough: this second copy of the same mistake kept
  // unsubscribing the listener, and only a kernel boot that indexed the live hook registry
  // showed the plugin's listener missing from it.
  if (context.effect !== undefined) {
    const teardown = (): void => {
      // Off by default; DSH_LINK_COLLAB_TRACE_TEARDOWN names who unloaded this fiber, which is the
      // question R65 could not answer from the ledger alone (a timer that stops looks the same whether
      // the plugin was torn down or the interval simply stopped firing).
      if (process.env.DSH_LINK_COLLAB_TRACE_TEARDOWN !== undefined) {
        console.log('[dsh-link-collab] teardown' + String.fromCharCode(10) + String(new Error('teardown').stack ?? ''))
      }
      // The retry timer stops with the fiber, like every other registration this plugin makes.
      // The pending pass goes with the fiber: `timerInstalled` means "a timer is waiting", so a
      // teardown that left one behind would be a leak a reader could see.
      if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; retryNextDelay = null }
      recorder.dispose()
      // The worker belongs to this fiber: nothing it holds may outlive the plugin row.
      const armedWorker = activeFoldWorker()
      if (armedWorker !== null) {
        activateFoldWorker(null)
        void armedWorker.close()
      }
      // The last checkpoint is written from a fold that already answered, before the ledger closes.
      // A failure here is a reading (the capability's fold.status.lastError), never a failed shutdown.
      if (foldSettings().checkpoint) {
        for (const log of live) {
          try { saveFoldCheckpoint(log) } catch { /* a cache write cannot fail a teardown */ }
        }
      }
      for (const log of live) { disposeFoldLog(log); void log.close() }
      live.clear()
    }
    // DSH_LINK_COLLAB_LEGACY_EFFECT restores the defect this round removed, so the gate that
    // measures the subscription can prove it fails when the subscription dies again.
    context.effect(attackFlag('DSH_LINK_COLLAB_LEGACY_EFFECT') ? teardown : () => teardown)
  }
  // Written to stdout rather than through ctx.logger: the logger the context hands over is a
  // factory whose named logger did not reach either stream in this composition, and a mount
  // announcement that may or may not be emitted is not a mount announcement. Everything else
  // in this repository announces itself the same way, and the health gate grades that line.
  {
    // R434: the subscription is installed UNCONDITIONALLY. It used to require `config.subagentFacts`, the production
    // composition never set it, and the result was measured: not one subagent start reached the ledger, so every team
    // landed as a root (70 roots, empty children) and the pane was global and session-agnostic. The subscription is
    // observe-only and effect-scoped - it cannot outlive this composition - so "off unless configured" bought nothing.
    // `localTeamId` remains an override for a composition that scopes the subscription itself.
    context.effect(() => installSubagentFacts(context, own, { localTeamId: config.subagentFacts?.localTeamId ?? null }))
    console.log('[dsh-link-collab] subagent facts subscribed (parent read from the child session header)')

    // R446: the DURABLE half. `subagent/start` carries no parent (measured: runId/provider/id/local only) and the child
    // session does not exist yet when it fires, so the replayable source is the PARENT session's own
    // `subagent/catalog` event (`packages/subagent/subagent/src/catalog.ts:44` declares it, :134-152 appends it with a
    // childId). Session events are the surface for it: `ctx.on('session/event', (session, event) => ...)`, the same
    // subscription `deliverables/workspace-changes` uses. The appending session IS the parent, so its team id is the
    // parent the ledger has been missing - which is what left every team a root and the pane global.
    context.effect(() => {
      const listener = (session: { id?: unknown } | null | undefined, event: { type?: unknown, data?: unknown } | null | undefined): void => {
        if (event === null || event === undefined || event.type !== 'subagent/catalog') return
        const raw = session !== null && session !== undefined && typeof session.id === 'string' ? session.id : ''
        if (raw === '') return
        // The session id already carries the `session-` prefix (the kernel's SessionId brand is `session-<uuid>`), so
        // the team id is the id itself; prefixing again produced `session-session-...` in the first measured fact.
        const parent = raw.startsWith('session-') ? raw : 'session-' + raw
        void recordSubagentCatalog(own, event.data, parent).then((result) => {
          if (result.appended) {
            console.log('[dsh-link-collab] catalog fact: ' + result.record.subject + ' is a child of ' + parent)
          }
        }).catch((error: unknown) => {
          console.log('[dsh-link-collab] catalog fact rejected: ' + (error instanceof Error ? error.message : String(error)))
        })
      }
      const dispose = context.on('session/event', listener as never)
      console.log('[dsh-link-collab] subagent catalog subscribed (parent = the session that appended it)')
      return typeof dispose === 'function' ? dispose : () => {}
    })
  }
  console.log('[dsh-link-collab] control channel ready under ' + own.directory)
}

export default { name, apply }
// ---------------------------------------------------------------- R95: the official subagent lifecycle, folded

/**
 * The subset of the official \`subagent/start\` payload this mapping reads.
 *
 * The kernel declares the event as \`'subagent/start'(this: Scoped<SubagentRuntime>, info: SubagentRunInfo)\`
 * (\`core/deepseek-harness/packages/subagent/subagent/src/index.ts:164\`) and emits it through the PARENT's scope
 * carrier (\`:214\`, \`src/lifecycle.ts:161\`). That carrier is built by \`scopeTarget\`, whose subject "remains
 * available only through event arguments" (\`packages/core/scope/src/index.ts:170\`) - so the payload names the
 * CHILD (\`id\`) and never the parent. A listener is therefore attributed by the scope it was registered in, which
 * is the kernel's own idiom: a listener owned by an enclosing scope receives every descendant scope's events.
 */
export interface SubagentRunIdentity {
  /** Unique identity shared with the paired terminal event. */
  readonly runId: string
  /** Provider name recorded when the child was first created. */
  readonly provider: string
  /** The child agent's session id. */
  readonly id: string
  /** Whether the run carried a local agent when start fulfilled. */
  readonly local: boolean
}

/** How the observed scope is named, and where an unusable event goes. */
export interface SubagentFactsOptions {
  /** The team the observed scope belongs to; null at a root, exactly as {@link teamRecord} defines it. */
  readonly localTeamId: string | null
  /**
   * Called when an event cannot be read as a fact. The default logs through the context and rethrows, so an
   * unreadable event is a failure in the fiber that fed it - never a line the ledger silently does not get.
   */
  readonly onError?: (error: Error) => void
}

/** The event surface this installer needs; the real context satisfies it, a stub can stand in for a reading. */
export interface SubagentEventSurface {
  readonly on?: (name: string, listener: (info: never) => void) => (() => void) | void
  readonly logger?: { readonly warn?: (message: string) => void }
  /**
   * The kernel's service injection, used to read the CHILD's own session header.
   *
   * A subagent's parent is not in the `subagent/start` payload - the payload names the child only - and the observing
   * scope is the composition root, so a root-level subscription would record every child team with `parent: null`
   * (measured: 70 teams, all roots). The child's session header carries the fact: `session.header.parentSession`
   * (`packages/experimental/agent-team/src/roster.ts:92` reads the same field to derive a teammate's root).
   */
  readonly inject?: (names: string[], work: (scoped: { get?: (name: string) => unknown }) => void) => void
}

/** One folded fact, as it was (or would be) written. */
export interface SubagentFactResult {
  /** Whether this call wrote the fact; false means the ledger already carried it. */
  readonly appended: boolean
  /** "ok" when written, "already-recorded" when the same fact was already there. */
  readonly reason: 'ok' | 'already-recorded'
  /** The record in question, as appended (or as found). */
  readonly record: { readonly kind: string, readonly subject: string, readonly payload: Record<string, unknown> }
  /** Whether the ledger already carried a different parent for this subject when the fact was recorded. */
  readonly contested?: ContestedReading
}

/**
 * Read the child session id out of an official payload.
 *
 * A payload without one cannot name a team. It is refused here, where the cause is still visible, rather than
 * dropped: an event the ledger never hears about and an event that never happened look identical afterwards.
 * @param info - the payload the kernel emitted.
 * @returns the child's session id.
 */
export function readSubagentChild(info: unknown): string {
  const value = info as { id?: unknown } | null | undefined
  const id = value === null || value === undefined || typeof value !== 'object' ? undefined : value.id
  if (typeof id !== 'string' || id === '') {
    throw new TypeError('subagent fact: the event carries no child session id; refusing to record a nameless team instead of skipping it')
  }
  return id
}

/**
 * One official start event as a \`team/state\` fact.
 *
 * The child's session id is the team and the observed scope is its parent, which is the vocabulary
 * {@link projectTeams} already folds: no second record kind and no second parent rule.
 * @param info - the payload the kernel emitted.
 * @param parentTeamId - the observing scope's team id, or null at a root.
 * @returns the record to append.
 */
export function subagentTeamRecord(info: unknown, parentTeamId: string | null): { kind: string, subject: string, payload: Record<string, unknown> } {
  // R434: the team a subagent starts IS led by the session that started it (official: the root session's row carries
  // `role: lead`, agent-team/src/roster.ts:129-136). Recording it means the pane never has to infer a lead by name.
  return teamRecord(readSubagentChild(info), parentTeamId, parentTeamId === null ? undefined : parentTeamId)
}

/** The identity of a fact for idempotence: kind, subject and payload. The ledger's own stamp is not part of it. */
const factKey = (record: { kind?: unknown, subject?: unknown, payload?: unknown }): string =>
  JSON.stringify({ kind: record.kind, subject: record.subject, payload: record.payload })

/** What the ledger already says about one subject's parent when a new fact disagrees with it. */
export interface ContestedReading {
  /** Whether the ledger already carries a parent for this subject that differs from the incoming one. */
  readonly contested: boolean
  /** The parent already on record for this subject (null means "on record as a root"). */
  readonly knownParent: string | null
  /** The parent this call is about to record. */
  readonly incomingParent: string | null
}

/**
 * Read whether the ledger already carries a DIFFERENT parent for this subject.
 *
 * This is a diagnosis, not a decision: the fact is appended either way and the fold's arbitration still decides
 * which parent wins. The point is that "the same subject arrived with two parents" stops being something only a
 * careful reader of the folded tree can notice.
 * @param log - the external control log to look in.
 * @param subject - the team/child the incoming fact is about.
 * @param incomingParent - the parent the incoming fact carries.
 * @returns the reading; \`contested\` is false when the subject is new or agrees with the ledger.
 */
export function contestedParentOf(log: ControlLog, subject: string, incomingParent: string | null): ContestedReading {
  let firstDifferent: string | null = null
  let sawDifferent = false
  for (const existing of log.replay()) {
    if (existing.kind !== TEAM_KIND || existing.subject !== subject) continue
    const payload = existing.payload as { parent?: unknown } | undefined
    const raw = payload === undefined ? undefined : payload.parent
    const knownParent = typeof raw === 'string' ? raw : null
    // A row carrying the SAME parent means this arrival is already on record: re-delivering or replaying an
    // already-recorded fact brings no new arrival, so it cannot be a contention. Without this the alarm fires
    // again on every replay, and a diagnosis that cries wolf on re-delivery is ignored exactly when it is real.
    if (knownParent === incomingParent) return { contested: false, knownParent, incomingParent }
    if (!sawDifferent) { firstDifferent = knownParent; sawDifferent = true }
  }
  // Contention is "EVERY parent already on record disagrees with this arriving one" - and nothing else.
  return { contested: sawDifferent, knownParent: sawDifferent ? firstDifferent : null, incomingParent }
}

/**
 * Append one official start event to the ledger, unless the same fact is already there.
 *
 * Idempotence is about the FACT, not the call: the same event delivered twice - a resumed listener, a replayed
 * batch - must leave the ledger's line count and its fold unchanged.
 * @param log - the external control log to append to.
 * @param info - the payload the kernel emitted.
 * @param parentTeamId - the observing scope's team id, or null at a root.
 * @returns whether this call appended anything.
 */
export async function recordSubagentStart(log: ControlLog, info: unknown, parentTeamId: string | null): Promise<SubagentFactResult> {
  const record = subagentTeamRecord(info, parentTeamId)
  // Read the disagreement BEFORE the fact is written: afterwards this very record would be one of the parents
  // the lookup sees, and a competing arrival would look like agreement with itself.
  const contested = contestedParentOf(log, record.subject, parentTeamId)
  const wanted = factKey(record)
  for (const existing of log.replay()) {
    if (factKey(existing) === wanted) return { appended: false, reason: 'already-recorded', record, contested }
  }
  await log.append(record)
  return { appended: true, reason: 'ok', record, contested }
}

/**
 * The durable half of the same fact: the parent session's own \`subagent/catalog\` event.
 *
 * \`packages/subagent/subagent/src/catalog.ts:37-44\` declares it on \`SessionEventMap\` with the payload
 * \`{ childId, childCreatedAt, version, mode, label? }\` (\`:28-35\`), the parent appends it when a child is
 * established (\`:150\`), and the session layer lists it as a known event type
 * (\`packages/core/session/src/known-event-types.ts:60\`) - so unlike the runtime \`subagent/start\` emission this
 * one is written to the parent's log and folds the same way on every replay. The payload carries no parent: the
 * appending session IS the parent, so its team id is passed in.
 * @param info - the catalog payload the parent session recorded.
 * @param parentTeamId - the appending session's team id, or null at a root.
 * @returns the record to append.
 */
export function subagentCatalogRecord(info: unknown, parentTeamId: string | null): { kind: string, subject: string, payload: Record<string, unknown> } {
  const value = info as { childId?: unknown } | null | undefined
  const childId = value === null || value === undefined || typeof value !== 'object' ? undefined : value.childId
  if (typeof childId !== 'string' || childId === '') {
    throw new TypeError('subagent catalog fact: the event carries no childId; refusing to record a nameless team instead of skipping it')
  }
  return teamRecord(childId, parentTeamId)
}

/**
 * Append one durable catalog event, unless the same fact is already there.
 * @param log - the external control log to append to.
 * @param info - the catalog payload the parent session recorded.
 * @param parentTeamId - the appending session's team id, or null at a root.
 * @returns whether this call appended anything.
 */
export async function recordSubagentCatalog(log: ControlLog, info: unknown, parentTeamId: string | null): Promise<SubagentFactResult> {
  const record = subagentCatalogRecord(info, parentTeamId)
  const contested = contestedParentOf(log, record.subject, parentTeamId)
  const wanted = factKey(record)
  for (const existing of log.replay()) {
    if (factKey(existing) === wanted) return { appended: false, reason: 'already-recorded', record, contested }
  }
  await log.append(record)
  return { appended: true, reason: 'ok', record, contested }
}

/**
 * Fold a durable \`subagent/catalog\` record into the ledger, reading the child id out of the session event.
 *
 * This is the replayable path: a session log replayed twice produces the same facts, and a catalog event whose
 * payload cannot name a child throws instead of being dropped.
 * @param event - the session event as it was logged.
 * @param parentTeamId - the appending session's team id, or null at a root.
 * @returns the record to append.
 */
export function subagentCatalogEventRecord(event: { readonly name?: unknown, readonly data?: unknown }, parentTeamId: string | null): { kind: string, subject: string, payload: Record<string, unknown> } {
  if (event?.name !== 'subagent/catalog') {
    throw new TypeError('subagent catalog fact: expected a subagent/catalog event, received ' + String(JSON.stringify(event?.name)))
  }
  return subagentCatalogRecord(event.data, parentTeamId)
}

/**
 * Subscribe the official lifecycle in the scope this is called in, and fold every start into the ledger.
 *
 * The parent is the SCOPE, not a field: install this inside the observed agent's scope (or at a root with
 * \`localTeamId: null\`) and every \`subagent/start\` that reaches it belongs to that scope's team. The team id is
 * passed in by the composition - never derived from the event - because only the composition knows the world's
 * root.
 * @param ctx - the context whose scope is being observed.
 * @param log - the external control log to append to.
 * @param options - the observing scope's team id and the error sink.
 * @returns the disposer for this subscription.
 */
export function installSubagentFacts(ctx: SubagentEventSurface, log: ControlLog, options: SubagentFactsOptions): () => void {
  if (typeof ctx?.on !== 'function') {
    throw new TypeError('installSubagentFacts: the context exposes no event surface; refusing to install a subscription that would observe nothing')
  }
  const report = options.onError ?? ((error: Error): void => {
    ctx.logger?.warn?.('dsh-link-collab: subagent fact rejected: ' + error.message)
    throw error
  })
  // A warning has to be reachable to be loud. The mount announcement below writes to stdout for the same
  // reason its own comment gives, so the fallback is the same: the logger when this composition has one, stdout
  // otherwise - a contention nobody can see is not a diagnosis.
  const announce = (message: string): void => {
    if (typeof ctx.logger?.warn === 'function') { ctx.logger.warn(message); return }
    console.log('[dsh-link-collab] ' + message)
  }
  /* R434: the parent of a started subagent, taken from the child's own session header when the composition did not
   * name one. Without this every team lands as a root (measured: 70 roots, empty children), which is what made the pane
   * global and session-agnostic. `localTeamId` still wins when a composition does scope the subscription. */
  const parentOfChild = (childId: string): string | null => {
    if (options.localTeamId !== null) return options.localTeamId
    let parent: string | null = null
    /* The session service is the one that owns the header, so it is asked first; `agents` is the fallback for a
     * composition that exposes the agent registry but not sessions. An empty answer stays null, and the ledger records a
     * root - which is the honest reading when nothing can name the parent. */
    const readFrom = (registry: unknown): void => {
      const value = registry as
        | { get?: (id: string) => { session?: { header?: { parentSession?: unknown } }, header?: { parentSession?: unknown } } | undefined }
        | undefined
      const entry = value?.get?.(childId)
      const parentSession = entry?.session?.header?.parentSession ?? entry?.header?.parentSession
      if (typeof parentSession === 'string' && parentSession !== '') parent = parentSession
    }
    try {
      ctx.inject?.(['sessions'], (scoped) => { readFrom(scoped.get?.('sessions')) })
      if (parent === null) ctx.inject?.(['agents'], (scoped) => { readFrom(scoped.get?.('agents')) })
    } catch (error) {
      report(error instanceof Error ? error : new Error(String(error)))
    }
    return parent
  }
  const listener = (info: unknown): void => {
    // R434 debug: what the official start event actually carries, so the parent lookup stops being a guess.
    try {
      const shape = info as Record<string, unknown> | null
      const keys = shape === null || typeof shape !== 'object' ? String(shape) : Object.keys(shape).join(',')
      const probe = shape === null || typeof shape !== 'object' ? '' : ' id=' + String(shape.id) + ' parentSession=' + String((shape as { parentSession?: unknown }).parentSession) + ' sessionId=' + String((shape as { sessionId?: unknown }).sessionId)
      console.log('[dsh-link-collab] subagent/start event keys=' + keys + probe)
    } catch (error) { /* a debug line must never break the fold */ }
    let parentTeamId = options.localTeamId
    try {
      parentTeamId = parentOfChild(readSubagentChild(info))
    } catch (error) {
      report(error instanceof Error ? error : new Error(String(error)))
      return
    }
    void recordSubagentStart(log, info, parentTeamId).then((result) => {
      if (result.contested?.contested !== true) return
      announce('subagent fact: the same subject arrived with two parents - ' + result.record.subject
        + ' is on record under ' + String(JSON.stringify(result.contested.knownParent))
        + ' and arrived under ' + String(JSON.stringify(result.contested.incomingParent))
        + '; both facts are in the ledger and the fold decides which parent holds')
    }).catch((error: unknown) => {
      report(error instanceof Error ? error : new Error(String(error)))
    })
  }
  const dispose = ctx.on('subagent/start', listener as (info: never) => void)
  return typeof dispose === 'function' ? dispose : () => {}
}
