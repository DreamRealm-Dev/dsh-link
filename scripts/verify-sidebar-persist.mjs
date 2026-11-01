#!/usr/bin/env node
// Gate 94 (R141) - sidebar-browser panel: does a child webview with a fixed data_directory keep
// site data (cookie / localStorage / IndexedDB) across a process restart, and does a fresh
// directory start empty?
//
// The judge reads ONLY recorded evidence: <workspace>//webview-probe/experiments/persist/latest
// (override with DSH_LINK_SIDEBAR_PERSIST_DIR). It re-derives every verdict from the RAW app logs
// ('PROBE-REPORT {... "note":"pre ..." }') and cross-checks the JSON fact fields; it never trusts a
// derived field, never re-runs the probe, and never reads the producer's prose.
//
// Shape of the evidence (producer: the Lead; probe: <workspace>//webview-probe):
//   runN.json          one record per process run (dataDir / dirExistedBefore / dirExistedAfter /
//                      processExitCode / killedByScript / reportLines / disk / logPath)
//   logs/runN.out.log  the raw process log for that run
//   run1 + run2 = the SAME directory D1 (run1 fresh, run2 must read back), run3 + run4 = D2.
// Design consequence, not a defect: a run that finds data already there prints "state KEPT" and
// writes nothing, so it has NO "post" line. R2/R4 assert on "pre" + "KEPT" only.
//
// Exit codes: 0 all readings green (raw markers printed) | 1 a real failure | 3 + a SKIP: line when
// the evidence directory itself is absent (the gate says it measured nothing).
import { existsSync, readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const DEFAULT_EVIDENCE = '<workspace>//webview-probe/experiments/persist/latest'
const TAG = 'R141'
const evidenceDir = () => process.env.DSH_LINK_SIDEBAR_PERSIST_DIR || DEFAULT_EVIDENCE

// Only readFileSync + JSON.parse may be downgraded to a red reading; anything else is a judge bug
// and must stay loud (a wide catch would disguise a programming error as a data error).
function loadJson(name) {
  const path = join(evidenceDir(), name)
  let text
  try { text = readFileSync(path, 'utf8') } catch (e) { return { ok: false, why: name + ' unreadable: ' + (e.code || e.message), path } }
  try { return { ok: true, json: JSON.parse(text.replace(/^\uFEFF/, '')), path } }
  catch (e) { return { ok: false, why: name + ' is not JSON: ' + e.message, path } }
}
function loadLog(name) {
  const path = join(evidenceDir(), 'logs', name)
  try { return { ok: true, text: readFileSync(path, 'utf8'), path } }
  catch (e) { return { ok: false, why: 'logs/' + name + ' unreadable: ' + (e.code || e.message), path } }
}
// Every reading below is re-derived from these notes; nothing else counts as a reading.
function notesOf(log) {
  const out = []
  for (const line of log.text.split(/\r?\n/)) {
    if (line.includes('PROBE-REPORT') === false) continue
    const m = line.match(/"note":"([^"]*)"/)
    if (m) out.push(m[1])
  }
  return out
}

