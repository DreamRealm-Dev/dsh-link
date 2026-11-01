/**
 * discovery-egress-claim.mjs — R203: the discoverability CLAIM follows the recorded EGRESS, both ways.
 *
 * The defect this pins: `host service started ... discoverable=true` was printed before anything was
 * announced, and the only per-NIC lines the boot carried were `setMulticastInterface EBADF` errors from an
 * UNBOUND socket — a socket-state error read as a NIC verdict, and the loopback announce leg left no record
 * at all.
 *
 * What is asserted here, in the plugin's own words rather than in a gate's:
 *   1. RECORD: one egress result per NIC AND one for the loopback announce leg, all written AFTER the
 *      "discovery listening on ..." line that names the address set. A pre-bind line is not a result.
 *   2. BOTH SIDES: `discoverable` is true only when at least one NIC egress was really recorded as sent, and
 *      false — with a reason on the line — when nothing was attempted at all (the preference off).
 *   3. THE CLAIM FOLLOWS THE EVIDENCE, in both directions: turning announcing off flips the claim to false and
 *      turning it back on lets a fresh egress put it back to true; at every step the reported claim must equal
 *      what the record says (NIC worked > 0), never a constant.
 *
 * Run: node test/discovery-egress-claim.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createBridgeService } from '../lib/core/service.js'
import { createReport } from './_harness.mjs'

const report = createReport('discovery-egress-claim', { watchdogMs: 120_000 })
const { ok, eq, note, section, finish } = report

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const LOOPBACK = '127.0.0.1'

/**
 * The lines one service wrote, in the shape the host logger writes them. The plugin's own boot record is what
 * a support reader sees, so the test reads THAT rather than a mock of it.
 */
function makeLog() {
  const lines = []
  const make = (scope) => ({
    info: (message, extra) => lines.push(scope + ' ' + message + (extra === undefined ? '' : ' — ' + String(extra))),
    warn: (message, extra) => lines.push('[warn] ' + scope + ' ' + message + (extra === undefined ? '' : ' — ' + String(extra))),
    error: (message, extra) => lines.push('[error] ' + scope + ' ' + message + (extra === undefined ? '' : ' — ' + String(extra))),
    child: (sub) => make(scope === '' ? sub : scope + '/' + sub),
  })
  return { lines, logger: make('host') }
}

/** One real service: its own identity, its own data dir, the machine's real NICs, the real sockets. */
function makeHost(label, config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lan-egress-' + label + '-'))
  const { lines, logger } = makeLog()
  const service = createBridgeService({
    ctx: { get: () => undefined },
    config: { role: 'agent', dataDir: path.join(root, 'data'), port: 0, ...config },
    log: logger,
  })
  return { label, root, lines, service, cleanup: () => { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } } }
}

// ---------------------------------------------------------------------------
// The record the boot carries: what a reader (and a gate) can actually see.
// ---------------------------------------------------------------------------
const LISTEN_RE = /^host\/discovery discovery listening on \d+\.\d+\.\d+\.\d+:\d+ \((.*)\)$/
const EGRESS_RE = /^host\/discovery multicast egress via (\d+\.\d+\.\d+\.\d+) (.+)$/
const CLAIM_RE = /^host service started role=(\S+) discoverable=(true|false) port=(\d+) data=(.*)$/

/** The bind line and the egress results around it — exactly how a reader has to read the boot. */
function readRecord(lines) {
  const bindAt = lines.findIndex((line) => LISTEN_RE.test(line))
  const addresses = bindAt === -1 ? [] : (LISTEN_RE.exec(lines[bindAt])[1].split(',').map((one) => one.trim()).filter((one) => one !== ''))
  const results = []
  lines.forEach((line, index) => {
    const found = EGRESS_RE.exec(line)
    if (found !== null) results.push({ line: index, address: found[1], detail: found[2], afterBind: bindAt !== -1 && index > bindAt, kind: /unavailable/iu.test(found[2]) ? 'unavailable' : 'worked' })
  })
  const claimLine = [...lines].reverse().find((line) => CLAIM_RE.test(line)) ?? null
  const claim = claimLine === null ? null : CLAIM_RE.exec(claimLine)[2] === 'true'
  return { bindAt, addresses, results, claim, claimLine }
}

/** What the record itself says about the NICs, without asking the service anything. */
function claimFromRecord(record) {
  const nics = record.addresses.filter((address) => address !== LOOPBACK)
  const rows = record.results.filter((row) => nics.includes(row.address))
  return { attempted: nics.length, worked: rows.filter((row) => row.kind === 'worked').length, rows, nics }
}

/** The claim fields the host reports, tolerating the field name a slightly older/newer host may use. */
function reportedClaim(snapshot) {
  const claim = typeof snapshot?.discoverable === 'boolean' ? snapshot.discoverable : null
  const requested = typeof snapshot?.discoverableRequested === 'boolean' ? snapshot.discoverableRequested
    : typeof snapshot?.discoverablePreference === 'boolean' ? snapshot.discoverablePreference
      : null
  return { claim, requested, egress: typeof snapshot?.egress === 'string' ? snapshot.egress : null }
}

