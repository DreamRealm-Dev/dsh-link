#!/usr/bin/env node
/**
 * Benchmark (R504) -- the cold-read path: what a fresh process pays to answer a ledger's team state.
 *
 * The question this round answers: with a checkpoint and its writer-maintained stamp in place, what
 * does a COLD read cost, and how much of it is open, parse, checkpoint decode and fold?
 *
 *   full cold read   fresh open (no checkpoint) + replay + projectTeamState -- the pre-R496 path
 *   cold read        fresh open (checkpoint on) + foldStateOf -- the cold read this round optimises
 *   fast read        the opt-in zero-read tier (fold.fastOpen): stamp + stat only
 *   lazy decode      the deferred v8 accumulator decode, measured on first use
 *   Y4               checkpoint OFF: no sha1, no sidecar, no regression (R507/Y4)
 *
 * Every timed path is p50 of >=5 fresh opens (the process boundary a cold read crosses), each open
 * measured on its own. The write/worker paths from R496 are kept for the same comparison.
 *
 * Usage: node plugins/dsh-link-collab/test/fold-bench.mjs [--rows=10000,30000,100000] [--json]
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { fixture } from './fold-fixtures.mjs'

const NL = String.fromCharCode(10)
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..', '..', '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const MODULE_PATH = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')))
const ROWS = String(option('--rows', '10000,30000,100000')).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0)
const JSON_ONLY = argv.includes('--json')
const FAST_RUNS = 7
const SLOW_RUNS = 5

let module
try {
  module = await import(pathToFileURL(MODULE_PATH).href)
} catch (error) {
  console.error('could not import the artifact: ' + (error && error.message ? error.message : String(error)))
  process.exit(3)
}

/** Write one fixture set as a real control.jsonl (the log's own line shape). */
function writeLedger(dir, records) {
  mkdirSync(dir, { recursive: true })
  const lines = records.map((row) => JSON.stringify({
    seq: row.seq, channel: 'control', at: row.at, kind: row.kind,
    ...(row.actor === undefined ? {} : { actor: row.actor }),
    ...(row.subject === undefined ? {} : { subject: row.subject }),
    ...(row.payload === undefined ? {} : { payload: row.payload }),
  }))
  writeFileSync(join(dir, 'control.jsonl'), lines.join(NL) + NL, 'utf8')
}
const openLog = (dir) => module.openControlLog({ dir, reclaim: true, now: () => 1700000000000 })
const round = (value) => Math.round(value * 1000) / 1000
const p50 = (samples) => {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]
}
const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q) => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  const mean = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length)
  return { n: sorted.length, wallMs: round(mean), p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(sorted[sorted.length - 1] ?? 0) }
}

/** The event-loop lag monitor: R491/R492's three instruments in one place. */
class LagMonitor {
  constructor() {
    this.histogram = monitorEventLoopDelay({ resolution: 1 })
    this.drifts = []
    this.canaries = []
    this.timer = null
  }
  start() {
    this.histogram.enable()
    this.timer = setInterval(() => {
      const started = performance.now()
      setImmediate(() => this.drifts.push(performance.now() - started))
    }, 1)
    this.canaryTimer = setInterval(() => {
      setImmediate(() => {
        const first = performance.now()
        setImmediate(() => this.canaries.push(performance.now() - first))
      })
    }, 2)
  }
  stop() {
    clearInterval(this.timer)
    clearInterval(this.canaryTimer)
    this.histogram.disable()
    const pct = (values, q) => {
      if (values.length === 0) return 0
      const sorted = [...values].sort((a, b) => a - b)
      return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
    }
    return {
      lagP50: round(Number(this.histogram.percentile(50)) / 1e6),
      lagP95: round(Number(this.histogram.percentile(95)) / 1e6),
      lagP99: round(Number(this.histogram.percentile(99)) / 1e6),
      lagMax: round(Number(this.histogram.max) / 1e6),
      driftP99: round(pct(this.drifts, 0.99)),
      canaryP99: round(pct(this.canaries, 0.99)),
    }
  }
}

/** Run one async workload under the lag monitor, answering per-op walls and the host lag. */
async function measureAsync(operations) {
  const monitor = new LagMonitor()
  monitor.start()
  const walls = []
  for (const operation of operations) {
    const started = performance.now()
    await operation()
    walls.push(performance.now() - started)
  }
  await new Promise((done) => setTimeout(done, 5))
  const lag = monitor.stop()
  return { ...stats(walls), ...lag }
}

