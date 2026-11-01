/**
 * Notes that live outside the process.
 *
 * A note is a fact in an append-only ledger, and the ledger is a file in a directory the caller
 * names. Nothing here keeps a note in memory as the source of truth: the store reads the file back,
 * so a process that restarts — or a second process that opens the same directory — sees every note
 * the first one wrote. That is the whole point of this plugin: persistence outside the life of the
 * thing that wrote it.
 *
 * Two pieces are reused rather than reimplemented. The ledger is the collaboration bus's control log,
 * which already brings writer identity, sequence and origin sequence, a damage report, append-only
 * writes and replay. The rule that decides which of two facts about one note wins is the bus's
 * foldClaim, imported and not copied: a second copy of that rule is how one fold comes to answer
 * open while another answers done for the same note.
 *
 * What the notes feature adds on top of that data face, and the part a reader should hold to: the two
 * thresholds (200 live notes, 100 code points each), refused by name at the tool boundary and in
 * appendNote, and converged deterministically — never refused — when the section renders a ledger an
 * earlier version wrote past either limit; one prompt section named notes:ledger, at order 700, with
 * interpolation off, whose text IS the fold, read fresh at every assembly and stored nowhere else;
 * and the two tools of the notes group, registered on the host layer so that group can mask them.
 * README.md carries the known edges; test/notes-invariants.mjs carries the readings each claim rests
 * on, and the counter-proof that each of them can move.
 *
 * R189 adds the panel's half of that face and nothing else: one read-only route that answers the same
 * fold the prompt section is built from, and one NARROW write route that calls the same function the
 * `notes_add` tool calls. See `writeOneNote` — it is this package's only `appendNote` call site, so the
 * two write paths cannot fork into two sets of rules (R189-contract.md §1). Neither route is a tool:
 * nothing here registers one, so the model has no path to the narrow write, and the notice in README.md
 * says so where a reader will look for it.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { foldClaim, openControlLog } from '../../dsh-link-collab/lib/index.js'
import type { ControlLog, ControlRecord } from '../../dsh-link-collab/lib/index.js'

export const name = 'dsh-link-notes'

/** The tool registry and the prompt assembler this row registers into. */
export const inject = ['tools', 'systemPrompt']

/** The record kind that carries one note fact. */
export const NOTE_KIND = 'note/state'

/** The state a note starts in. */
export const OPEN = 'open'

/** The state that means "this note was deleted" — a tombstone, not an absence. */
export const DELETED = 'deleted'

/**
 * The named refusals. A refusal never writes a byte: the tool boundary and appendNote each throw one
 * of these codes with what was measured, so a caller can tell a refusal it caused from a ledger that
 * is full. Approval and every kernel-side refusal are passed through verbatim — this list has no
 * synonym for what the kernel already says.
 */
export const REFUSALS = Object.freeze({
  /** The arguments are not usable: a missing, empty, unknown or wrongly typed field. */
  INPUT: 'NOTES_INPUT',
  /** One note body is longer than maxChars code points. */
  TOO_LONG: 'NOTES_TOO_LONG',
  /** The ledger already holds maxNotes live notes. */
  FULL: 'NOTES_FULL',
})

/** Live notes the ledger admits before another append is refused. */
export const DEFAULT_MAX_NOTES = 200

/** Code points one note body may have before the append is refused. */
export const DEFAULT_MAX_CHARS = 100

/** The prompt section's name. */
export const SECTION_NAME = 'notes:ledger'

/**
 * Where the section sits in the prompt: after TEAM_POLICY (600) and before PTC_ONLY (800). The
 * kernel's SECTION_ORDERS has no notes slot and the kernel is pinned, so the value is the row's own;
 * section() only asks that it be finite.
 */
export const SECTION_ORDER = 700

/** The read-only tool: report the ledger, write nothing, ask nobody. */
export const LIST_TOOL = 'notes_list'

/** The writing tool: one note, and every call goes to the user for approval first. */
export const ADD_TOOL = 'notes_add'

/**
 * Where the read-only fold is served: the live notes, the tombstone count and the two thresholds.
 *
 * An exported constant, because a route path is a name two halves have to agree on without either of
 * them owning a copy of the other's spelling — the shape plugins/dsh-link-panel/src/index.ts:101 uses
 * for its own `/api/dsh-link-panel/state`.
 */
export const NOTES_ROUTE_PATH = '/api/dsh-link-notes/state'

/**
 * Where ONE note may be appended without an approval prompt.
 *
 * This is the user's path, not the model's (R189-contract.md §1): a person typing in the panel does not
 * ask themselves for permission, but the write has to stay narrow — one note per call, three fixed
 * fields, and the same function and the same named refusals the tool goes through. It is not registered
 * as a tool anywhere, so an agent has no way to reach it.
 */
export const NOTES_ADD_ROUTE_PATH = '/api/dsh-link-notes/add'

/** Who the narrow write says wrote a note whose body names no author. The tool's own default is "agent". */
export const ROUTE_AUTHOR = 'user'

/**
 * The verb refusal both routes answer with.
 *
 * Deliberately not a NOTES_ name: nothing was refused about a note here, the request was refused a verb.
 * The three note refusals stay the whole NOTES_ family.
 */
export const METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED'

/** The two thresholds, resolved. Configurable per row; these are what every layer is given. */
export interface NotesLimits {
  /** Live notes the ledger admits. */
  readonly maxNotes: number
  /** Code points one note body may have. */
  readonly maxChars: number
}

/** One note fact, as the fold used it. */
export interface NoteClaim {
  /** The note body. */
  readonly text: string
  /** The note's tags, sorted and deduplicated. */
  readonly tags: readonly string[]
  /** The state this fact asserted. */
  readonly state: string
  /** Who wrote it. */
  readonly author: string
  /** The instant the record carried, in milliseconds. */
  readonly at: number
  /** Sequence of the record in this ledger. */
  readonly seq: number
  /** The writer that made the record, when it said so. */
  readonly writer: string | null
}

