#!/usr/bin/env node
/**
 * Build the plugins in this directory.
 *
 *   node plugins/build.mjs            build lib/ for every plugin
 *   node plugins/build.mjs --check    fail if lib/ differs from a fresh build
 *
 * Two artifacts per plugin, because a dsh plugin has two halves with different
 * module contracts:
 *
 *   lib/index.js   the Host half: ESM for Node, with the harness packages it
 *                  shares left external so the running kernel's own instances
 *                  are the ones used.
 *   lib/client.js  the browser half: a CommonJS body wrapped in the
 *                  `window.__ModuleLoader__.load` registration the client
 *                  module system serves. Everything the web shell preloads
 *                  (react, react/jsx-runtime, client-store, ui-slots,
 *                  ui-primitives, dockkit, cordis — see
 *                  packages/client/web/src/platform.ts) stays external and is
 *                  resolved from the module table at run time; nothing else is.
 *
 * Stylesheets are imported as text (`--loader:.css=text`), so a half carries
 * its CSS in its own bundle and mounts it for its own lifetime. There is no
 * bundler configuration shared with the kernel: this script is the whole build.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))

/** One plugin: the directory (and package) name, and its browser-half entry. */
const PLUGINS = [
  // `client` is the browser-half entry, or null for a Host-only plugin.
  { name: 'dsh-liquid-glass', client: 'src/client/index.ts' },
  { name: 'dsh-theme-settings', client: 'src/client/index.tsx' },
  { name: 'dsh-continue-button', client: 'src/client/index.tsx' },
  { name: 'dsh-link-brand', client: 'src/client/index.tsx' },
  // Host-only: the compat loader has no browser half, so the client entry is null
  // and only lib/index.js is written for it.
  { name: 'dsh-link-compat', client: null },
  // Both halves: the host half publishes the control channel beside the kernel's own Agent Teams
  // service AND serves the one read-only status route; the client half is the LINK panel's status row
  // (kind 'status'), which reads that route and republishes through the seam's own notify() when the
  // reading moves.
  { name: 'dsh-link-collab', client: 'src/client/index.ts' },
  // Host-only: the state-layout migration engine. It has no kernel surface of its own this round —
  // it is a library of pure functions the gate imports — so it is built but not patched into a row.
  { name: 'dsh-link-upgrade', client: null },
  // Host-only: notes whose data lives outside the process. It reuses the collaboration bus's ledger
  // and winning rule, so that one import stays external and resolves to the bus's own built module —
  // bundling it would put a second copy of that rule inside this package, which is the thing this
  // round forbids. `external` is per plugin: a plugin that shares nothing declares none.
  { name: 'dsh-link-notes', client: null, external: ['../../dsh-link-collab/lib/index.js'] },
  // Both halves: the host half re-exports the band table and the two seams, and the client half is
  // what watches the viewport and writes the decisions onto the document root.
  { name: 'dsh-link-responsive', client: 'src/client/index.tsx' },
  // Both halves: the host half only lets the row resolve, and the client half registers the LINK
  // entry into the conversation header's action slot.
  { name: 'dsh-link-toolbar', client: 'src/client/index.tsx' },
  // Host-only: the tool-group kernel installs into agent scopes and publishes no UI, so a browser
  // half would add an icon/locale surface the package does not need.
  { name: 'dsh-link-groups', client: null },
  // Both halves: the host half only lets the row resolve, and the client half registers the right
  // Sidebar's `markdown` tab type (read-only .md/.markdown rendering on the kernel's own markdown
  // pipeline). Built last, and appended rather than inserted, so nothing above this line moves.
  { name: 'dsh-link-markdown', client: 'src/client/index.tsx' },
  // Both halves: the host half is the registry's floor (items are data, the projection is pure, one
  // read-only route), and the client half is the right-rail pane of kind `pane` that draws the visible
  // items, the refusals by name, and the note ledger with its one-note write box.
  { name: 'dsh-link-panel', client: 'src/client/index.tsx' },
  // Both halves: the host half is the ONE read-only world route over the collaboration bus's fold, and
  // the client half is the right-rail "智能体团队" pane that draws it. R196: the package was hand-written
  // under lib/ and outside this list, so no build ever compared its artifact with its source; it is
  // built last and appended, so nothing above this line moves.
  { name: 'dsh-link-teams', client: 'src/client/index.tsx' },
  // Host-only: the Rust compute provider (napi-rs addon, optional). The host half publishes
  // ctx.linkCompute, loads lib/dsh_compute.node when present, and falls back to the pure-TS reference;
  // the addon itself is built by rust/scripts/build.mjs and never committed. Appended last so nothing
  // above this line moves. Default disabled: registering the row does not change DSH behavior.
  { name: 'dsh-link-compute', client: null },
  // R493/R501: B2 chat live-tail window prototype. Default OFF; the client half only sets the
  // optional global policy object the R501 kernel client patch reads, so registering it without
  // enabling it changes nothing. Appended last so nothing above this line moves.
  { name: 'dsh-link-chat-window', client: 'src/client/index.ts' },
  // Host-only, and there is no browser half on purpose: what this package serves IS a page, written as
  // bytes in src/index.ts so the artifact needs no build step of its own - a host's child webview loads
  // /api/dsh-link-host/embed and the served document is the whole surface (R195-contract.md section 2,
  // P1). Built last and appended, so nothing above this line moves.
  { name: 'dsh-link-host', client: null },
  // Both halves: the host half is the /link/v1 protocol, the identity, the declarative adapter
  // runtime and the capability bindings; the client half is the consent card and the peers surface.
  // Appended rather than inserted, so nothing above this line moves.
  { name: 'dsh-link-interconnect', client: 'src/client/index.tsx' },
]

