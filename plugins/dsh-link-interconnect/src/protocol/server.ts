/**
 * createProtocolServer - the one assembly behind the FACTORY CONTRACT in protocol/types.ts.
 *
 * It creates the data directory, the Ed25519 instance identity, the token service, the peer and
 * grant registries, the consent gate, the event hub and the append-only audit sink, then returns
 * the protocol routes: contract, well-known, handshake, invoke, events, plus a link-prefix
 * catch-all so an unknown /link/v1 path answers link/not-found in the protocol envelope.
 *
 * Lifecycle: the factory materializes the identity + pairing code immediately (a contract read or
 * a live check never has to wait for a start hook). start() is idempotent and owns the one
 * "protocol server ready" log line; stop() ends open SSE streams and settles pending consent
 * questions. index.ts registers routes() and calls start()/stop() exactly once.
 */

import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DATA_DIR_NAME, LIMITS, LINK_PREFIX, PROTOCOL_ID } from './types.ts'
import type { AuditRecord, AuditSink, InterconnectCore, ProtocolOptions, ProtocolServer, RouteSpec } from './types.ts'
import { createHttpIo } from '../http/io.ts'
import { createRouteTable } from '../http/routes.ts'
import { createRateLimiter } from '../http/ratelimit.ts'
import { createIdentityStore } from '../identity/store.ts'
import { createTokenService } from '../identity/tokens.ts'
import { createPeerStore } from '../registry/peers.ts'
import { createGrantStore } from '../registry/grants.ts'
import { createConsentService } from '../registry/consent.ts'
import { createContractRoutes } from './contract.ts'
import { createHandshakeRoutes } from './handshake.ts'
import { createCapabilityRegistry, createInvokeRoutes, registerBuiltinCapabilities } from './invoke.ts'
import { createEventHub, createEventsRoutes } from './events.ts'

const AUDIT_FILE = 'audit.jsonl'
const AUDIT_MEMORY = 500
const PAIRING_FILE = 'pairing.json'
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PAIRING_LENGTH = 8

/** The append-only audit sink plus its file. */
export interface AuditStore extends AuditSink {
  /** Absolute path of audit.jsonl. */
  file: string
}

/**
 * Build the audit sink; the process keeps the newest records in memory and appends every one.
 * @param options - data directory and memory window.
 * @returns the sink.
 */
export function createAuditSink(options: { dir: string; limit?: number }): AuditStore {
  mkdirSync(options.dir, { recursive: true })
  const file = join(options.dir, AUDIT_FILE)
  const limit = Math.max(1, Math.floor(options.limit ?? AUDIT_MEMORY))
  const records: AuditRecord[] = []
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (line.trim() === '') continue
      try {
        const parsed = JSON.parse(line) as AuditRecord
        if (typeof parsed?.at === 'string' && typeof parsed?.kind === 'string') records.push(parsed)
      } catch {
        /* one truncated line (a crash mid-append) must not discard the rest of the ledger */
      }
    }
    if (records.length > limit) records.splice(0, records.length - limit)
  }
  return {
    file,
    record(record): void {
      const stored: AuditRecord = { ...record, at: new Date().toISOString() }
      records.push(stored)
      if (records.length > limit) records.splice(0, records.length - limit)
      try {
        appendFileSync(file, JSON.stringify(stored) + '\n')
      } catch {
        /* the in-memory ledger keeps the fact even when the disk is full */
      }
    },
    list(count = 100): AuditRecord[] {
      return records.slice(-Math.max(1, Math.floor(count))).map((record) => ({ ...record }))
    },
  }
}

/** The pairing material a person reads to let one software peer in. */
export interface PairingState {
  /** The code a person types into the software; never served on a route or logged. */
  code: string
  /** Absolute path of pairing.json. */
  file: string
  /** 'env' when LINK_PAIRING_CODE supplied it, otherwise 'generated'. */
  source: 'env' | 'generated'
  /** Rotation time. */
  createdAt: string
}

/**
 * Generate (or adopt from the environment) this run's pairing code and persist it.
 * @param options - data directory, optional environment and log.
 * @returns the pairing state; the log line announces the file, never the code.
 */
