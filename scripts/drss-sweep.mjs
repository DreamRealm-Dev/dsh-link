#!/usr/bin/env node
/**
 * R379 - the DRSS SR selection sweep: a staged candidate search over the EXISTING data, scored on the frozen validation
 * split only.
 *
 * Phase 3 of the delivery asks for a real capability test in the existing DRSS directory: no new data collected, the
 * validation set never trained on, a large candidate selection, and an algorithmic improvement measured rather than
 * asserted. The R254 experiment established the harness (three candidates, +0.3567 dB over bicubic, 25/25 scenes) and
 * one dominant finding: the STEP BUDGET matters more than anything else (400 steps +0.36 dB, 3000 steps -0.07 dB).
 * That finding says the operating point is below 400 - so this sweep searches it.
 *
 * The search is staged, each stage using what the previous one learnt (a small fractal: coarse axis, then refine):
 *
 *   stage 1   steps  {100,150,200,250,300,400}                    which step budget maximises full-image val PSNR
 *   stage 2   lr     {1e-3,2e-3,3e-3,5e-3,8e-3} + --zero-init 1   around stage 1's winner
 *   stage 3   structure {--dil 2, --patch 128, --patch 64, --pw-blocks 0, --sd 0, --batch 16}   around stage 2's
 *
 * Every candidate trains from the SAME frozen TRAIN split's patch cache (cut by the repo's own prep_patches.py before
 * this round) and is scored by the repo's own evaluator path on the SAME 25 frozen validation scenes, with bicubic as
 * the per-run baseline. Nothing is written under H:\mod\mcst: the trainer's output goes to the workspace, the cache is
 * read-only, and the validation files are sealed (scripts/drss-preflight.mjs --verify-seal) around the whole run.
 *
 * Usage: node scripts/drss-sweep.mjs [--stage 1|2|3|all] [--out <dir>] [--seed 1234]
 * Exit 0 the sweep finished and the table is written | 1 a candidate failed | 3 the world is not there
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const REPO = resolve(flag('--repo', 'H:\\mod\\mcst'))
const CACHE = resolve(flag('--cache', process.env.MCST_CACHE ?? 'C:\\Users\\<user>\\AppData\\Local\\Temp\\mcst_exp\\cache_frozen_final'))
const OUT = resolve(flag('--out', join(PROJECT, '.tmp', 'r379-sweep')))
const STAGE = flag('--stage', 'all')
const SEED = flag('--seed', '1234')
const SCORER = join(PROJECT, 'docs', 'drss', 'R254-artifacts', 'score_val.py')
const TRAINER = join(REPO, 'train', 'train.py')

const sleep = (ms) => new Promise((done) => setTimeout(done, Math.max(0, ms)))
const show = (value) => JSON.stringify(value === undefined ? null : value)

if (existsSync(REPO) !== true) { console.log('SKIP: no DRSS workspace at ' + REPO); process.exit(3) }
if (existsSync(TRAINER) !== true) { console.log('SKIP: no trainer at ' + TRAINER); process.exit(3) }
if (existsSync(CACHE) !== true) { console.log('SKIP: no patch cache at ' + CACHE + ' (cut it with the repo own train/prep_patches.py)'); process.exit(3) }
if (existsSync(SCORER) !== true) { console.log('SKIP: no scorer at ' + SCORER); process.exit(3) }
mkdirSync(OUT, { recursive: true })

/** The shipped operating point every candidate is measured against. */
const BASE = { '--k': '7', '--pw-blocks': '1', '--lr': '3e-3', '--accum': '1', '--batch': '8', '--steps': '400', '--patch': '96', '--sd': '0.1', '--seed': SEED, '--val-every': '1000' }

const toArgs = (options) => Object.keys(options).map((key) => [key, String(options[key])])

