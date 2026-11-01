#!/usr/bin/env node
/**
 * R506: the benchmark's --out claim must be atomic and must never rewrite an archive.
 *
 * Two properties are tested against the real bench-batched.mjs code path (via --reserve-only, so
 * the test is fast and does not need 12 benchmark children):
 *
 *   1. a pre-existing archive is never opened for writing or changed, even though the path is
 *      reused deliberately;
 *   2. N processes racing on the same --out produce exactly one winner (exit 0), the rest exit 1,
 *      and the published file is complete JSON with the winner's runId and no temp debris.
 *
 * Run: node --test rust/scripts/bench-out-atomic.spec.mjs
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const BENCH = join(HERE, 'bench-batched.mjs')

/** Run the bench in reserve-only mode and resolve its exit code. */
function reserve(outPath) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [BENCH, '--reserve-only', '--out', outPath], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => resolvePromise({ code, output }))
  })
}

test('a pre-existing archive is never rewritten', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-bench-archive-'))
  const outPath = join(directory, 'existing.json')
  const sentinel = '{"runId":"sentinel","keep":"me"}\n'
  writeFileSync(outPath, sentinel)
  try {
    const result = await reserve(outPath)
    assert.notEqual(result.code, 0, 'a second run on an existing archive must fail')
    assert.match(result.output, /refusing to overwrite an archived run/)
    assert.equal(readFileSync(outPath, 'utf8'), sentinel, 'the archived bytes must be untouched')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('concurrent runs on the same --out: exactly one wins', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-bench-race-'))
  const outPath = join(directory, 'raced.json')
  try {
    const results = await Promise.all([reserve(outPath), reserve(outPath), reserve(outPath), reserve(outPath)])
    const winners = results.filter((result) => result.code === 0)
    assert.equal(winners.length, 1, 'exactly one process may claim an output path: ' + JSON.stringify(results.map((result) => result.code)))
    for (const loser of results.filter((result) => result.code !== 0)) {
      assert.match(loser.output, /refusing to overwrite an archived run/)
    }
    const published = JSON.parse(readFileSync(outPath, 'utf8'))
    assert.equal(published.mode, 'reserve-only')
    assert.equal(typeof published.runId, 'string')
    assert.ok(String(published.runId).length > 0)
    const leftovers = readdirSync(directory).filter((name) => name.endsWith('.tmp'))
    assert.deepEqual(leftovers, [], 'no temp files may be left behind')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
