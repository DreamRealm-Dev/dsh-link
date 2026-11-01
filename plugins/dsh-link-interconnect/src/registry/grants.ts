/**
 * grants.json - what one peer may do. deny-by-default: no row, or a row without the scope, is a
 * refusal. The effective permission of a call is the intersection of both sides' grants; this
 * store holds LINK's side and the token's scope claim is minted from it.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Grant, GrantStore } from '../protocol/types.ts'

const HEAD = 'grants.json'

/** The store plus its file and a row count. */
export interface GrantRegistry extends GrantStore {
  /** Absolute path of grants.json. */
  file: string
  /** How many grants are held. */
  count(): number
}

const clone = (grant: Grant): Grant => ({ ...grant, scopes: [...grant.scopes] })

/**
 * Load or create the grant registry.
 * @param options - data directory, optional log and clock.
 * @returns the registry.
 */
export function createGrantStore(options: { dir: string; log?: (line: string) => void; now?: () => Date }): GrantRegistry {
  const log = options.log ?? (() => {})
  const now = options.now ?? (() => new Date())
  mkdirSync(options.dir, { recursive: true })
  const file = join(options.dir, HEAD)
  const grants = new Map<string, Grant>()

  if (existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as { grants?: Grant[] }
      for (const grant of Array.isArray(stored.grants) ? stored.grants : []) {
        if (typeof grant?.peerLinkId === 'string' && Array.isArray(grant?.scopes)) grants.set(grant.peerLinkId, clone(grant))
      }
    } catch (error) {
      log('grants.json is unreadable (' + String(error instanceof Error ? error.message : String(error)) + '); starting empty')
    }
  }
  const persist = (): void => {
    const temp = file + '.' + String(process.pid) + '.tmp'
    writeFileSync(temp, JSON.stringify({ version: 1, grants: [...grants.values()] }, null, 2) + '\n')
    renameSync(temp, file)
  }

  return {
    file,
    count(): number {
      return grants.size
    },
    get(peerLinkId: string): Grant | undefined {
      const grant = grants.get(peerLinkId)
      return grant === undefined ? undefined : clone(grant)
    },
    list(): Grant[] {
      return [...grants.values()].map(clone).sort((a, b) => a.grantedAt.localeCompare(b.grantedAt) || a.peerLinkId.localeCompare(b.peerLinkId))
    },
    grant(grant: Grant): Grant {
      const merged: Grant = { ...grant, scopes: [...new Set(grant.scopes)], grantedAt: grant.grantedAt || now().toISOString(), grantedBy: grant.grantedBy ?? 'user' }
      grants.set(merged.peerLinkId, merged)
      persist()
      return clone(merged)
    },
    revoke(peerLinkId: string): boolean {
      const removed = grants.delete(peerLinkId)
      if (removed) persist()
      return removed
    },
    has(peerLinkId: string, scope: string): boolean {
      const grant = grants.get(peerLinkId)
      return grant !== undefined && grant.scopes.includes(scope)
    },
  }
}