/** One note, as the fold read it. */
export interface ProjectedNote {
  /** The note's id. */
  readonly id: string
  /** The latest body. */
  readonly text: string
  /** The latest tags, sorted and deduplicated. */
  readonly tags: readonly string[]
  /** The latest state. */
  readonly state: string
  /** Who last wrote it. */
  readonly author: string
  /** The instant of the winning fact, in milliseconds. */
  readonly at: number
  /** Sequence of the winning fact. */
  readonly seq: number
  /** Which rule chose the winner: the records' own clocks, or arrival order when they cannot. */
  readonly resolvedBy: 'at' | 'seq'
  /** True when a superseded fact disagreed about the body, the tags, the state or the author. */
  readonly contested: boolean
  /** The facts this one superseded, newest first, minus the first. A folded fact is kept. */
  readonly losers: readonly NoteClaim[]
}

/** Every note the ledger holds. */
export interface NotesState {
  /** One row per note id, including the tombstones, ordered by (at, seq). */
  readonly notes: readonly ProjectedNote[]
  /** Tag to the ids of the notes that carry it and are not deleted, ids ordered by (at, seq). */
  readonly byTag: Readonly<Record<string, readonly string[]>>
  /** How many notes there are, by state, and how many records could not be read. */
  readonly counts: { readonly notes: number, readonly open: number, readonly done: number, readonly deleted: number, readonly malformed: number }
}

/**
 * Build one note fact.
 *
 * The tags are sorted and deduplicated here, so the same set written in a different order is the
 * same bytes on disk — otherwise two spellings of one tag list would look like a contested edit.
 * The instant is not a parameter: the ledger stamps it, which is what makes the fact replayable.
 * @param id - the note this fact is about. Non-empty.
 * @param text - the note body, as written.
 * @param tags - the note's tags.
 * @param state - the state this fact asserts. Not validated: a state this build does not know is
 * stored as written rather than corrected into one it does.
 * @param author - who wrote it. Non-empty.
 * @returns the record to append, without a sequence.
 */
export function noteRecord(id: string, text: string, tags: readonly string[], state: string, author: string): { kind: string, subject: string, payload: { id: string, text: string, tags: string[], state: string, author: string } } {
  if (typeof id !== 'string' || id === '') throw new TypeError('noteRecord: id must be a non-empty string')
  if (typeof text !== 'string') throw new TypeError('noteRecord: text must be a string')
  if (typeof state !== 'string' || state === '') throw new TypeError('noteRecord: state must be a non-empty string')
  if (typeof author !== 'string' || author === '') throw new TypeError('noteRecord: author must be a non-empty string')
  return { kind: NOTE_KIND, subject: id, payload: { id, text, tags: normaliseTags(tags), state, author } }
}

/** Sort and deduplicate tags: one set has one spelling, whatever order it was written in. */
function normaliseTags(tags: readonly string[] | undefined): string[] {
  if (!Array.isArray(tags)) return []
  const usable = tags.filter((tag): tag is string => typeof tag === 'string' && tag !== '')
  return [...new Set(usable)].sort()
}

/** Order notes by their instant, then by sequence, so the table's order is a fact, not an arrival. */
const byAtThenSeq = (left: { at: number, seq: number }, right: { at: number, seq: number }): number => (left.at === right.at ? left.seq - right.seq : left.at - right.at)

/**
 * Fold note facts into the notes they describe.
 *
 * Records are folded in sequence order, so the same batch arranged differently answers the same
 * question. The winner between two facts about one note is decided by the bus's foldClaim — imported,
 * never re-derived.
 * @param records - every record read from the ledger, in any order.
 * @returns the notes, the tag index, and the counts.
 */
export function projectNotes(records: readonly ControlRecord[]): NotesState {
  const notes = new Map<string, ProjectedNote>()
  let malformed = 0
  for (const record of [...records].sort((left, right) => left.seq - right.seq)) {
    if (record.kind !== NOTE_KIND) continue
    const payload = record.payload as { id?: unknown, text?: unknown, tags?: unknown, state?: unknown, author?: unknown } | undefined
    const id = typeof payload?.id === 'string' && payload.id !== '' ? payload.id : (typeof record.subject === 'string' && record.subject !== '' ? record.subject : null)
    // Only a fact whose own fields cannot be read is malformed. It is counted and skipped, and it
    // never throws: one bad line must not cost the reader every note in the ledger.
    if (id === null || typeof payload?.text !== 'string') {
      malformed += 1
      continue
    }
    const at = typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : 0
    const incoming: NoteClaim = {
      text: payload.text,
      tags: normaliseTags(payload?.tags as readonly string[] | undefined),
      state: typeof payload?.state === 'string' && payload.state !== '' ? payload.state : OPEN,
      author: typeof payload?.author === 'string' && payload.author !== '' ? payload.author : '',
      at,
      seq: record.seq,
      writer: record.actor ?? null,
    }
    const previous = notes.get(id)
    if (previous === undefined) {
      notes.set(id, { id, text: incoming.text, tags: incoming.tags, state: incoming.state, author: incoming.author, at: incoming.at, seq: incoming.seq, resolvedBy: 'seq', contested: false, losers: [] })
      continue
    }
    const folded = foldClaim({ at: previous.at, seq: previous.seq }, { at: incoming.at, seq: incoming.seq })
    const winner = folded.incomingWins ? incoming : { text: previous.text, tags: previous.tags, state: previous.state, author: previous.author, at: previous.at, seq: previous.seq, writer: null }
    const loser = folded.incomingWins ? { text: previous.text, tags: previous.tags, state: previous.state, author: previous.author, at: previous.at, seq: previous.seq, writer: null } : incoming
    const disagrees = loser.text !== winner.text || loser.state !== winner.state || loser.author !== winner.author || loser.tags.join('\u0000') !== winner.tags.join('\u0000')
    notes.set(id, {
      id,
      text: winner.text,
      tags: winner.tags,
      state: winner.state,
      author: winner.author,
      at: winner.at,
      seq: winner.seq,
      resolvedBy: folded.byAt ? 'at' : 'seq',
      contested: previous.contested || disagrees,
      losers: disagrees ? [loser, ...previous.losers] : previous.losers,
    })
  }
  const ordered = [...notes.values()].sort(byAtThenSeq)
  const byTag: Record<string, string[]> = {}
  for (const note of ordered) {
    if (note.state === DELETED) continue
    for (const tag of note.tags) (byTag[tag] ??= []).push(note.id)
  }
  return {
    notes: ordered,
    byTag,
    counts: {
      notes: ordered.length,
      open: ordered.filter((note) => note.state === OPEN).length,
      done: ordered.filter((note) => note.state !== OPEN && note.state !== DELETED).length,
      deleted: ordered.filter((note) => note.state === DELETED).length,
      malformed,
    },
  }
}

