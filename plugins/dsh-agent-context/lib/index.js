/**
 * Default package entry.
 *
 * The implementation lives in a concrete versioned module (`lib/current.js`) so
 * a RUNNING host can switch to edited code: Cordis reloads a composition row,
 * but Node's ESM module cache is keyed by resolved file URL and cannot be
 * invalidated without a process restart. The profile patch therefore mounts
 * `dsh-agent-context/current`, while a fresh host start resolves this default
 * entry, which re-exports the very same implementation.
 */

export * from './current.js'
