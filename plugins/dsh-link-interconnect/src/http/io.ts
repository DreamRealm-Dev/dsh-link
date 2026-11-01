/**
 * The shared bytes-in / JSON-out helpers every protocol handler uses (types.ts HttpIo).
 *
 * One style for every route: bodies are bounded by LIMITS.bodyBytes, JSON answers are no-store,
 * refusals use the stable envelope, and the method guard names the one verb a path accepts.
 */

import { LIMITS } from '../protocol/types.ts'
import type { ErrorCode, HttpIo, HttpRequest, HttpResponse } from '../protocol/types.ts'
import { refuse } from '../protocol/errors.ts'

/**
 * Read the request body up to one limit.
 * @param req - the request facade.
 * @param limit - byte ceiling; defaults to LIMITS.bodyBytes.
 * @returns the complete body.
 * @throws LinkError link/payload-too-large when the body crosses the ceiling.
 */
export function readBody(req: HttpRequest, limit: number = LIMITS.bodyBytes): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0)
    if (Number.isFinite(declared) && declared > limit) {
      reject(refuse('link/payload-too-large', 'request body exceeds ' + String(limit) + ' bytes'))
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    const finish = (error?: unknown, body?: Buffer): void => {
      if (done) return
      done = true
      if (error !== undefined) reject(error)
      else resolve(body as Buffer)
    }
    req.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += buffer.byteLength
      if (size > limit) {
        finish(refuse('link/payload-too-large', 'request body exceeds ' + String(limit) + ' bytes'))
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => finish(undefined, Buffer.concat(chunks)))
    req.on('error', (error) => finish(refuse('link/bad-request', 'the request body failed: ' + String((error as Error)?.message ?? error))))
    req.on('close', () => {
      if (!done) finish(refuse('link/bad-request', 'the request closed before its body ended'))
    })
  })
}

/**
 * Read and parse one JSON object body.
 * @param req - the request facade.
 * @returns the parsed object; an empty body reads as {}.
 * @throws LinkError link/payload-too-large or link/bad-request.
 */
export async function readJson(req: HttpRequest): Promise<Record<string, any>> {
  const body = await readBody(req)
  const text = body.toString('utf8').trim()
  if (text === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw refuse('link/bad-request', 'request body is not JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw refuse('link/bad-request', 'request body must be a JSON object')
  }
  return parsed as Record<string, any>
}

/**
 * Answer one JSON document.
 * @param res - the response facade.
 * @param status - HTTP status.
 * @param body - the document.
 * @param headers - extra response headers.
 */
export function sendJson(res: HttpResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  if (headers !== undefined) {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
  }
  res.end(JSON.stringify(body))
}

/**
 * Answer one refusal in the protocol envelope.
 * @param res - the response facade.
 * @param status - HTTP status.
 * @param code - stable machine code.
 * @param message - one sentence.
 */
export function sendError(res: HttpResponse, status: number, code: ErrorCode, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } })
}

/**
 * Parse the request target without trusting the Host header.
 * @param req - the request facade.
 * @returns the pathname and search params.
 */
export function parseUrl(req: HttpRequest): { path: string; query: URLSearchParams } {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  return { path: url.pathname, query: url.searchParams }
}

/**
 * Answer 405 with Allow and link/method-not-allowed when the verb is not the accepted one.
 * @param req - the request facade.
 * @param res - the response facade.
 * @param method - the one accepted verb.
 * @returns true when the request already matches and the caller may continue.
 */
export function requireMethod(req: HttpRequest, res: HttpResponse, method: string): boolean {
  const wanted = method.toUpperCase()
  const actual = String(req.method ?? 'GET').toUpperCase()
  if (actual === wanted) return true
  res.setHeader('Allow', wanted)
  sendError(res, 405, 'link/method-not-allowed', 'method not allowed; use ' + wanted)
  return false
}

/**
 * Build the HttpIo facade (types.ts HttpIo).
 * @returns the shared helpers.
 */
export function createHttpIo(): HttpIo {
  return { readJson, readBody, sendJson, sendError, parseUrl, requireMethod }
}