/**
 * The notes still to do something about: the ones in the open state.
 * @param state - a folded state.
 * @returns the open notes, ordered by (at, seq).
 */
export function openNotes(state: NotesState): readonly ProjectedNote[] {
  return state.notes.filter((note) => note.state === OPEN)
}

/**
 * The notes carrying one tag that are not deleted.
 * @param state - a folded state.
 * @param tag - the tag to match, exactly (tags are not searched case-insensitively).
 * @returns the matching notes, ordered by (at, seq).
 */
export function notesWithTag(state: NotesState, tag: string): readonly ProjectedNote[] {
  const ids = new Set(state.byTag[tag] ?? [])
  return state.notes.filter((note) => ids.has(note.id))
}

/**
 * The notes whose body contains one piece of text, ignoring case.
 *
 * The empty string is not an error and not "nothing": it matches every note that is not deleted, which
 * is what a search box with nothing typed in shows.
 * @param state - a folded state.
 * @param text - the piece of text to look for; case is ignored on both sides.
 * @returns the matching notes, ordered by (at, seq).
 */
export function searchNotes(state: NotesState, text: string): readonly ProjectedNote[] {
  const needle = typeof text === 'string' ? text.toLowerCase() : ''
  return state.notes.filter((note) => note.state !== DELETED && note.text.toLowerCase().includes(needle))
}

/**
 * The live notes of a folded state, in ledger order: every note that is not a tombstone.
 *
 * One definition for three layers. The tool boundary asks whether there is room for one more, the
 * section renders the newest of them, and both are counting the same set. The queries in this module
 * already answer with this set (searchNotes with an empty needle), so a note excluded here is exactly
 * a note the reader cannot see either.
 * @param state - a folded state.
 * @returns the notes that are not deleted, ordered by (at, seq).
 */
export function liveNotes(state: NotesState): readonly ProjectedNote[] {
  const rows = Array.isArray(state?.notes) ? state.notes : []
  return rows.filter((note) => note !== null && typeof note === 'object' && note.state !== DELETED)
}

/** The heading the rendered section starts with. */
const SECTION_HEADING = 'Notes ledger — live notes, oldest first:'

/** The line that says, inside the rendered text, how many older notes were left out. */
const elidedLine = (count: number): string => '… (+' + String(count) + ' older note(s) elided)'

/** One rendered row: the body cut to the limit, and whatever the caller asks to append to it. */
const rowText = (note: ProjectedNote, maxChars: number, suffix: string): string => clipCodePoints(typeof note.text === 'string' ? note.text : '', maxChars) + suffix

/** A limit counts as given when it is a positive integer; anything else falls back to the default. */
function limitOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

/**
 * Cut a note body to at most maxChars code points, the last of them an ellipsis when it was cut.
 *
 * Code points, not UTF-16 units: cutting a surrogate pair in half would replace one character with
 * two replacement characters, and the result would stop being the length a caller was promised.
 * @param text - the body as the fold read it.
 * @param maxChars - the most code points the result may have; at least 1.
 * @returns the body unchanged, or its first maxChars - 1 code points followed by an ellipsis.
 */
function clipCodePoints(text: string, maxChars: number): string {
  const points = Array.from(text)
  if (points.length <= maxChars) return text
  return points.slice(0, maxChars - 1).join('') + '…'
}

/**
 * Render the ledger as the prompt section's text: the newest live notes, and what was left out.
 *
 * This is the third layer of the thresholds, and it is the one that never refuses. A ledger an older
 * version wrote past either limit still renders, deterministically and completely: the newest maxNotes
 * live notes are shown, a line states how many older ones were elided, and a body longer than maxChars
 * is cut at exactly maxChars code points with an ellipsis in the last one. Nothing here throws — not
 * on a body the fold could not read, not on a limit that is not a positive integer — because the
 * caller of this function is a prompt assembly, and a prompt that cannot be assembled is a session
 * that cannot run. The same facts in any arrival order fold to the same bytes, so this render is
 * byte-identical for them.
 * @param state - a folded state, from projectNotes over the ledger's own records.
 * @param limits - the two thresholds; unusable values fall back to the defaults.
 * @returns the section text, or the empty string when the ledger holds no live note.
 */
export function renderNotesSection(state: NotesState, limits: NotesLimits): string {
  const maxNotes = limitOr(limits?.maxNotes, DEFAULT_MAX_NOTES)
  const maxChars = limitOr(limits?.maxChars, DEFAULT_MAX_CHARS)
  const live = liveNotes(state)
  if (live.length === 0) return ''
  const elided = live.length - Math.min(live.length, maxNotes)
  const lines = [SECTION_HEADING]
  if (elided > 0) lines.push(elidedLine(elided))
  for (const note of live.slice(elided)) lines.push('- ' + rowText(note, maxChars, ''))
  return lines.join('\n')
}