const report = {}
const tempDirs = []
await module.configureFold({ checkpoint: false })
for (const rows of ROWS) {
  const dir = mkdtempSync(join(tmpdir(), 'r504-bench-' + String(rows) + '-'))
  tempDirs.push(dir)
  const ledgerDir = join(dir, 'collab')
  writeLedger(ledgerDir, fixture('mixed', rows))
  const reading = { rows }

  // full cold read -- the pre-R496 path, one fresh open + replay + full fold per run
  await module.configureFold({ checkpoint: false })
  const fullOpens = []
  const fullFolds = []
  for (let run = 0; run < SLOW_RUNS; run += 1) {
    const started = performance.now()
    const log = openLog(ledgerDir)
    const opened = performance.now()
    module.projectTeamState(log.replay())
    const folded = performance.now()
    fullOpens.push(opened - started)
    fullFolds.push(folded - opened)
    await log.close()
    module.disposeFoldLog(log)
  }
  reading.fullColdRead = {
    n: SLOW_RUNS,
    openMs: round(p50(fullOpens)),
    foldMs: round(p50(fullFolds)),
    totalMs: round(p50(fullOpens) + p50(fullFolds)),
  }

  // seed the checkpoint + stamp the way teardown does
  await module.configureFold({ checkpoint: true, checkpointIntervalMs: 600000, fastOpen: false })
  {
    const log = openLog(ledgerDir)
    module.foldStateOf(log)
    const started = performance.now()
    const save = module.saveFoldCheckpoint(log)
    reading.checkpointSave = {
      wallMs: round(performance.now() - started),
      outcome: save.outcome,
      manifestBytes: save.stateBytes === null ? null : Buffer.byteLength(readFileSync(join(ledgerDir, module.FOLD_CHECKPOINT_FILE), 'utf8')),
      stateBytes: save.stateBytes,
      accumulatorBytes: save.accumulatorBytes,
    }
    await log.close()
    module.disposeFoldLog(log)
  }

  // the R504 cold read: >=5 fresh opens (7 here), p50, with the open/index split
  module.resetFoldDiagnostics()
  const cold = []
  let coldTiers = new Map()
  for (let run = 0; run < FAST_RUNS; run += 1) {
    const started = performance.now()
    const log = openLog(ledgerDir)
    const opened = performance.now()
    module.foldStateOf(log)
    const folded = performance.now()
    cold.push({ open: opened - started, index: folded - opened, total: folded - started, tier: log.openTier, materialised: log.recordsMaterialised })
    coldTiers.set(log.openTier, (coldTiers.get(log.openTier) ?? 0) + 1)
    await log.close()
    module.disposeFoldLog(log)
  }
  const coldDiagnostics = module.foldDiagnostics()
  reading.fullColdRead.rssAtStart = process.memoryUsage().rss
  reading.coldRead = {
    n: FAST_RUNS,
    openMs: round(p50(cold.map((sample) => sample.open))),
    indexMs: round(p50(cold.map((sample) => sample.index))),
    totalMs: round(p50(cold.map((sample) => sample.total))),
    speedup: round(reading.fullColdRead.totalMs / p50(cold.map((sample) => sample.total))),
    tiers: Object.fromEntries(coldTiers),
    fullFolds: coldDiagnostics.fullFolds,
    checkpointsLoaded: coldDiagnostics.checkpointsLoaded,
    stateParses: coldDiagnostics.checkpointStateReads,
    accumulatorDecodes: coldDiagnostics.checkpointAccumulatorDecodes,
    digestsComputed: coldDiagnostics.digestsComputed,
    recordsMaterialised: cold.filter((sample) => sample.materialised === false).length,
    rssDeltaMiB: round((process.memoryUsage().rss - reading.fullColdRead.rssAtStart) / 1048576),
  }

  // the opt-in zero-read tier
  await module.configureFold({ checkpoint: true, checkpointIntervalMs: 600000, fastOpen: true, stampVerifyMs: 600000 })
  const fast = []
  let fastTiers = new Map()
  for (let run = 0; run < FAST_RUNS; run += 1) {
    const started = performance.now()
    const log = openLog(ledgerDir)
    const opened = performance.now()
    module.foldStateOf(log)
    const folded = performance.now()
    fast.push({ open: opened - started, index: folded - opened, total: folded - started, tier: log.openTier })
    fastTiers.set(log.openTier, (fastTiers.get(log.openTier) ?? 0) + 1)
    await log.close()
    module.disposeFoldLog(log)
  }
  reading.fastRead = {
    n: FAST_RUNS,
    openMs: round(p50(fast.map((sample) => sample.open))),
    indexMs: round(p50(fast.map((sample) => sample.index))),
    totalMs: round(p50(fast.map((sample) => sample.total))),
    speedup: round(reading.fullColdRead.totalMs / p50(fast.map((sample) => sample.total))),
    tiers: Object.fromEntries(fastTiers),
  }
  await module.configureFold({ checkpoint: true, checkpointIntervalMs: 600000, fastOpen: false })

  // the deferred accumulator decode, measured on first need after a cold read
  {
    const log = openLog(ledgerDir)
    module.foldStateOf(log)
    const started = performance.now()
    const accumulator = module.foldAccumulatorOf(log)
    reading.lazyAccumulator = { decodeMs: round(performance.now() - started), through: accumulator.through }
    await log.close()
    module.disposeFoldLog(log)
  }

  // Y4: checkpoint OFF costs no digest, writes no sidecar, and is measured on a directory that has
  // never held one (the checkpointed directory above already carries its sidecar).
  await module.configureFold({ checkpoint: false })
  const offDir = join(dir, 'off')
  mkdirSync(offDir, { recursive: true })
  writeFileSync(join(offDir, 'control.jsonl'), readFileSync(join(ledgerDir, 'control.jsonl')))
  module.resetFoldDiagnostics()
  const off = []
  for (let run = 0; run < SLOW_RUNS; run += 1) {
    const started = performance.now()
    const log = openLog(offDir)
    const opened = performance.now()
    module.foldStateOf(log)
    const folded = performance.now()
    off.push({ open: opened - started, fold: folded - opened })
    await log.close()
    module.disposeFoldLog(log)
  }
  const offDiagnostics = module.foldDiagnostics()
  const files = readdirSync(offDir)
  reading.y4 = {
    openMs: round(p50(off.map((sample) => sample.open))),
    foldMs: round(p50(off.map((sample) => sample.fold))),
    digestsComputed: offDiagnostics.digestsComputed,
    stampsRead: offDiagnostics.stampsRead,
    sidecarWritten: files.includes(module.LEDGER_STAMP_FILE),
    checkpointWritten: files.includes(module.FOLD_CHECKPOINT_FILE),
  }

  // prefix proof (the R502 A2 cost, kept as the checkpoint path's integrity budget)
  {
    const text = readFileSync(join(ledgerDir, 'control.jsonl'), 'utf8')
    const proofSamples = []
    for (let run = 0; run < 7; run += 1) {
      const started = performance.now()
      const { createHash } = await import('node:crypto')
      createHash('sha1').update(text).digest('hex')
      proofSamples.push(performance.now() - started)
    }
    reading.prefixProof = { p50: round(p50(proofSamples)), bytes: Buffer.byteLength(text) }
  }

  reading.mainRss = process.memoryUsage().rss
  report[String(rows)] = reading
}

