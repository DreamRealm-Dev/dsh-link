/**
 * Default package entry.
 *
 * The implementation lives in a concrete versioned module (`lib/current.js`) so
 * a RUNNING host can switch to edited code: a Cordis composition reload re-imports
 * the row's module, but Node's ESM cache is keyed by resolved file URL and cannot
 * be invalidated without a process restart. The bundle patch therefore mounts
 * `dsh-lan-bridge/current`, while a fresh host start resolves this default entry,
 * which re-exports the very same implementation.
 */

export * from './current.js'