/**
 * Render the whole ledger for the read-only tool: every live note, with what the section leaves out.
 *
 * The section is a budgeted projection and drops ids, authors and tags; this is the on-demand read
 * that carries them, which is why it may be longer than the section and why it is never truncated.
 * @param state - a folded state.
 * @returns one heading line and one line per live note.
 */
export function renderNotesDirectory(state: NotesState): string {
  const live = liveNotes(state)
  const counts = state?.counts as { deleted?: unknown, malformed?: unknown } | undefined
  const deleted = typeof counts?.deleted === 'number' ? counts.deleted : 0
  const malformed = typeof counts?.malformed === 'number' ? counts.malformed : 0
  const head = 'Notes ledger: ' + String(live.length) + ' live note(s), ' + String(deleted) + ' deleted'
    + (malformed > 0 ? ', ' + String(malformed) + ' unreadable record(s)' : '') + '.'
  const rows = live.map((note) => {
    const by = typeof note.author === 'string' && note.author !== '' ? ' — by ' + note.author : ''
    const tags = Array.isArray(note.tags) && note.tags.length > 0 ? ' — tags: ' + note.tags.join(', ') : ''
    return '- ' + String(note.id) + ' [' + String(note.state) + '] ' + rowText(note, Number.MAX_SAFE_INTEGER, by + tags)
  })
  return [head, ...rows].join('\n')
}

/** One notes directory, open for appends and reads. */
export interface NotesStore {
  /** The directory the caller named. The ledger lives in a subdirectory of it. */
  readonly dir: string
  /** The append-only ledger behind this store. Exposed so a caller can close it hard or inspect damage. */
  readonly log: ControlLog
  /**
   * Flush pending writes, release the writer lock and close.
   *
   * **Await it.** Releasing the lock is not synchronous: the pending appends drain, the stream is
   * closed and the lock file is removed. Opening the same directory again before that finishes is a
   * race the caller can lose, so the promise is handed back rather than swallowed.
   */
  close(): Promise<void>
}

/**
 * Open the note ledger in one directory.
 *
 * The ledger is a file in its own subdirectory, so a caller's directory may hold other things beside
 * it. Opening the same directory again reads every note back: the file is the source of truth, so a
 * process that died does not take the notes with it.
 * @param dir - the directory to keep the ledger in. Created when absent.
 * @param options - the writer name this ledger's records carry.
 * @returns the open store.
 */
export function openNotesStore(dir: string, options?: { writer?: string }): NotesStore {
  if (typeof dir !== 'string' || dir === '') throw new TypeError('openNotesStore: dir must be a non-empty string')
  const log = openControlLog({ dir: join(dir, 'notes'), writer: options?.writer ?? 'notes' })
  return { dir, log, close: () => log.close() }
}

/** The notes a store currently holds, read fresh from its ledger. */
function readStore(store: NotesStore): NotesState {
  return projectNotes(store.log.replay())
}

/**
 * Append one note.
 *
 * A new id is minted from a random uuid, never from how many notes there are: a counter read back
 * from the count collides the moment two writers append at once, and after a restart it can collide
 * with an id an earlier process already handed out. An id the caller supplies is used as written —
 * appending to an existing id is a new fact about that note, which the fold then decides.
 *
 * This is the second layer of the thresholds, and it refuses by name rather than truncating: the
 * ledger is append-only, so a body accepted here is on disk forever, and a note dropped to make room
 * would be a silent loss the caller could not see. Both refusals say what was measured, and neither
 * of them writes.
 * @param store - the open store.
 * @param input - the body, the tags, the author, and optionally the id.
 * @param limits - the two thresholds. Unusable values fall back to the defaults, so a caller that
 * never sets them gets 200 live notes of 100 code points.
 * @returns the id and the sequence the fact was given.
 * @throws TypeError when the input is unusable, Error with REFUSALS.TOO_LONG or REFUSALS.FULL when a
 * threshold refuses it. Either way nothing is appended.
 */
export async function appendNote(store: NotesStore, input: { text: string, tags?: readonly string[], author: string, id?: string }, limits?: NotesLimits): Promise<{ id: string, seq: number }> {
  if (typeof input?.text !== 'string') throw new TypeError('appendNote: text must be a string')
  if (typeof input?.author !== 'string' || input.author === '') throw new TypeError('appendNote: author must be a non-empty string')
  const maxNotes = limitOr(limits?.maxNotes, DEFAULT_MAX_NOTES)
  const maxChars = limitOr(limits?.maxChars, DEFAULT_MAX_CHARS)
  const length = Array.from(input.text).length
  if (length > maxChars) {
    throw new Error(REFUSALS.TOO_LONG + ': a note body may have at most ' + String(maxChars) + ' characters and this one has ' + String(length) + '; shorten it and append again')
  }
  const held = liveNotes(readStore(store)).length
  if (held >= maxNotes) {
    throw new Error(REFUSALS.FULL + ': this ledger already holds ' + String(held) + ' live note(s) and the limit is ' + String(maxNotes) + '; nothing was appended')
  }
  const id = input.id === undefined ? 'n-' + randomUUID() : input.id
  const seq = await store.log.append(noteRecord(id, input.text, input.tags ?? [], OPEN, input.author))
  return { id, seq }
}

/**
 * Write a new state for one note, as a new fact.
 *
 * The body, the tags and the author are carried over from the note as it stands, so a state change
 * never erases what the note said. Nothing is rewritten: the fact is appended, and the old bytes stay
 * exactly where they are.
 * @param store - the open store.
 * @param id - the note to change.
 * @param state - the state to assert. Stored as written, whatever it is.
 * @returns the sequence the fact was given.
 */
export async function setNoteState(store: NotesStore, id: string, state: string): Promise<{ seq: number }> {
  const note = readStore(store).notes.find((row) => row.id === id)
  if (note === undefined) throw new Error('setNoteState: no note ' + JSON.stringify(id) + ' in this store')
  const seq = await store.log.append(noteRecord(id, note.text, [...note.tags], state, note.author))
  return { seq }
}