function collect() {
  const readings = []
  const emit = (id, ok, detail) => readings.push({ id, ok, detail: String(detail) })

  const runs = { run1: loadJson('run1.json'), run2: loadJson('run2.json'), run3: loadJson('run3.json'), run4: loadJson('run4.json') }
  const logs = { run1: loadLog('run1.out.log'), run2: loadLog('run2.out.log'), run3: loadLog('run3.out.log'), run4: loadLog('run4.out.log') }
  const notes = {}
  for (const k of Object.keys(logs)) notes[k] = logs[k].ok ? notesOf(logs[k]) : []
  const has = (k, s) => notes[k].includes(s)
  const show = (k) => logs[k].ok ? notes[k].map((n) => JSON.stringify(n)).join(' | ') : logs[k].why
  const json = (k) => runs[k].ok ? runs[k].json : null

  // R1 - the write: a fresh directory starts empty and the page writes the three kinds of site data.
  {
    const j = json('run1')
    const pre = 'pre cookie=none ls=none idb=none'
    const post = 'post cookie=R141 ls=R141 idb=R141'
    const problems = []
    if (!j) problems.push(runs.run1.why)
    else {
      if (j.dirExistedBefore !== false) problems.push('dirExistedBefore=' + JSON.stringify(j.dirExistedBefore) + ' (expected false: D1 must be fresh)')
      if (j.dirExistedAfter !== true) problems.push('dirExistedAfter=' + JSON.stringify(j.dirExistedAfter))
      if (j.processExitCode !== 0) problems.push('processExitCode=' + JSON.stringify(j.processExitCode))
      if (j.killedByScript !== false) problems.push('killedByScript=' + JSON.stringify(j.killedByScript))
    }
    if (!logs.run1.ok) problems.push(logs.run1.why)
    else {
      if (!has('run1', pre)) problems.push('absent marker: ' + JSON.stringify(pre))
      if (!has('run1', 'state WROTE')) problems.push('absent marker: "state WROTE"')
      if (!has('run1', post)) problems.push('absent marker: ' + JSON.stringify(post))
    }
    emit('R1', problems.length === 0, (problems.length ? 'FAIL: ' + problems.join('; ') + ' || ' : '') + 'dataDir=' + (j ? j.dataDir : '?') + ' notes=[' + show('run1') + ']')
  }

  // R2 - the core: a NEW PROCESS on the SAME directory reads the site data back.
  {
    const j = json('run2'); const j1 = json('run1')
    const pre = 'pre cookie=R141 ls=R141 idb=R141'
    const problems = []
    if (!j) problems.push(runs.run2.why)
    if (!logs.run2.ok) problems.push(logs.run2.why)
    if (j && j1 && j.dataDir !== j1.dataDir) problems.push('dataDir differs from run1: ' + j.dataDir + ' vs ' + j1.dataDir)
    if (j && j1 === null) problems.push('cannot compare dataDir: ' + runs.run1.why)
    if (j) {
      if (j.processExitCode !== 0) problems.push('processExitCode=' + JSON.stringify(j.processExitCode))
      if (j.killedByScript !== false) problems.push('killedByScript=' + JSON.stringify(j.killedByScript))
    }
    if (logs.run2.ok) {
      // Paired assertion: prove the observation channel worked (there are notes, and KEPT is there)
      // before claiming anything from the ABSENCE of a write.
      if (notes.run2.length === 0) problems.push('no PROBE-REPORT notes at all: the channel produced nothing')
      if (!has('run2', pre)) problems.push('absent marker: ' + JSON.stringify(pre) + ' (site data did NOT survive the restart)')
      if (!has('run2', 'state KEPT')) problems.push('absent marker: "state KEPT"')
      if (has('run2', 'state WROTE')) problems.push('run2 WROTE: it saw an empty profile, so nothing was read back')
    }
    emit('R2', problems.length === 0, (problems.length ? 'FAIL: ' + problems.join('; ') + ' || ' : '') + 'dataDir=' + (j ? j.dataDir : '?') + ' notes=[' + show('run2') + ']')
  }

  // R3 - the negative control: a DIFFERENT, fresh directory must read empty.
  {
    const j = json('run3'); const j1 = json('run1')
    const pre = 'pre cookie=none ls=none idb=none'
    const problems = []
    if (!j) problems.push(runs.run3.why)
    if (!logs.run3.ok) problems.push(logs.run3.why)
    if (j && j1 && j.dataDir === j1.dataDir) problems.push('run3 reused run1 dataDir: ' + j.dataDir + ' (there is no second world to be empty)')
    if (j && j1 === null) problems.push('cannot compare dataDir: ' + runs.run1.why)
    if (j && j.dirExistedBefore !== false) problems.push('dirExistedBefore=' + JSON.stringify(j.dirExistedBefore) + ' (expected false: D2 must be fresh)')
    if (logs.run3.ok)
      { if (!has('run3', pre)) problems.push('absent marker: ' + JSON.stringify(pre) + ' (a fresh directory was not empty)') }
    emit('R3', problems.length === 0, (problems.length ? 'FAIL: ' + problems.join('; ') + ' || ' : '') + 'dataDir=' + (j ? j.dataDir : '?') + ' notes=[' + show('run3') + ']')
  }

  // R4 - the second directory persists too (rules out "only D1 was special").
  {
    const j = json('run4'); const j3 = json('run3')
    const pre = 'pre cookie=R141 ls=R141 idb=R141'
    const problems = []
    if (!j) problems.push(runs.run4.why)
    if (!logs.run4.ok) problems.push(logs.run4.why)
    if (j && j3 && j.dataDir !== j3.dataDir) problems.push('dataDir differs from run3: ' + j.dataDir + ' vs ' + j3.dataDir)
    if (j && j3 === null) problems.push('cannot compare dataDir: ' + runs.run3.why)
    if (j) {
      if (j.processExitCode !== 0) problems.push('processExitCode=' + JSON.stringify(j.processExitCode))
      if (j.killedByScript !== false) problems.push('killedByScript=' + JSON.stringify(j.killedByScript))
    }
    if (logs.run4.ok) {
      if (notes.run4.length === 0) problems.push('no PROBE-REPORT notes at all: the channel produced nothing')
      if (!has('run4', pre)) problems.push('absent marker: ' + JSON.stringify(pre))
      if (!has('run4', 'state KEPT')) problems.push('absent marker: "state KEPT"')
      if (has('run4', 'state WROTE')) problems.push('run4 WROTE although D2 already held data')
    }
    emit('R4', problems.length === 0, (problems.length ? 'FAIL: ' + problems.join('; ') + ' || ' : '') + 'dataDir=' + (j ? j.dataDir : '?') + ' notes=[' + show('run4') + ']')
  }

  // R5 - two worlds, both absolute, used pairwise.
  {
    const dirs = {}
    for (const k of ['run1', 'run2', 'run3', 'run4']) dirs[k] = json(k) ? json(k).dataDir : null
    const problems = []
    const distinct = new Set(Object.values(dirs).filter((d) => typeof d === 'string'))
    if (Object.values(dirs).some((d) => typeof d !== 'string' || d.length === 0)) problems.push('a run has no dataDir: ' + JSON.stringify(dirs))
    else {
      if (distinct.size !== 2) problems.push('expected exactly 2 distinct data directories, saw ' + distinct.size + ': ' + [...distinct].join(' , '))
      if (dirs.run1 !== dirs.run2) problems.push('run1/run2 are not the same directory')
      if (dirs.run3 !== dirs.run4) problems.push('run3/run4 are not the same directory')
      if (dirs.run1 === dirs.run3) problems.push('the two worlds are the same directory')
      for (const d of distinct) if (/^[A-Za-z]:[\\/]/.test(d) === false) problems.push('not an absolute path: ' + d)
    }
    emit('R5', problems.length === 0, (problems.length ? 'FAIL: ' + problems.join('; ') + ' || ' : '') + JSON.stringify(dirs))
  }

  // R6 - disk corroboration (secondary: the on-disk cookie jar exists in both worlds). Never a
  // substitute for R2, and its detail says so.
  {
    const problems = []
    for (const k of ['run1', 'run4']) {
      const j = json(k)
      if (!j) { problems.push(runs[k].why); continue }
      const disk = Array.isArray(j.disk) ? j.disk.join(' || ') : ''
      if (disk.includes('PRESENT EBWebView/Default/Network/Cookies') === false)
        problems.push(k + ' has no on-disk cookie jar line: ' + JSON.stringify(disk))
    }
    emit('R6', problems.length === 0, (problems.length ? 'FAIL: ' + problems.join('; ') + ' || ' : '') + 'secondary (never a substitute for R2): cookie jar present in both worlds; indexedDbOrigins run4=' + JSON.stringify(json('run4') ? json('run4').indexedDbOrigins : null))
  }

  return readings
}