/**
 * Module-table specifiers the web shell preloads; never bundled.
 *
 * The list is data: compat/host-modules.json carries it, and scripts/check-plugin-contract.mjs reads the
 * same file, so the build and the contract cannot drift apart on what the host provides.
 */
const CLIENT_BASELINE = JSON.parse(await readFile(join(HERE, '..', 'compat', 'host-modules.json'), 'utf8')).clientBaseline

/** Packages the Host half must resolve to the kernel's own instances. */
const HOST_EXTERNAL = ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-scope']

const check = process.argv.includes('--check')

/** Optional single-plugin scope, so a hot fix rebuilds only the artifact the kernel watches. */
const onlyIndex = process.argv.indexOf('--only')
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined

/** Build one half and return its text. */
async function bundle(entry, options) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, logLevel: 'warning', ...options })
  return result.outputFiles[0].text
}

/** Read an artifact, or undefined when it has never been written. */
async function readIfPresent(path) {
  try { return await readFile(path, 'utf8') } catch { return undefined }
}

/** Build the halves a plugin declares and return their target paths and text. */
async function buildPlugin(name, clientEntry, extraExternal = []) {
  const root = join(HERE, name)
  const artifacts = []
  if (clientEntry !== null) {
    const client = await bundle(join(root, clientEntry), {
      format: 'cjs',
      platform: 'browser',
      // The oldest engine the shell's WebView2 ships is Chromium 154; the material
      // uses :has(), color-mix() and backdrop-filter: url(), so the target is a
      // floor for syntax only.
      target: 'chrome120',
      jsx: 'automatic',
      external: CLIENT_BASELINE,
      loader: { '.css': 'text', '.svg': 'text' },
      legalComments: 'inline',
    })
    const wrapped = 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(name)
      + ', factory: (require) => { var module = { exports: {} }; var exports = module.exports;\n'
      + client
      + '\nreturn module.exports; } });\n'
    artifacts.push({ path: join(root, 'lib/client.js'), text: wrapped })
  }
  const host = await bundle(join(root, 'src/index.ts'), {
    format: 'esm',
    platform: 'node',
    target: 'node22',
    external: [...HOST_EXTERNAL, ...extraExternal],
    legalComments: 'inline',
  })
  artifacts.push({ path: join(root, 'lib/index.js'), text: host })
  return artifacts
}

let drifted = 0
for (const plugin of PLUGINS) {
  if (only !== undefined && plugin.name !== only) continue
  for (const artifact of await buildPlugin(plugin.name, plugin.client, plugin.external)) {
    const before = await readIfPresent(artifact.path)
    const relative = artifact.path.slice(HERE.length + 1).replaceAll('\\', '/')
    if (check) {
      if (before !== artifact.text) {
        console.error('stale: ' + relative + ' (run: node plugins/build.mjs)')
        drifted += 1
      } else {
        console.log('ok: ' + relative)
      }
      continue
    }
    await mkdir(dirname(artifact.path), { recursive: true })
    await writeFile(artifact.path, artifact.text)
    console.log((before === undefined ? 'created ' : 'wrote   ') + relative + '  ' + artifact.text.length + ' bytes')
  }
}

if (check && drifted > 0) {
  console.error(drifted + ' artifact(s) differ from a fresh build')
  process.exit(1)
}