const hosts = []
try {
  // -------------------------------------------------------------------------
  section('1. announcing ON: one result per NIC and one for the loopback leg, all after the bind')
  const on = makeHost('on', { discoverable: true })
  hosts.push(on)
  await on.service.start()
  await sleep(300) // let the bind callback's announce land its send callbacks
  const record = readRecord(on.lines)
  note('record lines: ' + JSON.stringify(record.results.map((row) => row.address + ' ' + row.kind)))
  ok('the boot names the address set it announces from', record.bindAt !== -1 && record.addresses.length > 0, JSON.stringify(record.addresses))
  const nics = record.addresses.filter((address) => address !== LOOPBACK)
  for (const address of nics) {
    const rows = record.results.filter((row) => row.address === address)
    ok('NIC ' + address + ' has a result line of its own', rows.length > 0, JSON.stringify(rows.map((row) => row.line)))
    ok('NIC ' + address + ' result is written AFTER the bind, not before it',
      rows.length > 0 && rows.every((row) => row.afterBind === true),
      JSON.stringify(rows.map((row) => ({ line: row.line, afterBind: row.afterBind }))))
  }
  ok('the announce loopback leg has a result line too (a leg may never be a silence)',
    record.results.some((row) => row.address === LOOPBACK), JSON.stringify(record.results.map((row) => row.address)))
  ok('every egress result is written after the socket is bound',
    record.results.length > 0 && record.results.every((row) => row.afterBind === true),
    JSON.stringify(record.results.filter((row) => row.afterBind !== true).map((row) => row.line + ': ' + row.detail)))

  // -------------------------------------------------------------------------
  section('2. the claim equals the record, side one: announcing on')
  const claimOn = reportedClaim(on.service.snapshot())
  const fromRecordOn = claimFromRecord(record)
  note('snapshot: discoverable=' + String(claimOn.claim) + ' requested=' + String(claimOn.requested) + ' egress=' + String(claimOn.egress))
  eq('the boot claim line and the snapshot agree', record.claim, claimOn.claim)
  if (fromRecordOn.worked > 0) {
    eq('at least one NIC egress worked, so the claim is TRUE', claimOn.claim, true)
  } else {
    // A machine whose NICs genuinely cannot carry multicast: the claim must say so, with the count.
    eq('no NIC egress worked, so the claim is FALSE', claimOn.claim, false)
    ok('and the boot says why, with the count', record.claimLine !== null && /no working egress/iu.test(record.claimLine), String(record.claimLine))
  }
  eq('the claim never disagrees with the number of NIC results that worked', claimOn.claim, fromRecordOn.worked > 0)
  eq('the request that was not turned off is still on', claimOn.requested, true)

  // -------------------------------------------------------------------------
  section('3. the claim equals the record, side two: announcing off')
  const off = makeHost('off', { discoverable: false })
  hosts.push(off)
  await off.service.start()
  await sleep(300)
  const offRecord = readRecord(off.lines)
  const offClaim = reportedClaim(off.service.snapshot())
  note('off record egress lines: ' + String(offRecord.results.length) + '; claim=' + String(offClaim.claim))
  eq('a machine asked not to announce claims FALSE', offClaim.claim, false)
  eq('and its boot claim line says the same thing', offRecord.claim, false)
  eq('and it attempted nothing at all, so no NIC result can be invented', offRecord.results.length, 0)
  eq('while its preference is honestly reported as off', offClaim.requested, false)
  ok('and the false line names the reason', offRecord.claimLine !== null && /discoverability is off/iu.test(offRecord.claimLine), String(offRecord.claimLine))

  // -------------------------------------------------------------------------
  section('4. a flip moves the claim with it, and back again')
  const flippedOff = on.service.setDiscoverable === undefined ? null : on.service.setDiscoverable(false)
  if (flippedOff !== null && typeof flippedOff.then === 'function') await flippedOff
  const afterOff = reportedClaim(on.service.snapshot())
  eq('turned off: the claim follows immediately', afterOff.claim, false)
  eq('turned off: the preference is off as well', afterOff.requested, false)
  const linesWhileOff = readRecord(on.lines).results.length
  await sleep(250)
  eq('turned off: nothing is announced, so no new egress result is written', readRecord(on.lines).results.length, linesWhileOff)

  const flippedOn = on.service.setDiscoverable(true)
  if (flippedOn !== null && typeof flippedOn.then === 'function') await flippedOn
  await sleep(300)
  const afterOn = reportedClaim(on.service.snapshot())
  const fromReRecord = claimFromRecord(readRecord(on.lines))
  note('after the flip back on: claim=' + String(afterOn.claim) + ', NIC results worked=' + String(fromReRecord.worked))
  ok('turned back on: a fresh egress was recorded', fromReRecord.worked > 0 || nics.length === 0, 'NIC result(s) worked=' + String(fromReRecord.worked))
  eq('turned back on: the claim follows the evidence again', afterOn.claim, fromReRecord.worked > 0)
  eq('turned back on: the preference is on', afterOn.requested, true)

  // -------------------------------------------------------------------------
  section('5. the claim is DERIVED, never hard-coded')
  ok('a machine asked off says false and a machine whose egress worked says true — both were observed',
    offClaim.claim === false && (fromRecordOn.worked === 0 || claimOn.claim === true),
    'on=' + String(claimOn.claim) + ' off=' + String(offClaim.claim))
} catch (error) {
  ok('the suite ran to completion', false, String(error && error.stack ? error.stack : error))
} finally {
  for (const host of hosts) {
    try { await host.service.stop() } catch { /* best effort */ }
    host.cleanup()
  }
  finish()
}
