#!/usr/bin/env node
/**
 * Build the release installers without embedding this machine's home path.
 *
 * Rust writes panic locations into the binary, and registry crates are compiled from a path
 * below the user profile, so a plain release build leaves the account segment inside the
 * executable even when debug symbols are stripped. Remapping the checkout root and the profile
 * to placeholders keeps the artifact free of local identity. Flags go through
 * CARGO_ENCODED_RUSTFLAGS so a path with spaces cannot be re-split by the shell.
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = resolve(root, '..')
const home = process.env.USERPROFILE ?? ''
const remaps = [
  '--remap-path-prefix=' + workspace + '=<workspace>',
  ...(home === '' ? [] : ['--remap-path-prefix=' + home + '=<user>']),
]
const env = {
  ...process.env,
  CARGO_HTTP_CHECK_REVOKE: process.env.CARGO_HTTP_CHECK_REVOKE ?? 'false',
  // The unit separator is CARGO_ENCODED_RUSTFLAGS' flag delimiter.
  CARGO_ENCODED_RUSTFLAGS: remaps.join('\u001f'),
}
delete env.RUSTFLAGS
const result = spawnSync('pnpm', ['tauri', 'build'], { cwd: root, stdio: 'inherit', env, shell: true })
process.exit(result.status ?? 1)
