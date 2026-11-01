/**
 * Stable false-refusal vocabulary for link-interconnect/1.
 *
 * A code never changes with the sentence beside it (types.ts: "The code never changes with the
 * sentence beside it."), so every module refuses through this one error type and envelope:
 * { ok: false, error: { code, message } }. The HTTP status is a function of the code.
 */

import { ERROR_CODES } from './types.ts'
import type { ErrorCode, HttpResponse } from './types.ts'

/** The HTTP status each stable code answers with. */
export const STATUS_BY_CODE: Readonly<Record<string, number>> = Object.freeze({
  'link/unauthorized': 401,
  'link/scope-missing': 403,
  'link/version-unsupported': 400,
  'link/consent-required': 403,
  'link/peer-unavailable': 503,
  'link/rate-limited': 429,
  'link/payload-too-large': 413,
  'link/idempotency-conflict': 409,
  'link/bad-request': 400,
  'link/not-found': 404,
  'link/internal': 500,
  'link/method-not-allowed': 405,
})

/** One protocol refusal with its stable code, its log sentence and its HTTP status. */
export class LinkError extends Error {
  /** The stable code a caller switches on. */
  readonly code: ErrorCode
  /** The HTTP status this refusal answers with. */
  readonly status: number

  /**
   * @param code - stable machine code.
   * @param message - one sentence for a human reading the log or the answer.
   * @param status - HTTP override; defaults to STATUS_BY_CODE[code].
   */
  constructor(code: ErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'LinkError'
    this.code = code
    this.status = status ?? STATUS_BY_CODE[code] ?? 500
  }
}

/**
 * Build one refusal.
 * @param code - stable machine code.
 * @param message - one sentence.
 * @param status - HTTP override.
 * @returns the LinkError, ready to throw or answer with.
 */
export function refuse(code: ErrorCode, message: string, status?: number): LinkError {
  return new LinkError(code, message, status)
}

/**
 * Narrow an unknown thrown value to a LinkError.
 * @param value - whatever was thrown.
 * @returns true when it is a protocol refusal.
 */
export function isLinkError(value: unknown): value is LinkError {
  return value instanceof LinkError
}

/**
 * Coerce any thrown value into one protocol refusal; anything unrecognized becomes link/internal.
 * @param error - whatever was thrown.
 * @returns the refusal to answer with.
 */
export function asLinkError(error: unknown): LinkError {
  if (isLinkError(error)) return error
  const message = error instanceof Error ? error.message : String(error)
  return new LinkError(ERROR_CODES.internal, message)
}

/**
 * The one refusal document.
 * @param code - stable machine code.
 * @param message - one sentence.
 * @returns { ok: false, error: { code, message } }.
 */
export function errorDocument(code: ErrorCode, message: string): { ok: false; error: { code: ErrorCode; message: string } } {
  return { ok: false, error: { code, message } }
}

/**
 * Answer one refusal unchanged (no-store, JSON).
 * @param res - the response facade.
 * @param error - the refusal.
 */
export function sendLinkError(res: HttpResponse, error: LinkError): void {
  res.statusCode = error.status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(errorDocument(error.code, error.message)))
}