/** The notes a store currently holds, for a caller that wants the fold without reaching for the log. */
export function notesOf(store: NotesStore): NotesState {
  return readStore(store)
}

/** One text content block: what both tools hand the model. */
const textBlocks = (text: string): { type: 'text', text: string }[] => [{ type: 'text', text }]

/** The output declaration both tools share: the model sees the rendered text. */
const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: unknown): { type: 'text', text: string }[] => textBlocks(typeof value === 'string' ? value : JSON.stringify(value)),
}

/** The tool names this package registers, in registration order. */
const TOOL_NAMES: readonly string[] = [LIST_TOOL, ADD_TOOL]

/**
 * Refuse an argument object that carries a field the call does not take.
 *
 * The parameter root is an open object, so an unknown field would otherwise be dropped in silence —
 * and a caller that asked for something this tool does not do should hear that it cannot.
 * @param tool - the tool's name, for the message.
 * @param args - the arguments the executor validated.
 * @param allowed - the fields this tool takes.
 */
function refuseUnknownArguments(tool: string, args: unknown, allowed: readonly string[]): void {
  if (args === null || typeof args !== 'object') return
  for (const key of Object.keys(args)) {
    if (allowed.includes(key)) continue
    throw new Error(REFUSALS.INPUT + ': ' + tool + ' takes ' + (allowed.length === 0 ? 'no arguments' : allowed.join(', ')) + ', and "' + key + '" is not one of them')
  }
}

/**
 * The read-only tool.
 * @param store - the open store.
 * @returns the registry-ready definition.
 */
function listTool(store: NotesStore): ReturnType<typeof defineTool> {
  return defineTool({
    name: LIST_TOOL,
    description: 'List the notes in the shared ledger: for every note that is not deleted, its id, its state, its body, who wrote it and its tags. Read-only — it changes nothing, asks nobody, and takes no arguments.',
    parameters: {},
    output: TEXT_OUTPUT,
    execute: (args) => {
      refuseUnknownArguments(LIST_TOOL, args, [])
      return renderNotesDirectory(notesOf(store))
    },
  })
}

/** The fields a write may carry, in the order a reader should read them. One list, both writers. */
const WRITE_FIELDS: readonly string[] = Object.freeze(['text', 'tags', 'author'])

/** The author the model's tool writes when its call names none. The narrow route's own default is "user". */
const AGENT_AUTHOR = 'agent'

/** What one write produced, and the fold it was read from. */
interface NoteWrite {
  /** The id the ledger minted (or the one the caller named). */
  readonly id: string
  /** The sequence the fact was given. */
  readonly seq: number
  /** The author of the fact, resolved: the caller's, or the default its path supplies. */
  readonly author: string
  /** How many live notes the fold holds now. */
  readonly live: number
  /** That fold, so a caller can render what the write cost without reading the ledger again. */
  readonly state: NotesState
}

/**
 * The one write path: check one narrow call, then append exactly one note.
 *
 * THIS is the package's only `appendNote` call site. The `notes_add` tool and the narrow route
 * `POST /api/dsh-link-notes/add` both call this function and nothing else, so the three named refusals
 * and the two thresholds cannot fork into a second set of rules: a route that re-implemented the
 * boundary test is exactly how "a body may have at most maxChars code points" becomes true of one writer
 * and false of another, which is what R189-contract.md §1 rules out.
 *
 * What a caller may vary is only its own name in a refusal message and the author a body that names none
 * gets: "agent" for the model's tool, "user" for the panel. Everything else — which fields are allowed,
 * what counts as usable text and usable tags, where the two thresholds are read from, which function
 * appends — is this one function.
 *
 * The thresholds are not re-read here either: `limits` is the row's resolved object, the one the
 * section renders with and `appendNote` refuses with, handed in rather than looked up.
 * @param store - the open store.
 * @param raw - the arguments as the caller received them; any shape at all, refused by name when unusable.
 * @param caller - who is writing: the name a refusal carries, and the default author.
 * @param limits - the two thresholds.
 * @returns the id, the sequence, the author, the live count and the fold they were read from.
 * @throws Error carrying REFUSALS.INPUT, REFUSALS.TOO_LONG or REFUSALS.FULL. Nothing is appended then.
 */
async function writeOneNote(store: NotesStore, raw: unknown, caller: { who: string, author: string }, limits: NotesLimits): Promise<NoteWrite> {
  refuseUnknownArguments(caller.who, raw, WRITE_FIELDS)
  const args = (raw ?? null) as { text?: unknown, tags?: unknown, author?: unknown } | null
  const text = args === null ? undefined : args.text
  if (typeof text !== 'string' || text === '') {
    throw new Error(REFUSALS.INPUT + ': ' + caller.who + ' needs text: a non-empty string')
  }
  const tags = args.tags
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string'))) {
    throw new Error(REFUSALS.INPUT + ': tags must be an array of strings when given')
  }
  const author = typeof args.author === 'string' && args.author !== '' ? args.author : caller.author
  const appended = await appendNote(store, { text, tags: tags as readonly string[] | undefined, author }, limits)
  const state = notesOf(store)
  return { id: appended.id, seq: appended.seq, author, live: liveNotes(state).length, state }
}

/**
 * The writing tool.
 *
 * The approval question is not here: this body runs only after tools/pre-execute has been answered,
 * and without an approval channel nothing reaches it. What this body owns is the first layer of the
 * thresholds — an unusable body is refused by name before appendNote is called, and the two threshold
 * refusals are appendNote's own, carrying the codes a model can read and rewrite around.
 * @param store - the open store.
 * @param limits - the two thresholds this row resolved.
 * @returns the registry-ready definition.
 */
