/**
 * The paged read behind the Markdown tab.
 *
 * Content is the tab type's own business: the `file` resource carries metadata only, and text arrives
 * one page of lines at a time through the Client Remote. The paging rule — how pages become one
 * document, when the read is over, and what a page that advances nothing means — is here, pure, with
 * the read itself passed in, so it is readable and testable without a browser.
 */
import { fileTargetOf, type ClaimRefusal, type FileTarget } from './claim.ts'

/** One page of a workspace text file, in the fields this module reads. */
export interface MarkdownPage {
  /** First line of the page, as requested. */
  readonly offset: number
  /** Page lines joined by `\n`, without a terminator after the last one. */
  readonly text: string
  /** How many lines the page holds; `0` when the offset lies past the file's last line. */
  readonly lines: number
  /** Whether the page includes the file's last line. */
  readonly eof: boolean
  /** Opaque freshness token of the file the page came from. */
  readonly version?: string
  /** Absolute path of the file, when the Host reported it. */
  readonly absolutePath?: string
}

/** The settled failure of a read, as a Remote result carries it. */
export interface DocumentFailure {
  readonly code: string
  readonly message: string
}

/** One document as the body renders it: lines accumulated from every page read so far. */
export interface MarkdownDocument {
  readonly address: string
  readonly lines: readonly string[]
  /** The next page to ask for; 1-based, as the endpoint counts lines. */
  readonly nextOffset: number
  readonly eof: boolean
  readonly pages: number
  readonly failure: DocumentFailure | null
  readonly version: string | undefined
  readonly absolutePath: string | undefined
}

/**
 * The line window one page asks for.
 *
 * R377: this is an OBJECT on the wire, not a number. The kernel's method is
 * `read(sessionId, path, range: { offset?, limit? }, signal)`, and passing a bare offset as the third
 * argument is refused before the Host ever sees it ("wire field \"range\" failed boundary validation").
 * The reader was written against an imagined (`offset: number`) signature and every pure rule around it
 * was green, because a fake reader in a test can take any shape the test itself invents — the live page is
 * what narrowed it. See docs/handoff/DELIVERY-ASSESSMENT.md, R377.
 */
export interface MarkdownRange {
  /** First line of the page; the endpoint's default when omitted. */
  readonly offset?: number
  /** Largest number of lines on the page; the endpoint's default when omitted. */
  readonly limit?: number
}

/** The read one page performs, bound to the Client Remote by {@link createPageReader}. */
export type ReadMarkdownPage = (
  sessionId: string,
  path: string,
  range: MarkdownRange,
  signal: AbortSignal,
) => Promise<{ readonly ok: true, readonly value: MarkdownPage } | { readonly ok: false, readonly error?: unknown }>

/** An empty document: nothing read, first page next, no failure. */
export function startDocument(address: string): MarkdownDocument {
  return { address, lines: [], nextOffset: 1, eof: false, pages: 0, failure: null, version: undefined, absolutePath: undefined }
}

/**
 * The document's text: the accumulated lines joined once.
 *
 * Joining lines rather than page texts is what keeps a page boundary that falls after an empty line
 * from gaining or losing a blank line — `lines` distinguishes a page holding one empty line from a
 * page past the file's end, and this is where that distinction is used.
 * @param document - the read so far.
 * @returns the complete text read so far.
 */
export function documentText(document: MarkdownDocument): string {
  return document.lines.join('\n')
}

/**
 * Fold one page into the document. Pure: the same document and page give the same result.
 * @param document - the read so far.
 * @param page - the page the Host returned.
 * @returns the document with the page's lines appended and the next offset advanced.
 */
export function appendPage(document: MarkdownDocument, page: MarkdownPage): MarkdownDocument {
  const lines = page.lines > 0 ? page.text.split('\n') : []
  return {
    ...document,
    lines: [...document.lines, ...lines],
    nextOffset: page.offset + page.lines,
    eof: page.eof === true,
    pages: document.pages + 1,
    failure: null,
    version: page.version ?? document.version,
    absolutePath: page.absolutePath ?? document.absolutePath,
  }
}

/** One readable message for anything thrown or returned as a failure. */
function failureText(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    const message = Reflect.get(error, 'message')
    if (typeof message === 'string' && message !== '') return message
  }
  return String(error)
}

/**
 * Record a settled failure. The lines already read stay: a failure is what the reader is told, not a
 * reason to pretend the document was empty.
 * @param document - the read so far.
 * @param failure - the code and message to render.
 * @returns the document carrying the failure.
 */
export function failDocument(document: MarkdownDocument, failure: DocumentFailure): MarkdownDocument {
  return { ...document, failure: { code: String(failure.code), message: String(failure.message) } }
}

/** Turn a Remote failure value into the code and message the body renders. */
function failureOf(error: unknown): DocumentFailure {
  const code = error !== null && typeof error === 'object' ? Reflect.get(error, 'code') : undefined
  return { code: typeof code === 'string' && code !== '' ? code : 'unreadable-file', message: failureText(error) }
}

/**
 * Bind the paged read to one Client Remote face.
 * @param remote - the Client Remote carrying the `workspaceFiles` namespace.
 * @returns the read one page performs.
 */
export function createPageReader(remote: { readonly workspaceFiles: { read: ReadMarkdownPage } }): ReadMarkdownPage {
  return (sessionId, path, range, signal) => remote.workspaceFiles.read(sessionId, path, range, signal)
}

/**
 * Read a document to its end, one page at a time, reporting after every page.
 *
 * The loop ends on `eof`, on the first failure, on a page that advanced nothing (0 lines without
 * `eof` — the endpoint's own way of saying the offset is past the file; asking again would spin), and
 * on an aborted tab. A rejected read is a failure like any other: the body renders its message rather
 * than an empty pane.
 * @param readPage - the bound paged read.
 * @param address - the tab's address; parsed here so the caller passes one value.
 * @param signal - aborts the read when the tab goes away.
 * @param onPage - called with every intermediate document, including the first empty one.
 * @returns the final document.
 */
export async function readAllPages(
  readPage: ReadMarkdownPage,
  address: string,
  signal: AbortSignal,
  onPage: (document: MarkdownDocument) => void,
): Promise<MarkdownDocument> {
  let document = startDocument(address)
  onPage(document)
  const target: FileTarget | ClaimRefusal = fileTargetOf(address)
  if (target.ok !== true) {
    const failed = failDocument(document, { code: target.reason, message: target.detail })
    onPage(failed)
    return failed
  }
  for (;;) {
    let result
    try {
      result = await readPage(target.sessionId, target.path, { offset: document.nextOffset }, signal)
    } catch (error) {
      const failed = failDocument(document, { code: 'read-rejected', message: failureText(error) })
      onPage(failed)
      return failed
    }
    if (result.ok !== true) {
      const failed = failDocument(document, failureOf(result.error))
      onPage(failed)
      return failed
    }
    const page = result.value
    document = appendPage(document, page)
    onPage(document)
    if (document.eof) return document
    if (!(page.lines > 0)) {
      const failed = failDocument(document, { code: 'page-made-no-progress', message: `offset ${page.offset} returned 0 lines without eof` })
      onPage(failed)
      return failed
    }
  }
}
