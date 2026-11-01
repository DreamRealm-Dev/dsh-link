#!/usr/bin/env node
/**
 * Build the Android APK the way this machine can actually do it (R323).
 *
 * Measured failure without this script:
 *
 *     npm run tauri -- android build --apk --debug --target x86_64
 *     -> tauri-plugin: failed to create .tauri directory: access denied (os error 5)
 *        (tauri-plugin-clipboard-manager-2.4.1/build.rs -> tauri_plugin::Builder::try_build())
 *     -> then, with .tauri pre-created by hand, the same denial one level deeper:
 *        failed to create directory <crate>/android/.tauri/tauri-api/
 *
 * The plugin build scripts write their native glue INSIDE their own crate in the cargo registry, and that path is not
 * writable from a spawned build here even though the interactive user can create directories in it. R232 and R249 built
 * the APK with a WRITABLE CARGO_HOME copy inside the workspace, and R306 deleted that copy as "unused" - which is
 * exactly why the builds stopped working. This script recreates it and sets the rest of the environment, so the recipe
 * is one command instead of five remembered variables.
 *
 * Usage: node scripts/build-android-apk.mjs [--target x86_64]
 * Exit: the build own exit code (0 with the APK path printed).
 */
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const REPO = resolve(PROJECT, '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => { const at = argv.indexOf('--' + name); return at === -1 ? fallback : argv[at + 1] }

const TARGET = flag('target', 'x86_64')
const CARGO_HOME = join(REPO, '.tmp', 'android-cargo-home')
const TEMP = join(PROJECT, '.tmp', 'android-temp')
const NDK = process.env.ANDROID_NDK_HOME ?? '<android-sdk>\\ndk\\27.3.13750724'
const SDK = process.env.ANDROID_HOME ?? '<android-sdk>'
const APK = join(PROJECT, 'src-tauri', 'gen', 'android', 'app', 'build', 'outputs', 'apk', 'universal', 'debug', 'app-universal-debug.apk')

const say = (line) => console.log('[apk] ' + line)

// The writable cargo home. Only `registry` is copied: bin/, git/ and the credentials are not needed to build, and the
// registry is the part the plugin build scripts write into.
if (!existsSync(CARGO_HOME)) {
  const source = join(homedir(), '.cargo', 'registry')
  if (!existsSync(source)) {
    console.error('[apk] no cargo registry at ' + source + ': nothing to copy, so the build would re-download every crate')
    process.exit(2)
  }
  say('copying ' + source + ' -> ' + join(CARGO_HOME, 'registry') + ' (the plugin build scripts must be able to write inside their own crate)')
  mkdirSync(CARGO_HOME, { recursive: true })
  cpSync(source, join(CARGO_HOME, 'registry'), { recursive: true })
  say('cargo home ready')
} else {
  say('reusing the workspace cargo home at ' + CARGO_HOME)
}
mkdirSync(TEMP, { recursive: true })

const env = {
  ...process.env,
  CARGO_HOME,
  // debug=0 keeps the fresh Android graph to a size this machine can hold, and -j 2 is what stops rustc from dying
  // with STATUS_STACK_BUFFER_OVERRUN under memory pressure (measured in R309).
  CARGO_PROFILE_DEV_DEBUG: '0',
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '2',
  ANDROID_HOME: SDK,
  ANDROID_SDK_ROOT: SDK,
  ANDROID_NDK_HOME: NDK,
  NDK_HOME: NDK,
  TEMP,
  TMP: TEMP,
}

say('building the APK for ' + TARGET + ' (cargo home ' + CARGO_HOME + ', ndk ' + NDK + ')')
const built = spawnSync('npm', ['run', 'tauri', '--', 'android', 'build', '--apk', '--debug', '--target', TARGET], {
  cwd: PROJECT,
  env,
  stdio: 'inherit',
  shell: true,
})
if (built.status !== 0) {
  console.error('[apk] the build failed with exit ' + String(built.status) + ' (see the output above)')
  process.exit(built.status ?? 1)
}
if (!existsSync(APK)) {
  console.error('[apk] the build reported success but there is no APK at ' + APK)
  process.exit(1)
}
const bytes = statSync(APK).size
say('APK ' + APK + ' (' + String(Math.round(bytes / 1024 / 1024)) + ' MB)')
say('install it with: adb -s 127.0.0.1:16384 install -r "' + APK + '"')
