/**
 * Saving, the one thing this package writes.
 *
 * The kernel own workspace-files surface only reads, so the plugin host half carries a narrow save route
 * (`/api/dsh-link-markdown/write`, R351) and this module is the client side of it: one document, the version it was
 * read at, and what the server said. Kept apart from the component so the rules - when a save may be offered, what makes
 * it dirty, what a refusal means - can be read and tested without a browser.
 */

/** Where the host half listens. The two halves agree on this string; it is exported so a test can pin it. */
export const SAVE_PATH = '/api/dsh-link-markdown/write'

/** What one save attempt produced, named so the pane can say it. */
export type SaveOutcome =
  | { readonly kind: 'saved', readonly version: string | null, readonly bytes: number | null }
  | { readonly kind: 'stale', readonly version: string | null }
  | { readonly kind: 'refused', readonly code: string, readonly detail: string }

/** Whether the pane may offer to edit this document at all. */
export function canEdit(document: { readonly failure: unknown, readonly absolutePath?: string }): boolean {
  if (document.failure !== null) return false
  const path = document.absolutePath
  return typeof path === 'string' && path !== ''
}

/** Whether the draft differs from what was read. A save of an unchanged document writes nothing. */
export function isDirty(original: string, draft: string): boolean {
  return original !== draft
}

/**
 * Send one document to the save route and say what happened.
 * @param document - the absolute path and the version the text was read at.
 * @param text - the whole document as the person left it.
 * @param request - the fetch to use (injected so a test does not need a server).
 * @returns the named outcome; never throws for a refusal the server named.
 */
export async function saveDocument(
  document: { readonly absolutePath?: string, readonly version?: string, readonly sessionId?: string },
  text: string,
  request: (path: string, body: unknown) => Promise<{ status: number, body: any }>,
): Promise<SaveOutcome> {
  const path = document.absolutePath
  // No sentence here: the client half is checked for copy (reading 27), so a refusal travels as a CODE and the pane
  // turns it into words through its own dictionary.
  if (typeof path !== 'string' || path === '') return { kind: 'refused', code: 'NO_PATH', detail: '' }
  // R377: the Session travels with the save. It is the host's only way to place the write under the same
  // workspace-write boundary the agent's own tools use; without it the sandbox refuses the staging directory beside
  // a file that lives outside the shell's own working directory.
  const answer = await request(SAVE_PATH, { path, text, expectedVersion: document.version, sessionId: document.sessionId })
  const body = answer.body === null || typeof answer.body !== 'object' ? {} : answer.body
  if (answer.status === 200 && body.ok === true) {
    return { kind: 'saved', version: typeof body.version === 'string' ? body.version : null, bytes: typeof body.bytes === 'number' ? body.bytes : null }
  }
  if (answer.status === 409) return { kind: 'stale', version: typeof body.version === 'string' ? body.version : null }
  return { kind: 'refused', code: typeof body.code === 'string' ? body.code : 'HTTP_' + String(answer.status), detail: typeof body.error === 'string' ? body.error : '' }
}