function addTool(store: NotesStore, limits: NotesLimits): ReturnType<typeof defineTool> {
  return defineTool({
    name: ADD_TOOL,
    description: 'Add one note to the shared ledger, so that it is on disk and in the system prompt from the next step onward. Every call is put to the user for approval first, and a call that cannot be asked is refused and writes nothing. A note body may have at most '
      + String(limits.maxChars) + ' characters, and the ledger admits at most ' + String(limits.maxNotes) + ' live notes.',
    parameters: {
      text: { type: 'string', required: true, description: 'The note body: what to remember. At most ' + String(limits.maxChars) + ' characters.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags. Stored sorted and deduplicated, so one set has one spelling.' },
      author: { type: 'string', description: 'Who is adding the note. Defaults to "agent".' },
    },
    output: TEXT_OUTPUT,
    execute: async (args) => {
      // One call into the package's only write path; a refusal thrown there is the model's to read.
      const written = await writeOneNote(store, args, { who: ADD_TOOL, author: AGENT_AUTHOR }, limits)
      // The cost is stated rather than left to the reader: this append changed the section, and a
      // changed section is one rewritten prompt head on the next request (README, "What it costs").
      return 'added note ' + written.id + ' (seq ' + String(written.seq) + ', author ' + written.author + '). The ledger holds '
        + String(written.live) + ' live note(s); the ' + SECTION_NAME + ' section is now '
        + String(renderNotesSection(written.state, limits).length) + ' character(s), so the next request carries it and the prompt head is written once.'
    },
  })
}

/** A system-prompt service, as much of it as this row calls. */
interface NotesPromptService {
  /** Register one ordered section in the calling scope. */
  section(section: { readonly name: string, readonly order: number, readonly interpolate: boolean, readonly text: () => string }): () => void
}

/** A tool registry, as much of it as this row calls. */
interface NotesToolRegistry {
  /** Register one definition; the returned disposer unregisters it. */
  register(definition: unknown): () => void
}

/** One pre-execution decision, as much of it as this row reads. */
interface NotesToolExecution {
  /** The tool the model asked for. */
  readonly name: string
}

/** The injected scope the tools service resolves in. */
interface NotesServiceScope {
  /** Read one service by name. */
  get?: (name: string) => unknown
}

/** The injection seam this row registers through. */
interface NotesServiceInjection {
  /** Run one callback with a scope in which these services resolve. */
  call(target: Context, names: readonly string[], callback: (scoped: NotesServiceScope) => void): unknown
}

/**
 * Register the tools on this row's own layer.
 *
 * They go through the inject.call(ctx, ['tools'], …) form for the reason the collaboration bus states
 * where it does the same thing: this row is a host-plane row, so the registration lands on the host
 * layer, and only a registration on an ancestor layer is one the notes group can take away again. A
 * member registered on an agent's own layer cannot be masked, and the group refuses the whole group
 * rather than half-close it (plugins/dsh-link-groups/cordis.patch.yml:5-8).
 * @param ctx - the cordis context this row was applied to.
 * @param store - the open store the tools read and append to.
 * @param limits - the two thresholds this row resolved.
 */
function installTools(ctx: Context, store: NotesStore, limits: NotesLimits): void {
  const inject = (ctx as { inject?: NotesServiceInjection }).inject
  if (inject === undefined) {
    console.error('[link-notes] this context cannot inject the tools service, so ' + TOOL_NAMES.join(' and ') + ' are not registered')
    return
  }
  inject.call(ctx, ['tools'], (scoped) => {
    const registry = scoped.get?.('tools') as NotesToolRegistry | undefined
    if (registry === undefined || typeof registry.register !== 'function') {
      console.error('[link-notes] this composition mounts no tool registry, so ' + TOOL_NAMES.join(' and ') + ' are not registered')
      return
    }
    for (const definition of [listTool(store), addTool(store, limits)]) {
      const dispose = registry.register(definition)
      // The registration is an effect of this plugin's fiber: unloading the row unregisters the tool,
      // so a disposed plugin cannot leave one pointing at a ledger it has closed.
      ctx.effect(() => dispose)
    }
  })
  // Every notes_add asks; notes_list never does. The decision carries no reason of its own so that
  // every refusal the model reads is the kernel's own sentence (no approval channel, no agent,
  // rejected, cancelled) instead of a synonym written here.
  ctx.on('tools/pre-execute', (exec: NotesToolExecution, next: () => unknown) => {
    if (exec.name !== ADD_TOOL) return next()
    return { kind: 'ask' }
  })
}

/** Row configuration. */
export interface NotesConfig {
  /** Ledger directory. Empty means the DSH home's own notes directory. */
  dir: string
  /** Live notes the ledger admits, when the row sets it. Defaults to DEFAULT_MAX_NOTES when absent. */
  maxNotes?: number
  /** Code points one note body may have, when the row sets it. Defaults to DEFAULT_MAX_CHARS when absent. */
  maxChars?: number
}

/** Validated row configuration. The directory is deployment-varying, so it is a field, not a constant. */
export const Config: z<NotesConfig> = z.object({
  dir: z.string().default(''),
  maxNotes: z.number().default(DEFAULT_MAX_NOTES),
  maxChars: z.number().default(DEFAULT_MAX_CHARS),
})

/**
 * The directory this row keeps its ledger in, derived the way the collaboration bus derives its own.
 *
 * dshHomePath is the kernel's home resolver FUNCTION (not a service with a path field), and the kernel
 * does not export DSH_HOME to plugins; the environment fallback exists only for a host that provides
 * neither, and it is the same fallback the bus uses.
 * @param ctx - the context this row is applied to.
 * @returns the absolute ledger directory for this home.
 */
function ledgerDir(ctx: Context): string {
  const provided = (ctx as { get?: (name: string) => unknown }).get?.('dshHomePath')
  if (typeof provided === 'function') return String((provided as (...segments: string[]) => string)('link-notes'))
  return join(process.env.DSH_HOME ?? '.', 'link-notes')
}

