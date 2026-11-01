/**
 * What the `markdown` tab type claims, as pure functions.
 *
 * Two decisions live here, and both are refusals as much as claims:
 *
 * - The type claims `*.md` and `*.markdown` addresses (the patterns the registry matches), and
 *   `canOpen` vetoes every address that is not a `dsh-resource://file/` address — a pattern with no
 *   scheme matches the URI's path, so `dsh-resource://chat/a.md` would otherwise match.
 * - A `dsh-resource://file/absolute/` address carries no Session, and `remote.workspaceFiles.read`
 *   resolves its target through one (a bare absolute address fails with
 *   `workspace-file/unknown-workspace`). Claiming an address this type cannot read would render an
 *   error page it chose to promise, so the promise stops short of that scope by name.
 *
 * The address grammar is the kernel's `dsh-util-workspace-path` one, restated here because this
 * package's browser bundle carries everything outside the shell's module table.
 */

/** This implementation's identity in the tab system, and the key its body and title register under. */
export const MARKDOWN_TAB_ID = 'dsh-link-markdown'

/** Type discriminator the tab system routes on. Not `text`: that kind is Document Preview's. */
export const MARKDOWN_KIND = 'markdown'

/** Address globs this type recognizes; matched against the URI path at any depth. */
export const MARKDOWN_PATTERNS: readonly string[] = Object.freeze(['*.md', '*.markdown'])

/** The scheme and host every address this type claims opens with. */
const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/** The extensions the claim accepts; the case of an address is ignored, as the registry's globs do. */
const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i

/** Why `fileTargetOf` refused an address; every refusal is named, none is a silent `undefined`. */
export const REFUSAL_DISPOSITIONS = Object.freeze({
  notFileAddress: 'not-a-dsh-resource-file-address',
  malformed: 'malformed-file-address',
  unknownScope: 'unknown-file-address-scope',
  absoluteScope: 'absolute-scope-carries-no-session',
  notMarkdown: 'not-a-markdown-extension',
})

/** One named refusal. */
export interface ClaimRefusal {
  readonly ok: false
  /** Disposition from {@link REFUSAL_DISPOSITIONS}. */
  readonly reason: string
  /** One line a person can read, carrying the address it refused. */
  readonly detail: string
}

/** One readable file target: the Session whose workspace resolves `path`. */
export interface FileTarget {
  readonly ok: true
  readonly scope: 'session'
  readonly sessionId: string
  readonly path: string
}

/** Decode one address segment, or `undefined` when the escape is malformed. */
function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment)
  } catch {
    // The only thrower is the URI escape parser, which means the segment is not validly encoded.
    return undefined
  }
}

/**
 * Read a `dsh-resource://file/session/<sessionId>/<path>` address into the parts a read needs.
 * Query and fragment suffixes are ignored, and encoded segments are decoded.
 * @param address - a candidate address.
 * @returns the target, or a named refusal.
 */
export function fileTargetOf(address: unknown): FileTarget | ClaimRefusal {
  if (typeof address !== 'string' || !address.startsWith(FILE_ADDRESS_PREFIX)) {
    return { ok: false, reason: REFUSAL_DISPOSITIONS.notFileAddress, detail: `not a dsh-resource://file/ address: ${String(address)}` }
  }
  const end = address.search(/[?#]/)
  const segments = address.slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end).split('/')
  const scope = segments.shift()
  if (scope === 'session') {
    const id = segments.shift()
    if (id === undefined || id === '' || segments.length === 0) {
      return { ok: false, reason: REFUSAL_DISPOSITIONS.malformed, detail: `session address without an id or a path: ${address}` }
    }
    const sessionId = decodeSegment(id)
    const decoded = segments.map(decodeSegment)
    if (sessionId === undefined || decoded.some(segment => segment === undefined)) {
      return { ok: false, reason: REFUSAL_DISPOSITIONS.malformed, detail: `address segment is not validly encoded: ${address}` }
    }
    return { ok: true, scope: 'session', sessionId, path: (decoded as string[]).join('/') }
  }
  if (scope === 'absolute') {
    return { ok: false, reason: REFUSAL_DISPOSITIONS.absoluteScope, detail: `an absolute file address carries no Session to read through: ${address}` }
  }
  return { ok: false, reason: REFUSAL_DISPOSITIONS.unknownScope, detail: `unknown file address scope "${String(scope)}": ${address}` }
}

/**
 * Whether this type will open an address: the registry's `canOpen` veto.
 * @param address - the matched address.
 * @returns whether the address is a session file address with a Markdown extension.
 */
export function isMarkdownAddress(address: string): boolean {
  const target = fileTargetOf(address)
  if (target.ok !== true) return false
  const end = target.path.search(/[?#]/)
  return MARKDOWN_EXTENSION.test(end === -1 ? target.path : target.path.slice(0, end))
}

/**
 * The last path segment of an address, for the chip title and the header.
 * @param address - a file address, or anything else.
 * @returns the file name, or the empty string.
 */
export function basenameOf(address: unknown): string {
  const target = fileTargetOf(address)
  const path = target.ok === true ? target.path : typeof address === 'string' ? address : ''
  const segments = path.split(/[\\/]/).filter(segment => segment !== '')
  return segments.length === 0 ? '' : segments[segments.length - 1]
}

/**
 * The chip's initial text, captured into the layout record when the tab opens.
 * @param address - the address being opened.
 * @returns the file name, or the address when it carries no path.
 */
export function titleFor(address: string): string {
  const name = basenameOf(address)
  return name === '' ? address : name
}