const trainOne = (tag, options) => {
  const out = join(OUT, 'runs', tag)
  const args = [TRAINER, '--model', 'dw7pw', '--out', out, '--cache', '--cache-dir', CACHE, '--width', '16', '--mid', '32', '--loss', 'l1']
  for (const [key, value] of toArgs(Object.assign({}, BASE, options))) args.push(key, value)
  const started = Date.now()
  const answer = spawnSync('python', args, { encoding: 'utf8', timeout: 1800000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  const wall = (Date.now() - started) / 1000
  const tail = String(answer.stdout ?? '') + String(answer.stderr ?? '')
  const ckpt = join(out, 'last.pt')
  return { tag, wall, code: answer.status, ckpt, ok: existsSync(ckpt), tail: tail.split(/\r?\n/).filter((line) => line.trim() !== '').slice(-2) }
}

const scoreOne = (tag, ckpt) => {
  const out = join(OUT, 'scores', tag + '.json')
  mkdirSync(dirname(out), { recursive: true })
  const answer = spawnSync('python', [SCORER, '--ckpt', ckpt, '--tag', tag, '--split', 'val', '--out', out], { encoding: 'utf8', timeout: 900000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  if (answer.status !== 0 || existsSync(out) !== true) return { ok: false, why: String(answer.stderr ?? '').split(/\r?\n/).filter((line) => line.trim() !== '').slice(-3).join(' | ') }
  try {
    const doc = JSON.parse(readFileSync(out, 'utf8'))
    return { ok: true, doc }
  } catch (error) { return { ok: false, why: 'unreadable score: ' + String(error) } }
}

const rows = []
const runCandidate = (stage, tag, options) => {
  console.log('== ' + stage + ' ' + tag + ' ' + show(options))
  const trained = trainOne(tag, options)
  if (trained.ok !== true) {
    console.log('   TRAIN FAILED code=' + String(trained.code) + ' ' + show(trained.tail))
    rows.push({ stage, tag, options, ok: false, why: 'train failed', tail: trained.tail })
    return null
  }
  const scored = scoreOne(tag, trained.ckpt)
  if (scored.ok !== true) {
    console.log('   SCORE FAILED ' + show(scored.why))
    rows.push({ stage, tag, options, ok: false, why: 'score failed', detail: scored.why, wall: trained.wall })
    return null
  }
  // The scorer's own field names (docs/drss/R254-artifacts/score_val.py): mean_* over the frozen val scenes, and
  // n_negative_gain counts the scenes where the model lost to bicubic.
  const doc = scored.doc
  const row = {
    stage, tag, options, ok: true,
    gain_db: doc.mean_gain_db, val_psnr: doc.mean_model_psnr, bicubic: doc.mean_bicubic_psnr,
    params: doc.params, steps: doc.ckpt_step, wall: Math.round(trained.wall),
    beats: typeof doc.n_negative_gain === 'number' ? String(doc.n_scenes - doc.n_negative_gain) + '/' + String(doc.n_scenes) : null,
    worst: doc.worst_scene ?? null,
  }
  rows.push(row)
  console.log('   gain ' + String(row.gain_db) + ' dB (val ' + String(row.val_psnr) + ', bicubic ' + String(row.bicubic) + ')')
  return row
}

const best = (from) => {
  const ok = rows.filter((row) => row.ok === true && (from === undefined || from.includes(row.stage)))
  if (ok.length === 0) return null
  return ok.reduce((a, b) => (Number(a.gain_db) >= Number(b.gain_db) ? a : b))
}

const main = async () => {
  if (STAGE === 'confirm') {
    // R379: the winning operating point vs the R254 one, at the SAME seeds, so the comparison is paired. The
    // difference this measures is near the protocol's own reproducibility floor (0.03-0.05 dB), which is exactly why
    // one seed proves nothing and this stage exists.
    const winnerOptions = { '--steps': '200', '--lr': '3e-3', '--zero-init': '1', '--sd': '0' }
    const baselineOptions = { '--steps': '400' }
    for (const seed of ['1234', '7', '2026']) {
      runCandidate('confirm', 'c_winner_s' + seed, Object.assign({ '--seed': seed }, winnerOptions))
      runCandidate('confirm', 'c_base_s' + seed, Object.assign({ '--seed': seed }, baselineOptions))
    }
    const winners = rows.filter((row) => row.ok === true && row.tag.indexOf('c_winner') === 0)
    const bases = rows.filter((row) => row.ok === true && row.tag.indexOf('c_base') === 0)
    const mean = (list) => list.length === 0 ? null : list.reduce((sum, row) => sum + Number(row.gain_db), 0) / list.length
    const wMean = mean(winners)
    const bMean = mean(bases)
    console.log('')
    console.log('paired confirmation (' + String(winners.length) + ' winner seeds vs ' + String(bases.length) + ' baseline seeds):')
    console.log('  winner  mean gain = ' + String(wMean) + ' dB  ' + show(winners.map((row) => row.tag + '=' + Number(row.gain_db).toFixed(4))))
    console.log('  R254 OP mean gain = ' + String(bMean) + ' dB  ' + show(bases.map((row) => row.tag + '=' + Number(row.gain_db).toFixed(4))))
    console.log('  paired difference  = ' + (wMean === null || bMean === null ? 'n/a' : (wMean - bMean).toFixed(4) + ' dB'))
    const path = join(OUT, 'confirm.json')
    writeFileSync(path, JSON.stringify({ winner: winners, baseline: bases, winnerMean: wMean, baselineMean: bMean }, null, 2), 'utf8')
    console.log('written: ' + path)
    return winners.length > 0 && bases.length > 0 ? 0 : 1
  }
  const stages = STAGE === 'all' ? ['1', '2', '3'] : [STAGE]
  let winner = null
  if (stages.includes('1')) {
    for (const steps of ['100', '150', '200', '250', '300', '400']) {
      runCandidate('1', 's1_steps' + steps, { '--steps': steps })
    }
    winner = best(['1'])
    console.log('stage 1 winner: ' + show(winner === null ? null : { tag: winner.tag, gain: winner.gain_db, options: winner.options }))
  }
  if (stages.includes('2')) {
    const steps = winner === null || winner === undefined ? '200' : (winner.options['--steps'] ?? '200')
    for (const lr of ['1e-3', '2e-3', '3e-3', '5e-3', '8e-3']) {
      runCandidate('2', 's2_lr' + lr, { '--steps': steps, '--lr': lr })
    }
    runCandidate('2', 's2_zeroinit', { '--steps': steps, '--lr': winner === null || winner === undefined ? '3e-3' : (winner.options['--lr'] ?? '3e-3'), '--zero-init': '1' })
    winner = best(['1', '2'])
    console.log('stage 2 winner: ' + show(winner === null ? null : { tag: winner.tag, gain: winner.gain_db, options: winner.options }))
  }
  if (stages.includes('3')) {
    const steps = winner === null || winner === undefined ? '200' : (winner.options['--steps'] ?? '200')
    const lr = winner === null || winner === undefined ? '3e-3' : (winner.options['--lr'] ?? '3e-3')
    const extra = winner === null || winner === undefined ? {} : (winner.options['--zero-init'] === '1' ? { '--zero-init': '1' } : {})
    const axes = [
      ['dil2', { '--dil': '2' }],
      ['patch128', { '--patch': '128' }],
      ['patch64', { '--patch': '64' }],
      ['pw0', { '--pw-blocks': '0' }],
      ['sd0', { '--sd': '0' }],
      ['batch16', { '--batch': '16' }],
    ]
    for (const [name, options] of axes) {
      runCandidate('3', 's3_' + name, Object.assign({ '--steps': steps, '--lr': lr }, extra, options))
    }
    winner = best(['1', '2', '3'])
    console.log('stage 3 winner: ' + show(winner === null ? null : { tag: winner.tag, gain: winner.gain_db, options: winner.options }))
  }

  const ok = rows.filter((row) => row.ok === true).sort((a, b) => Number(b.gain_db) - Number(a.gain_db))
  const table = [
    '# R379 DRSS SR sweep - staged candidate selection on the frozen validation split',
    '',
    'Data: the existing frozen TRAIN split patch cache (repo own prep_patches.py output), reused read-only.',
    'Scoring: full-image PSNR on the 25 frozen validation scenes (repo own heldout_eval path), bicubic per run.',
    'Nothing under ' + REPO + ' was written.',
    '',
    '| rank | stage | candidate | val PSNR (dB) | bicubic (dB) | gain (dB) | params | steps | wall (s) |',
    '|---:|---|---|---:|---:|---:|---:|---:|---:|',
  ]
  ok.forEach((row, index) => {
    table.push('| ' + String(index + 1) + ' | ' + row.stage + ' | ' + row.tag + ' (' + Object.keys(row.options).map((key) => key + '=' + row.options[key]).join(' ') + ') | ' + String(row.val_psnr) + ' | ' + String(row.bicubic) + ' | ' + String(row.gain_db) + ' | ' + String(row.params) + ' | ' + String(row.steps) + ' | ' + String(row.wall) + ' |')
  })
  const failed = rows.filter((row) => row.ok !== true)
  if (failed.length > 0) {
    table.push('', '## Candidates that did not produce a number', '')
    for (const row of failed) table.push('- ' + row.tag + ': ' + String(row.why) + ' ' + show(row.detail ?? row.tail ?? ''))
  }
  table.push('', '## Anchors from R254 (same protocol)', '',
    '| candidate | gain (dB) | note |', '|---|---:|---|',
    '| A dw7pw w16 m32 L1, 400 steps | +0.3567 | the R254 operating point |',
    '| reference shipped checkpoint | +0.3908 | trained earlier, not retrained |')
  const path = join(OUT, 'SWEEP.md')
  writeFileSync(path, table.join('\n') + '\n', 'utf8')
  writeFileSync(join(OUT, 'sweep.json'), JSON.stringify({ ranAt: new Date().toISOString(), repo: REPO, cache: CACHE, rows }, null, 2), 'utf8')
  console.log('')
  console.log(table.join('\n'))
  console.log('')
  console.log('written: ' + path)
  return failed.length === 0 && ok.length > 0 ? 0 : 1
}

process.exitCode = await main()