/**
 * One configured threshold, or the default when the row left it out.
 *
 * A value the row did set has to be a positive integer: a limit of zero or of minus one is not a
 * smaller limit, it is a row that can admit nothing, and a fraction is not a code point count. The
 * row fails at load with the field named rather than refusing every append later on.
 * @param value - the configured value, when there is one.
 * @param fallback - the value to use when there is not.
 * @param field - the configuration field, for the message.
 * @returns the resolved threshold.
 */
function configuredLimit(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TypeError('dsh-link-notes: ' + field + ' must be a positive integer when set (got ' + JSON.stringify(value) + ')')
  }
  return value
}

/* ------------------------------------------------------------------------------------------------
 * The panel's two routes.
 *
 * The shape is the one plugins/dsh-link-panel/src/index.ts landed in R188, which follows the teams row:
 * :101 the route path as an exported constant, :397-403 sendJson, :452-475 the GET/HEAD-only handler with
 * its named 405, :483-514 the lazy webServer binding and its retry. What is NOT copied is that route
 * reading a clock: this row's GET answers the fold and nothing else, so two calls over an unchanged
 * ledger are byte-identical, and "GET changed no ledger byte" is a statement about the only thing this
 * handler can do at all.
 * ---------------------------------------------------------------------------------------------- */

/** The most request body the write route will keep. One note is maxChars code points; this is a ceiling. */
const MAX_BODY_BYTES = 64 * 1024

/** One JSON answer, no-store: this surface is a reading of the ledger, never something to cache. */
function sendJson(res: any, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

/** The named answer for a verb a route does not take. The verb it does take goes in the Allow header. */
function methodNotAllowed(req: any, res: any, noun: string, allowed: string): void {
  // A refused body is still a body: drain it, or the socket can be torn down with it half-read and the
  // caller reads that as this server failing rather than as its own verb being refused.
  if (typeof req.resume === 'function') req.resume()
  res.setHeader('allow', allowed)
  sendJson(res, 405, {
    ok: false,
    error: {
      code: METHOD_NOT_ALLOWED,
      message: noun + ' takes ' + allowed + ' and nothing else, so ' + String(req.method) + ' was refused',
    },
  })
}

/** Read one request body, or the reason it cannot be read. Nothing past MAX_BODY_BYTES is kept. */
function readBody(req: any): Promise<{ text: string } | { problem: string }> {
  return new Promise((done) => {
    const chunks: Buffer[] = []
    let size = 0
    let overflow = false
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        overflow = true
        return
      }
      chunks.push(chunk)
    })
    req.on('error', (error: unknown) => {
      done({ problem: 'the request body could not be read (' + (error instanceof Error ? error.message : String(error)) + ')' })
    })
    req.on('end', () => {
      if (overflow) done({ problem: 'the request body is larger than ' + String(MAX_BODY_BYTES) + ' bytes' })
      else done({ text: Buffer.concat(chunks).toString('utf8') })
    })
  })
}

/** The three named refusals, in the order a message may carry them. */
const NAMED_REFUSALS: readonly string[] = Object.freeze([REFUSALS.INPUT, REFUSALS.TOO_LONG, REFUSALS.FULL])

/** The HTTP status each named refusal answers with. A fifth case is never given a fourth name. */
const REFUSAL_STATUS: Readonly<Record<string, number>> = Object.freeze({
  [REFUSALS.INPUT]: 400,
  [REFUSALS.TOO_LONG]: 400,
  [REFUSALS.FULL]: 409,
})

/**
 * What a refused write answers with: the code, its status, and the sentence the writer already had.
 *
 * The message is the original text and not a rewrite: this route is a second DOOR to one rule, and a
 * paraphrase would be the second name for one fact this package keeps refusing to add. An error that is
 * not one of the three names is not given one — it keeps its own text, `code: null` and status 500,
 * which says "this build failed" instead of pretending the caller's note was refused.
 * @param error - whatever the write threw.
 * @returns the status and body to send.
 */
function refusalAnswer(error: unknown): { status: number, body: unknown } {
  const message = error instanceof Error ? error.message : String(error)
  const code = NAMED_REFUSALS.find((name) => message.startsWith(name + ':')) ?? null
  return {
    status: code === null ? 500 : (REFUSAL_STATUS[code] ?? 500),
    body: { ok: false, error: { code, message } },
  }
}

/**
 * Bind the two routes on the row's own store, if this composition has a web server at all.
 *
 * The store and the thresholds are the row's own objects, so both answers are readings of the ledger the
 * tools write to and of the limits the tools are held to — there is no second store and no second copy of
 * a threshold. `apply()` can run before the web application mounts, exactly like the panel row, so the
 * registration is attempted now and again when `webServer` appears, and the whole thing is disposed with
 * the row through `ctx.effect`.
 * @param ctx - the cordis context this row was applied to.
 * @param store - the row's open store.
 * @param limits - the row's resolved thresholds.
 */