for (const dir of tempDirs) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp */ } }

const line = (value) => String(value)
if (JSON_ONLY) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log('R504 cold-read bench -- node ' + process.version)
  for (const rows of ROWS) {
    const reading = report[String(rows)]
    if (reading === undefined) continue
    console.log('')
    console.log('rows=' + line(rows) + '  (main RSS ' + String(Math.round(reading.mainRss / 1048576)) + ' MiB)')
    console.log('  full cold read (cp off)      open ' + line(reading.fullColdRead.openMs) + ' + fold ' + line(reading.fullColdRead.foldMs) + ' = ' + line(reading.fullColdRead.totalMs) + ' ms  (p50 n=' + line(reading.fullColdRead.n) + ')')
    console.log('  cold read (cp on)            open ' + line(reading.coldRead.openMs) + ' + index ' + line(reading.coldRead.indexMs) + ' = ' + line(reading.coldRead.totalMs) + ' ms  (p50 n=' + line(reading.coldRead.n) + ')  speedup ' + line(reading.coldRead.speedup) + 'x')
    console.log('     tiers ' + JSON.stringify(reading.coldRead.tiers) + '  fullFolds=' + line(reading.coldRead.fullFolds) + '  loaded=' + line(reading.coldRead.checkpointsLoaded) + '  stateParses=' + line(reading.coldRead.stateParses) + '  accDecodes=' + line(reading.coldRead.accumulatorDecodes) + '  digests=' + line(reading.coldRead.digestsComputed) + '  unparsed-opens=' + line(reading.coldRead.recordsMaterialised) + '/' + line(reading.coldRead.n) + '  RSS+' + line(reading.coldRead.rssDeltaMiB) + ' MiB')
    console.log('  fast read (fastOpen opt-in)  open ' + line(reading.fastRead.openMs) + ' + index ' + line(reading.fastRead.indexMs) + ' = ' + line(reading.fastRead.totalMs) + ' ms  speedup ' + line(reading.fastRead.speedup) + 'x  tiers ' + JSON.stringify(reading.fastRead.tiers))
    console.log('  lazy acc decode (first use) ' + line(reading.lazyAccumulator.decodeMs) + ' ms  (through ' + line(reading.lazyAccumulator.through) + ')')
    console.log('  Y4 checkpoint off            open ' + line(reading.y4.openMs) + ' + fold ' + line(reading.y4.foldMs) + ' ms  digests=' + line(reading.y4.digestsComputed) + '  stampReads=' + line(reading.y4.stampsRead) + '  sidecar=' + String(reading.y4.sidecarWritten) + '  checkpoint=' + String(reading.y4.checkpointWritten))
    console.log('  checkpoint save              ' + line(reading.checkpointSave.wallMs) + ' ms  manifest ' + line(reading.checkpointSave.manifestBytes) + ' B  state ' + line(reading.checkpointSave.stateBytes) + ' B  acc ' + line(reading.checkpointSave.accumulatorBytes) + ' B  outcome ' + String(reading.checkpointSave.outcome))
    console.log('  prefix proof (sha1)          p50 ' + line(reading.prefixProof.p50) + ' ms over ' + line(reading.prefixProof.bytes) + ' B')
  }
}
