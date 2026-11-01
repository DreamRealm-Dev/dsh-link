/**
 * The failure page's name for each failure code, as a pure mapping.
 *
 * The codes themselves are the tab type's own contract (`claim.ts` names five refusals; `read.ts`
 * names three read outcomes) and they are identifiers: the page prints the code verbatim beside the
 * localized name, and a code this package does not know — one the Remote named, such as
 * `workspace-file/not-found` — keeps its own text and gets the generic "could not be read" sentence
 * instead of an invented name.
 */
import { REFUSAL_DISPOSITIONS } from './claim.ts'
import type { MarkdownKey } from './locales.ts'

/** Codes this package has a localized name for, mapped to their dictionary key. */
const REASON_KEYS = new Map<string, MarkdownKey>([
  [REFUSAL_DISPOSITIONS.notFileAddress, 'failure.reason.notFileAddress'],
  [REFUSAL_DISPOSITIONS.malformed, 'failure.reason.malformed'],
  [REFUSAL_DISPOSITIONS.unknownScope, 'failure.reason.unknownScope'],
  [REFUSAL_DISPOSITIONS.absoluteScope, 'failure.reason.absoluteScope'],
  [REFUSAL_DISPOSITIONS.notMarkdown, 'failure.reason.notMarkdown'],
  ['read-rejected', 'failure.reason.readRejected'],
  ['page-made-no-progress', 'failure.reason.noProgress'],
  ['unreadable-file', 'failure.reason.unreadable'],
])

/** Every code with a localized name, in dictionary order. */
export const NAMED_FAILURE_CODES: readonly string[] = Object.freeze([...REASON_KEYS.keys()])

/**
 * The dictionary key naming one failure code.
 * @param code - the code a refusal or a settled read recorded.
 * @returns the dictionary key, or `undefined` for a code this package does not know.
 */
export function failureReasonKey(code: string): MarkdownKey | undefined {
  return REASON_KEYS.get(code)
}
