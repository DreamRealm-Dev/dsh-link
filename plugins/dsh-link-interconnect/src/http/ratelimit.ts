/**
 * Token-bucket rate limits for one peer or one remote address.
 *
 * LIMITS.rpm is the protocol default (60 requests per rolling minute); a peer whose handshake
 * declared nothing gets exactly that. take() is the request path's one decision point: the
 * caller turns { ok: false, retryAfterMs } into link/rate-limited plus Retry-After.
 */

/** What one token-bucket decision says. */
export interface RateLimitDecision {
  /** true when the call may proceed. */
  ok: boolean
  /** How long until one token is available again; only on a refusal. */
  retryAfterMs?: number
}

/** A per-key token bucket. */
export interface RateLimiter {
  /** One decision for one key. */
  take(key: string): RateLimitDecision
  /** Drop one key's bucket, or every bucket. */
  reset(key?: string): void
  /** The configured requests-per-minute ceiling. */
  readonly rpm: number
}

interface Bucket {
  tokens: number
  at: number
}

/**
 * Build a token-bucket limiter.
 * @param options - rpm (default LIMITS.rpm), optional capacity (default rpm) and clock.
 * @returns the limiter.
 */
export function createRateLimiter(options: { rpm?: number; capacity?: number; now?: () => number } = {}): RateLimiter {
  const rpm = Number.isFinite(options.rpm) && (options.rpm as number) > 0 ? Math.floor(options.rpm as number) : 60
  const capacity = Math.max(1, Math.floor(options.capacity ?? rpm))
  const refillPerMs = rpm / 60000
  const now = options.now ?? (() => Date.now())
  const buckets = new Map<string, Bucket>()

  const bucketFor = (key: string): Bucket => {
    const existing = buckets.get(key)
    if (existing !== undefined) return existing
    const created: Bucket = { tokens: capacity, at: now() }
    buckets.set(key, created)
    if (buckets.size > 512) {
      for (const [otherKey, bucket] of buckets) {
        if (otherKey !== key && bucket.tokens >= capacity) buckets.delete(otherKey)
      }
    }
    return created
  }

  return {
    rpm,
    take(key: string): RateLimitDecision {
      const bucket = bucketFor(key)
      const at = now()
      const elapsed = Math.max(0, at - bucket.at)
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs)
      bucket.at = at
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1
        return { ok: true }
      }
      return { ok: false, retryAfterMs: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs)) }
    },
    reset(key?: string): void {
      if (key === undefined) buckets.clear()
      else buckets.delete(key)
    },
  }
}