function printReadings(readings) {
  const failed = readings.filter((r) => r.ok === false)
  console.log('[' + TAG + '] sidebar-panel site data, evidence=' + evidenceDir())
  for (const r of readings) console.log('  ' + (r.ok ? 'ok  ' : 'RED ') + r.id + ' :: ' + r.detail)
  console.log('READINGS ' + (readings.length - failed.length) + '/' + readings.length + ' green' + (failed.length ? ('; red: ' + failed.map((f) => f.id).join(',')) : ''))
  return failed.length
}

// ------------------------------------------------------------------ self-attack (hand-run)
function mutate(kind, dir) {
  mkdirSync(join(dir, 'logs'), { recursive: true })
  for (const n of ['run1', 'run2', 'run3', 'run4']) {
    copyFileSync(join(DEFAULT_EVIDENCE === evidenceDir() ? evidenceDir() : evidenceDir(), n + '.json'), join(dir, n + '.json'))
    copyFileSync(join(evidenceDir(), 'logs', n + '.out.log'), join(dir, 'logs', n + '.out.log'))
  }
  const p = (n) => join(dir, 'logs', n + '.out.log')
  if (kind === 'm1') {
    const t = readFileSync(p('run2'), 'utf8')
    writeFileSync(p('run2'), t.replace('pre cookie=R141 ls=R141 idb=R141', 'pre cookie=none ls=none idb=none'))
  } else if (kind === 'm2') {
    const t = readFileSync(p('run1'), 'utf8')
    writeFileSync(p('run1'), t.split(/\r?\n/).filter((l) => l.includes('state WROTE') === false).join('\n'))
  } else if (kind === 'm3') {
    const r2 = JSON.parse(readFileSync(join(dir, 'run2.json'), 'utf8'))
    const r3 = JSON.parse(readFileSync(join(dir, 'run3.json'), 'utf8'))
    r2.dataDir = r3.dataDir
    writeFileSync(join(dir, 'run2.json'), JSON.stringify(r2, null, 2))
  } else if (kind === 'm4') {
    const t = readFileSync(p('run3'), 'utf8')
    writeFileSync(p('run3'), t.replace('pre cookie=none ls=none idb=none', 'pre cookie=R141 ls=R141 idb=R141'))
  } else throw new Error('unknown mutant ' + kind)
}