export function createPairingCode(options: { dir: string; env?: Record<string, string | undefined>; log?: (line: string) => void; now?: () => Date }): PairingState {
  mkdirSync(options.dir, { recursive: true })
  const log = options.log ?? (() => {})
  const now = options.now ?? (() => new Date())
  const file = join(options.dir, PAIRING_FILE)
  const override = String((options.env ?? process.env).LINK_PAIRING_CODE ?? '').trim()
  let code = override
  let source: 'env' | 'generated' = 'env'
  if (code === '') {
    source = 'generated'
    let generated = ''
    while (generated.length < PAIRING_LENGTH) {
      for (const byte of randomBytes(PAIRING_LENGTH * 2)) {
        if (generated.length >= PAIRING_LENGTH) break
        const index = byte % PAIRING_ALPHABET.length
        if (index < PAIRING_ALPHABET.length) generated += PAIRING_ALPHABET[index]
      }
    }
    code = generated
  }
  const createdAt = now().toISOString()
  const temp = file + '.' + String(process.pid) + '.tmp'
  writeFileSync(temp, JSON.stringify({ version: 1, code, source, createdAt }, null, 2) + '\n')
  renameSync(temp, file)
  log('pairing code ' + (source === 'env' ? 'from LINK_PAIRING_CODE' : 'generated') + ' - read it at ' + file)
  return { code, file, source, createdAt }
}

/** The protocol server plus the two surfaces index.ts wires into the rest of the plugin. */
export interface ProtocolServerHandle extends ProtocolServer {
  /** The capability table LINK serves on /link/v1/invoke. */
  readonly capabilities: ReturnType<typeof createCapabilityRegistry>
  /** This run's pairing material. */
  readonly pairing: PairingState
}

/**
 * Build the protocol core and its routes.
 * @param options - kernel home (or an absolute dataDir override) and the plugin log.
 * @returns the protocol server.
 */
export async function createProtocolServer(options: ProtocolOptions): Promise<ProtocolServerHandle> {
  const home = resolve(options.home)
  const dir = options.dataDir !== undefined && options.dataDir !== '' ? resolve(options.dataDir) : join(home, DATA_DIR_NAME)
  mkdirSync(dir, { recursive: true })
  const log = options.log

  const identityStore = createIdentityStore({ dir, log })
  const identity = identityStore.identity
  const tokens = createTokenService({ dir, identity, log })
  const peers = createPeerStore({ dir, log })
  const grants = createGrantStore({ dir, log })
  const events = createEventHub({ backlog: LIMITS.eventBacklog })
  const audit = createAuditSink({ dir })
  const consent = createConsentService({ events, log })
  const pairing = createPairingCode({ dir, log })
  const io = createHttpIo()
  const table = createRouteTable(io, {
    onError(error) {
      log('route failed: ' + String(error instanceof Error ? error.message : error))
    },
  })
  const capabilities = registerBuiltinCapabilities(createCapabilityRegistry(), identity)
  const contractRoutes = createContractRoutes(table, io, identity, log)
  const handshakeRoutes = createHandshakeRoutes({
    table, io, identity, tokens, peers, grants, audit, events,
    pairingCode: () => pairing.code,
    log,
    limiter: createRateLimiter({ rpm: LIMITS.rpm }),
  })
  const invokeRoutes = createInvokeRoutes({
    table, io, tokens, capabilities, audit, events, log,
    limiter: createRateLimiter({ rpm: LIMITS.rpm }),
  })
  const eventsRoutes = createEventsRoutes(table, io, tokens, events, log)
  const notFound = table.anyPrefix(LINK_PREFIX, (req, res) => {
    const { path } = io.parseUrl(req)
    io.sendError(res, 404, 'link/not-found', 'no link-interconnect route ' + path)
  })
  const routes: RouteSpec[] = [...contractRoutes, ...handshakeRoutes, ...invokeRoutes, ...eventsRoutes.routes, notFound]

  const core: InterconnectCore = { protocol: PROTOCOL_ID, dir, identity, tokens, peers, grants, consent, events, audit, log }
  let started = false
  const server: ProtocolServerHandle = {
    core,
    io,
    capabilities,
    pairing,
    routes(): RouteSpec[] {
      return routes.slice()
    },
    async start(): Promise<void> {
      if (started) return
      started = true
      log('protocol server ready linkId=' + identity.linkId + ' dir=' + dir)
    },
    async stop(): Promise<void> {
      eventsRoutes.stop()
      consent.dispose()
      started = false
    },
  }
  return server
}
