/**
 * peers.json - the people-authorized software peers. linkId is immutable; name is the alias.
 *
 * Every mutation rewrites the document atomically (tmp + rename) so a crash cannot leave half a
 * peer. Reads hand out copies: a caller that mutates a row by accident must not change the store.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PeerRecord, PeerStore } from '../protocol/types.ts'

const HEAD = 'peers.json'

/** The store plus its file and a row count. */
export interface PeerRegistry extends PeerStore {
  /** Absolute path of peers.json. */
  file: string
  /** How many rows are held. */
  count(): number
}

const clone = (record: PeerRecord): PeerRecord => ({ ...record, scopes: [...record.scopes] })

/**
 * Load or create the peer registry.
 * @param options - data directory, optional log and clock.
 * @returns the registry.
 */
export function createPeerStore(options: { dir: string; log?: (line: string) => void; now?: () => Date }): PeerRegistry {
  const log = options.log ?? (() => {})
  const now = options.now ?? (() => new Date())
  const nowIso = (): string => now().toISOString()
  mkdirSync(options.dir, { recursive: true })
  const file = join(options.dir, HEAD)
  const records = new Map<string, PeerRecord>()

  if (existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as { peers?: PeerRecord[] }
      for (const record of Array.isArray(stored.peers) ? stored.peers : []) {
        if (typeof record?.linkId === 'string' && typeof record?.pub === 'string') records.set(record.linkId, clone(record))
      }
    } catch (error) {
      log('peers.json is unreadable (' + String(error instanceof Error ? error.message : String(error)) + '); starting empty')
    }
  }
  const persist = (): void => {
    const temp = file + '.' + String(process.pid) + '.tmp'
    writeFileSync(temp, JSON.stringify({ version: 1, peers: [...records.values()] }, null, 2) + '\n')
    renameSync(temp, file)
  }

  return {
    file,
    count(): number {
      return records.size
    },
    get(linkId: string): PeerRecord | undefined {
      const record = records.get(linkId)
      return record === undefined ? undefined : clone(record)
    },
    list(): PeerRecord[] {
      return [...records.values()].map(clone).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.linkId.localeCompare(b.linkId))
    },
    upsert(record: PeerRecord): PeerRecord {
      const existing = records.get(record.linkId)
      const merged: PeerRecord = {
        ...record,
        scopes: [...record.scopes],
        createdAt: existing?.createdAt ?? record.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      }
      records.set(merged.linkId, merged)
      persist()
      return clone(merged)
    },
    update(linkId: string, patch: Partial<PeerRecord>): PeerRecord | undefined {
      const existing = records.get(linkId)
      if (existing === undefined) return undefined
      const merged: PeerRecord = {
        ...existing,
        ...patch,
        linkId: existing.linkId,
        createdAt: existing.createdAt,
        scopes: patch.scopes === undefined ? existing.scopes : [...patch.scopes],
        updatedAt: nowIso(),
      }
      records.set(linkId, merged)
      persist()
      return clone(merged)
    },
    remove(linkId: string): boolean {
      const removed = records.delete(linkId)
      if (removed) persist()
      return removed
    },
  }
}
