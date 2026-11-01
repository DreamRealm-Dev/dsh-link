#!/usr/bin/env node
/**
 * Gate 150 host-embed-crate - requirement D's entry point, held to the tree (offline).
 *
 * R281 made DSH-LINK enterable by ANOTHER Tauri application: a crate it can depend on (pub mod embed), a way in
 * with its own configuration (embed::run_with), and a window label that is not hard-coded. The compile that proves
 * it is cargo check --lib (exit 0 on this machine, recorded in docs/handoff/R281-handoff.md), and a compile cannot
 * run inside an offline gate: it needs the toolchain, the registry and minutes. What CAN be held offline is the
 * shape those three things have in the tree, so a later edit cannot quietly undo them.
 *
 * Readings:
 *   1  the module exists and is the crate's public entry      src-tauri/src/embed.rs behind pub mod embed
 *   2  the configuration a host hands in is what README says  HostEmbed with a window_label field, an application
 *                                                             default of "main", and a with_window_label builder
 *   3  the entry records once and runs ONE path               run_with -> install (refuses a second install) ->
 *                                                             crate::run(); run() installs the default and calls
 *                                                             run_configured(), the same function
 *   4  no window lookup still hard-codes "main"               every get_webview_window/get_window/get_webview call
 *                                                             in src-tauri/src asks embed::window_label(); the two
 *                                                             remaining "main" literals are the TRAY's id
 *   5  the unit tests that pin the contract exist             four #[test] fns in embed.rs
 *   6  a HOST binary outside the crate calls the entry        src-tauri/examples/host_embed.rs
 *   7  a second APPLICATION binary of the package embeds it   src-tauri/src/bin/host_demo.rs
 *   8  the configuration can name a window the host built     HostEmbed.attach_to + attached_to() (R309)
 *   9  the shell attaches INTO that window                    build_window branches on it and
 *                                                             attach_into_host_window calls Window::add_child; a
 *                                                             label that names no window is a named error, and
 *                                                             the attach path builds no window of its own
 *  10  a host that owns its own builder can enter the shell   crate::builder() + crate::boot() +
 *                                                             handle_run_event(), re-exported from embed, and
 *                                                             run_configured() uses the same two (one path)
 *  11  the host APPLICATION is a crate of its own              src-tauri/host-app: own Cargo.toml depending on
 *                                                             this crate, own tauri.conf.json identifier, own
 *                                                             setup that builds the window, listed as a
 *                                                             workspace member of src-tauri/Cargo.toml (R309)
 *
 * R73 alive-control: EXEMPT, with the reason - nothing here boots: it reads four files off the tree and answers which
 * facts they hold, so there is no composition whose liveness could be sampled, and a missing file is a named red.
 *
 * Usage: node scripts/verify-host-embed-crate.mjs [--json]
 * Exit: 0 every reading held | 1 a reading failed | 3 a file the gate needs is absent (named).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EMBED = join(PROJECT, 'src-tauri', 'src', 'embed.rs')
const LIB = join(PROJECT, 'src-tauri', 'src', 'lib.rs')
const SHELLPREFS = join(PROJECT, 'src-tauri', 'src', 'core', 'shellprefs.rs')
const PANEL = join(PROJECT, 'src-tauri', 'src', 'core', 'sidebar_panel.rs')

const readings = []
const held = (id, name, ok, detail) => readings.push({ id, name, ok: ok === true, detail: String(detail) })
const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null)

const embed = read(EMBED)
const lib = read(LIB)
const prefs = read(SHELLPREFS)
const panel = read(PANEL)
if (embed === null || lib === null || prefs === null || panel === null) {
  const missing = [['embed.rs', embed], ['lib.rs', lib], ['shellprefs.rs', prefs], ['sidebar_panel.rs', panel]].filter(([, text]) => text === null).map(([name]) => name)
  console.log('SKIP: the crate sources this gate reads are not on this tree (' + missing.join(', ') + '): requirement D has nothing to hold here')
  process.exit(3)
}

const main = () => {
  held('1', 'the embed module is declared public and lives in its own file',
    /^pub mod embed;\s*$/m.test(lib) && /pub struct HostEmbed/.test(embed),
    'pub mod embed=' + String(/^pub mod embed;\s*$/m.test(lib)) + ' HostEmbed=' + String(/pub struct HostEmbed/.test(embed)))

  const hasLabel = /pub\s+window_label\s*:\s*String/.test(embed)
  const defaultMain = /impl Default for HostEmbed[\s\S]{0,200}?String::from\("main"\)/.test(embed)
  const builder = /pub fn with_window_label\s*\(\s*label:\s*impl Into<String>\s*\)\s*->\s*Self/.test(embed)
  held('2', 'the configuration carries the window label, defaults to the application label, and can be built with another',
    hasLabel && defaultMain && builder,
    'field=' + String(hasLabel) + ' default-main=' + String(defaultMain) + ' builder=' + String(builder))

  const runWithInstalls = /pub fn run_with\(\s*config:\s*HostEmbed\s*\)\s*\{[\s\S]{0,900}?install\(config\)[\s\S]{0,400}?crate::run\(\)/.test(embed)
  const installOnce = /CONFIG\.set\(next\)/.test(embed)
  const runInstallsDefault = /pub fn run\(\)\s*\{\s*\n\s*embed::install\(embed::HostEmbed::default\(\)\)\.ok\(\);\s*\n\s*run_configured\(\)/.test(lib)
  const onePath = /fn run_configured\(\)\s*\{/.test(lib)
  held('3', 'run_with records the configuration once and then runs the ONE application entry point',
    runWithInstalls && installOnce && runInstallsDefault && onePath,
    'run_with->install->run=' + String(runWithInstalls) + ' once=' + String(installOnce) + ' run()->run_configured()=' + String(runInstallsDefault) + ' single-path=' + String(onePath))

  // Every window lookup in the crate must ask the label. A literal left beside them is the bug this reading exists for.
  const sources = [lib, prefs, panel]
  const literals = sources.map((text) => (text.match(/get_webview_window\("main"\)|get_window\("main"\)|get_webview\("main"\)/g) ?? []).length).reduce((a, b) => a + b, 0)
  // R309: the lookups now ask the embed module for a LABEL, a WINDOW or a WEBVIEW - the last two are what let an
  // attached shell find the host's window at all - so all three count as "asks the embed module".
  const asks = sources.map((text) => (text.match(/embed::window_label\(\)|embed::window\(|embed::webview\(/g) ?? []).length).reduce((a, b) => a + b, 0)
  const trayIds = (lib.match(/TrayIconBuilder::with_id\("main"\)|tray_by_id\("main"\)/g) ?? []).length
  held('4', 'no window lookup still hard-codes the label; the only remaining literals are the tray id',
    literals === 0 && asks >= 5 && trayIds === 2,
    'hard-coded-window-lookups=' + String(literals) + ' asks-embed=' + String(asks) + ' tray-id-literals=' + String(trayIds))

  const tests = (embed.match(/#\[test\]/g) ?? []).length
  held('5', 'the unit tests that pin this contract are in the file', tests >= 3, '#[test] fns=' + String(tests))

  // R297: a host BINARY, outside the crate, calling the entry with a label of its own. The compile is the evidence
  // (cargo check --example host_embed exit 0, recorded in docs/handoff/R297-host-example.md); this reading holds the
  // source shape so the example cannot rot into a comment.
  const EXAMPLE = join(PROJECT, 'src-tauri', 'examples', 'host_embed.rs')
  const example = existsSync(EXAMPLE) ? readFileSync(EXAMPLE, 'utf8') : null
  const callsRunWith = example !== null && /dsh_link_lib::embed::run_with\(config\)/.test(example)
  const namesALabel = example !== null && /HostEmbed::with_window_label\("host-main"\)/.test(example)
  // R300: a second APPLICATION (a real [[bin]] target of the package, not just an example), which is what "another
  // Tauri application embeds this" means in build terms. Cargo picks up src/bin/*.rs, so its presence plus the call is
  // the fact; the compile (cargo check --bin host_demo exit 0) is cited in docs/handoff/R300-second-app.md.
  const BIN = join(PROJECT, 'src-tauri', 'src', 'bin', 'host_demo.rs')
  const bin = existsSync(BIN) ? readFileSync(BIN, 'utf8') : null
  const binLabel = bin !== null && /--window-label=/.test(bin)
  const binCalls = bin !== null && /dsh_link_lib::embed::run_with\(/.test(bin)
  held('7', 'a second APPLICATION binary of the package embeds it and takes its label from the command line',
    bin !== null && binLabel && binCalls,
    bin === null ? 'no src-tauri/src/bin/host_demo.rs' : 'label-argument=' + String(binLabel) + ' calls-run_with=' + String(binCalls))

  held('6', 'a HOST binary outside the crate calls the entry point with a window label of its own',
    example !== null && callsRunWith && namesALabel,
    example === null ? 'no src-tauri/examples/host_embed.rs' : 'calls-run_with=' + String(callsRunWith) + ' own-label=' + String(namesALabel))

  // R309: requirement D's last boundary. The configuration can now name a window the HOST built, and the shell
  // attaches its webview INTO it instead of building one. Three faces of that in the tree, each read literally.
  const attachField = /pub\s+attach_to\s*:\s*Option<String>/.test(embed)
  const attachDefault = /impl Default for HostEmbed[\s\S]{0,260}?attach_to:\s*None/.test(embed)
  const attachBuilder = /pub fn attached_to\s*\(\s*mut self,\s*host_window:\s*impl Into<String>\s*\)\s*->\s*Self/.test(embed)
  held('8', 'the configuration can name a window the host already built, and attaches to nothing by default',
    attachField && attachDefault && attachBuilder,
    'attach_to: Option<String>=' + String(attachField) + ' default-none=' + String(attachDefault) + ' attached_to()=' + String(attachBuilder))

  const branchOnAttach = /if let Some\(host_label\) = embed::config\(\)\.attach_to \{[\s\S]{0,400}?return attach_into_host_window\(handle, &host_label, url\)/.test(lib)
  const attachStart = lib.indexOf('fn attach_into_host_window(')
  const attachBody = attachStart < 0 ? '' : lib.slice(attachStart, attachStart + 4000)
  const addsChild = /host\.add_child\(/.test(attachBody) && /auto_resize\(\)/.test(attachBody)
  const keepsFences = /on_navigation\(/.test(attachBody) && /on_new_window\(/.test(attachBody)
  const noOwnWindow = !/WebviewWindowBuilder::new/.test(attachBody) && !/decoration|shadow\(|\.center\(\)/i.test(attachBody)
  const namedRefusal = /names a window this application does not have/.test(lib)
  held('9', 'the shell attaches INTO the host window: a child webview with both fences, a named refusal, no window of its own',
    branchOnAttach && addsChild && keepsFences && noOwnWindow && namedRefusal,
    'branch=' + String(branchOnAttach) + ' add_child+auto_resize=' + String(addsChild) + ' fences=' + String(keepsFences) + ' no-own-window=' + String(noOwnWindow) + ' named-refusal=' + String(namedRefusal))

  const builderFn = /pub fn builder\(\) -> tauri::Builder<tauri::Wry> \{/.test(lib)
  const bootFn = /pub fn boot\(app: &tauri::AppHandle\) -> Result<\(\), Box<dyn std::error::Error>> \{/.test(lib)
  const runEventFn = /pub fn handle_run_event\(app_handle: &tauri::AppHandle, event: tauri::RunEvent\) \{/.test(lib)
  const reExported = /pub use crate::\{boot, builder, handle_run_event\}/.test(embed)
  const bootIntoHost = /pub fn boot_into_host\(\s*\n?\s*app: &tauri::AppHandle,/.test(embed)
  const singleEntryPath = /fn run_configured\(\)[\s\S]{0,1200}?builder\(\)\.setup\(\|app\| boot\(app\.handle\(\)\)\)[\s\S]{0,600}?handle_run_event\(app_handle, event\)/.test(lib)
  held('10', 'a host that owns its own builder enters through builder() + boot_into_host(), and both entries run ONE path',
    builderFn && bootFn && runEventFn && reExported && bootIntoHost && singleEntryPath,
    'builder()=' + String(builderFn) + ' boot()=' + String(bootFn) + ' run-event=' + String(runEventFn) + ' re-export=' + String(reExported) + ' boot_into_host=' + String(bootIntoHost) + ' one-path=' + String(singleEntryPath))

  // R309: the host is an APPLICATION of its own - a separate crate in this workspace, with its own identifier and
  // its own setup - not a third binary of the shell package. That is what makes the claim build-shaped.
  const ROOT_CARGO = join(PROJECT, 'src-tauri', 'Cargo.toml')
  const HOST_DIR = join(PROJECT, 'src-tauri', 'host-app')
  const rootCargo = existsSync(ROOT_CARGO) ? readFileSync(ROOT_CARGO, 'utf8') : null
  const hostCargo = existsSync(join(HOST_DIR, 'Cargo.toml')) ? readFileSync(join(HOST_DIR, 'Cargo.toml'), 'utf8') : null
  const hostMain = existsSync(join(HOST_DIR, 'src', 'main.rs')) ? readFileSync(join(HOST_DIR, 'src', 'main.rs'), 'utf8') : null
  const hostConf = existsSync(join(HOST_DIR, 'tauri.conf.json')) ? readFileSync(join(HOST_DIR, 'tauri.conf.json'), 'utf8') : null
  const member = rootCargo !== null && /members\s*=\s*\[[^\]]*"host-app"/.test(rootCargo)
  const dependsOnShell = hostCargo !== null && /dsh-link\s*=\s*\{\s*path\s*=\s*"\.\."\s*\}/.test(hostCargo)
  const ownIdentifier = hostConf !== null && /"identifier"\s*:\s*"dev\.dshlink\.host"/.test(hostConf)
  const buildsItsOwnWindow = hostMain !== null && /tauri::WindowBuilder::new\(app, window_label\.as_str\(\)\)/.test(hostMain)
  const bootsIntoIt = hostMain !== null && /boot_into_host\(/.test(hostMain) && /attached_to\(attach_to\)/.test(hostMain)
  const runsShellEvents = hostMain !== null && /embed::handle_run_event\(app, event\)/.test(hostMain)
  const missing = [hostCargo === null ? 'Cargo.toml' : null, hostMain === null ? 'src/main.rs' : null, hostConf === null ? 'tauri.conf.json' : null].filter(Boolean)
  held('11', 'the host is its OWN application crate in this workspace: own dependency, own identifier, own window, own setup',
    missing.length === 0 && member && dependsOnShell && ownIdentifier && buildsItsOwnWindow && bootsIntoIt && runsShellEvents,
    missing.length > 0 ? 'missing in src-tauri/host-app: ' + missing.join(', ')
      : 'workspace-member=' + String(member) + ' depends-on-shell=' + String(dependsOnShell) + ' own-identifier=' + String(ownIdentifier) + ' own-window=' + String(buildsItsOwnWindow) + ' boot_into_host=' + String(bootsIntoIt) + ' run-events=' + String(runsShellEvents))

  for (const reading of readings) console.log((reading.ok ? 'ok    ' : 'FAIL  ') + reading.id + ' ' + reading.name + ' | ' + reading.detail)
  const failed = readings.filter((reading) => reading.ok !== true)
  console.log('')
  console.log('host-embed-crate: ' + String(readings.length) + ' readings, ' + String(readings.length - failed.length) + ' held, ' + String(failed.length) + ' failed')
  console.log('note: the COMPILE is the evidence for all of this (R309: cargo check --lib exit 0; --bin host_demo exit 0;')
  console.log('      --example host_embed exit 0; -p host-app exit 0 in 2.07 s with NO dependency rebuilt; cargo test --lib')
  console.log('      embed 4 passed; the Android lib check is a NAMED THIRD STATE - see docs/handoff/DELIVERY-ASSESSMENT.md,')
  console.log('      R309). This gate only stops the tree from drifting away from what those compiles measured.')
  return failed.length === 0 ? 0 : 1
}

process.exitCode = main()