function selfAttack() {
  console.log('[' + TAG + '] --self-attack: each mutant copies the evidence, then must make this gate exit 1')
  let bad = 0
  for (const kind of ['m1', 'm2', 'm3', 'm4']) {
    const dir = mkdtempSync(join(tmpdir(), 'r141-' + kind + '-'))
    mutate(kind, dir)
    let status = 0
    try {
      execFileSync(process.execPath, [process.argv[1]], { env: { ...process.env, DSH_LINK_SIDEBAR_PERSIST_DIR: dir }, stdio: 'pipe' })
    } catch (e) { status = e.status === undefined ? -1 : e.status }
    finally { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
    const good = status === 1
    if (!good) bad++
    console.log('  ' + (good ? 'ok  ' : 'RED ') + kind + ' exit=' + status + (good ? ' (expected 1: the mutant is red)' : ' EXPECTED 1'))
  }
  console.log('SELF-ATTACK ' + (4 - bad) + '/4 mutants turned this gate red')
  return bad
}

const mode = process.argv.includes('--self-attack') ? 'self-attack' : 'verify'
if (mode === 'self-attack') {
  if (existsSync(DEFAULT_EVIDENCE) === false) { console.log('SKIP: ' + DEFAULT_EVIDENCE + ' does not exist; nothing was measured'); process.exit(3) }
  process.exit(selfAttack() === 0 ? 0 : 1)
}
if (existsSync(evidenceDir()) === false) {
  console.log('SKIP: ' + evidenceDir() + ' does not exist, so this gate measured nothing (run webview-probe/scripts/persist-min.ps1 run1..run4 first)')
  process.exit(3)
}
try {
  process.exit(printReadings(collect()) === 0 ? 0 : 1)
} catch (e) {
  console.log('GATE-CRASH: the judge itself failed (this is a gate bug, not a data verdict): ' + (e && e.stack ? e.stack : e))
  process.exit(1)
}
