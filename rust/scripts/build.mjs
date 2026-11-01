#!/usr/bin/env node
/**
 * Build the napi addon and publish it where the host plugin looks for it.
 *
 *   node rust/scripts/build.mjs               acquire .build.lock, cargo build --release, copy
 *   node rust/scripts/build.mjs --skip-cargo  copy the existing target/release artifact only
 *
 * The addon is a cdylib; on Windows that is dsh_compute_napi.dll, on Linux
 * libdsh_compute_napi.so, on macOS libdsh_compute_napi.dylib. Node loads a renamed
 * .node file from the same bytes, so no @napi-rs/cli is needed to produce it.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RUST_ROOT = resolve(HERE, '..')
const REPO_ROOT = resolve(RUST_ROOT, '..')
const PLUGIN_LIB = join(REPO_ROOT, 'plugins', 'dsh-link-compute', 'lib')
const LOCK_DIR = join(REPO_ROOT, '.build.lock')
const RELEASE_DIR = join(RUST_ROOT, 'target', 'release')
const SKIP_CARGO = process.argv.includes('--skip-cargo')
const SLEEP_MS = 15_000
const MAX_WAIT_MS = 20 * 60_000

/** Sleep synchronously, so the lock acquisition cannot be interrupted by a timer. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Take the repository build lock, waiting for a peer that holds it. */
function acquireLock() {
  const deadline = Date.now() + MAX_WAIT_MS
  while (existsSync(LOCK_DIR)) {
    if (Date.now() > deadline) throw new Error('build lock still held after 20 minutes: ' + LOCK_DIR)
    sleep(SLEEP_MS)
  }
  mkdirSync(LOCK_DIR)
  console.log('build lock acquired: ' + LOCK_DIR)
}

/** Release the repository build lock. */
function releaseLock() {
  rmSync(LOCK_DIR, { recursive: true, force: true })
  console.log('build lock released')
}

/** The freshly built cdylib, per platform. */
function findArtifact() {
  const candidates = ['dsh_compute_napi.dll', 'libdsh_compute_napi.so', 'libdsh_compute_napi.dylib']
  for (const name of candidates) {
    const path = join(RELEASE_DIR, name)
    if (existsSync(path)) return path
  }
  throw new Error('no cdylib in ' + RELEASE_DIR + '; run without --skip-cargo')
}

let held = false
try {
  if (!SKIP_CARGO) {
    acquireLock()
    held = true
    const cargo = spawnSync('cargo', ['build', '-p', 'dsh-compute-napi', '--release'], {
      cwd: RUST_ROOT,
      stdio: 'inherit',
      shell: false,
    })
    if (cargo.error) throw cargo.error
    if (cargo.status !== 0) throw new Error('cargo build failed with exit code ' + String(cargo.status))
  }
  const artifact = findArtifact()
  mkdirSync(PLUGIN_LIB, { recursive: true })
  const target = join(PLUGIN_LIB, 'dsh_compute.node')
  copyFileSync(artifact, target)
  const bytes = statSync(target).size
  const digest = createHash('sha256').update(readFileSync(target)).digest('hex').slice(0, 16)
  console.log('addon: ' + artifact)
  console.log('addon: ' + target + ' (' + String(bytes) + ' bytes, sha256:' + digest + ')')
} finally {
  if (held) releaseLock()
}