function installRoutes(ctx: Context, store: NotesStore, limits: NotesLimits): void {
  const disposers: Array<() => void> = []
  let bound = false

  /** The read-only answer: the fold, the two thresholds, and the word that says nothing here writes. */
  function stateBody(): unknown {
    const state = notesOf(store)
    const live = liveNotes(state)
    return {
      ok: true,
      path: NOTES_ROUTE_PATH,
      readOnly: true,
      // The row's own resolved thresholds, handed in: the same object appendNote refuses with and the
      // section renders with, so no reader can see a limit no writer is held to.
      limits: { maxNotes: limits.maxNotes, maxChars: limits.maxChars },
      // The fold's own counts. "live" is the number the write route answers with, so one question has
      // one number in both answers.
      counts: {
        live: live.length,
        deleted: state.counts.deleted,
        notes: state.counts.notes,
        open: state.counts.open,
        done: state.counts.done,
        malformed: state.counts.malformed,
      },
      // The live notes in ledger order. A tombstone is counted above and not listed here: it is a note
      // that was deleted, not a note, and the panel draws what is listed.
      notes: live.map((note) => ({ id: note.id, text: note.text, tags: [...note.tags], state: note.state, author: note.author, at: note.at, seq: note.seq })),
    }
  }

  async function stateHandler(req: any, res: any): Promise<void> {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        methodNotAllowed(req, res, 'dsh-link-notes state', 'GET')
        return
      }
      // A read, and only a read: the fold is built from the ledger and nothing is written back, not even
      // a counter of how many times this was asked.
      sendJson(res, 200, stateBody())
    } catch (error) {
      // A fold that cannot be read is not an empty ledger, and it must not be answered as one.
      sendJson(res, 500, {
        ok: false,
        error: { code: 'SNAPSHOT_FAILED', message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  async function addHandler(req: any, res: any): Promise<void> {
    if (req.method !== 'POST') {
      methodNotAllowed(req, res, 'dsh-link-notes add', 'POST')
      return
    }
    const body = await readBody(req)
    if ('problem' in body) {
      const answer = refusalAnswer(new Error(REFUSALS.INPUT + ': ' + body.problem))
      sendJson(res, answer.status, answer.body)
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body.text)
    } catch (error) {
      const answer = refusalAnswer(new Error(REFUSALS.INPUT + ': the request body is not JSON ('
        + (error instanceof Error ? error.message : String(error)) + '); send {"text": "..."}'))
      sendJson(res, answer.status, answer.body)
      return
    }
    try {
      // The same function the notes_add tool calls, with the panel's own defaults and nothing else.
      const written = await writeOneNote(store, parsed, { who: NOTES_ADD_ROUTE_PATH, author: ROUTE_AUTHOR }, limits)
      sendJson(res, 200, { ok: true, seq: written.seq, notes: written.live })
    } catch (error) {
      const answer = refusalAnswer(error)
      sendJson(res, answer.status, answer.body)
    }
  }

  const routes = [
    { kind: 'exact', path: NOTES_ROUTE_PATH, handler: stateHandler },
    { kind: 'exact', path: NOTES_ADD_ROUTE_PATH, handler: addHandler },
  ]

  function registerRoutes(): void {
    if (bound) return
    const server = (ctx as { get?: (name: string) => unknown }).get?.('webServer') as { register?: (route: unknown) => () => void } | null | undefined
    if (server === null || server === undefined || typeof server.register !== 'function') return
    try {
      for (const route of routes) disposers.push(server.register(route))
      bound = true
      console.log('[link-notes] state route bound on ' + NOTES_ROUTE_PATH + ' (GET, read-only: the fold, the tombstones and the two thresholds)')
      console.log('[link-notes] add route bound on ' + NOTES_ADD_ROUTE_PATH + ' (POST, one note per call, author defaults to "' + ROUTE_AUTHOR + '"; the notes_add tool is NOT this path)')
    } catch (error) {
      console.error('[link-notes] could not bind the notes routes: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  registerRoutes()
  if (typeof (ctx as { inject?: unknown }).inject === 'function') {
    ctx.inject(['webServer'], () => registerRoutes())
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        bound = false
        for (const dispose of disposers.splice(0)) {
          try {
            dispose()
          } catch {
            /* a route that is already gone is not an error worth reporting */
          }
        }
      },
      'dsh-link-notes: routes',
    )
  }
}

/**
 * Open this row's ledger, register the section and the tools, and publish the store.
 *
 * The store is published for other rows and for a reader that wants the fold; the section and the
 * tools read that same store and keep no second copy of anything, so the bytes in the prompt are the
 * bytes the fold answers with. A restart loses nothing (the ledger is a file), but the notes group's
 * declaration is per-session: after a restart the group has to be declared again.
 * @param ctx - the cordis context this plugin is applied to.
 * @param config - the row's own configuration; an empty dir means the DSH home.
 */
export function apply(ctx: Context, config: NotesConfig = { dir: '' }): void {
  const dir = config.dir === '' || config.dir === undefined ? ledgerDir(ctx) : config.dir
  const limits: NotesLimits = {
    maxNotes: configuredLimit(config.maxNotes, DEFAULT_MAX_NOTES, 'maxNotes'),
    maxChars: configuredLimit(config.maxChars, DEFAULT_MAX_CHARS, 'maxChars'),
  }
  const store = openNotesStore(dir, { writer: 'host' })
  ctx.provide('linkNotes', store)
  ctx.effect(() => () => store.close())
  const prompt = (ctx as { systemPrompt?: NotesPromptService }).systemPrompt
  if (prompt === undefined || typeof prompt.section !== 'function') {
    throw new Error('dsh-link-notes: this composition mounts no systemPrompt service, so the ' + SECTION_NAME + ' section cannot be registered')
  }
  // Interpolation off is not a style choice. Section text is a strict template by default, and an
  // unknown variable THROWS rather than being eaten, so a note the user wrote containing a doubled
  // brace would take the whole prompt down. A note is user text, not a template.
  prompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    interpolate: false,
    text: () => renderNotesSection(notesOf(store), limits),
  })
  installTools(ctx, store, limits)
  // The panel's two routes: one read of the same fold, one narrow write through the same function. They
  // are not tools, so nothing here widens the model's tool face.
  installRoutes(ctx, store, limits)
  // console.log, not ctx.logger: every start line this project grades is read out of the boot's own
  // stdout (image-guard, collab, teams, continue-button), and a ctx.logger line does not appear there
  // (R185-P3 measured both in one throwaway boot — see docs/handoff/R185-D-mounting.md).
  console.log('[link-notes] ready — ' + String(openNotes(notesOf(store)).length) + ' open note(s) at ' + dir
    + '; section ' + SECTION_NAME + ' order ' + String(SECTION_ORDER) + '; limits ' + String(limits.maxNotes)
    + ' live note(s), ' + String(limits.maxChars) + ' character(s) each')
}
