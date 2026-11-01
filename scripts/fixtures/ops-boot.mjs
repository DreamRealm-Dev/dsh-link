import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'

/**
 * R119 (T54) driver: what does mounting the third-party bundle dsh-ops actually do to a composition?
 *
 * It boots the same way scripts/fixtures/t52-boot.mjs does (env interface: marker + the two kernel entry
 * URLs), then records RAW facts: whether the composition settled, which tools the kernel's own registry
 * publishes (_ops names included), what our own compat layer sees, and whether any plugin printed a
 * failure line on the way. It decides nothing - the judge owns every expectation.
 *
 * It carries its own liveness CONTROL readings, as scripts/fixtures/acceptance-boot.mjs does: the root
 * service dshHomePath is read after settle and after dispose, so verify-probe-alive-control can tell
 * "this probe was alive" from "this probe was silent".
 *
 * --no-open is passed: a driver that pops a browser window on the machine running the gate is a defect
 * this repository already paid for (R118).
 */
const marker = process.env.T54_MARKER ?? process.env.T52_MARKER ?? process.env.R91_MARKER
if (marker === undefined || marker === '') { console.error('ops-boot: no marker path'); process.exit(3) }
const appBootUrl = process.env.T54_APP_BOOT ?? process.env.T52_APP_BOOT ?? process.env.R91_APP_BOOT
const profileBootUrl = process.env.T54_PROFILE_BOOT ?? process.env.T52_PROFILE_BOOT ?? process.env.R91_PROFILE_BOOT
if (appBootUrl === undefined || profileBootUrl === undefined) { console.error('ops-boot: missing kernel entry URLs'); process.exit(3) }
const profile = process.env.T54_PROFILE ?? process.env.T52_PROFILE ?? process.env.R91_PROFILE ?? 'web'
// The managed runtime directory dsh-ops reads (lib/binary.js): <DSH_HOME>/dsh-ops/bin. Read here only to
// say in the marker whether this world was provisioned - the driver never creates it.
const dshHome = process.env.DSH_HOME ?? ''
// R123: the product's own token accounting. @deepseek-ai/dsh-token-meter/estimate prices content at a
// fixed density (4 chars per token plus per-block overhead) and says so in its own header: it is the number
// the token meter shows, NOT a model tokenizer. The gate passes its module URL; without it the reading says
// so instead of guessing.
const tokenMeterUrl = process.env.T54_TOKEN_METER ?? ''
let priceContent = null
if (tokenMeterUrl !== '') {
  try { priceContent = (await import(tokenMeterUrl)).estimateContent } catch (error) { note('ops.tokens.import-failed', refusal(error)) }
}
mkdirSync(dirname(marker), { recursive: true })
const note = (event, extra = {}) => appendFileSync(marker, JSON.stringify({ event, ...extra }) + '\n')
const refusal = (error) => ({ name: error?.name ?? typeof error, message: String(error?.message ?? error).slice(0, 200) })
const aliveRoot = (ctx) => { try { return ctx.reflect.get('dshHomePath', false) !== undefined } catch (error) { return 'threw:' + String(error?.name ?? error) } }
// R124: WHO is left running when this composition is disposed. R123 recorded "a fastctx process survives
// the boot" and attributed it to the plugin; the attribution was never measured. These rows are pid,
// parent pid and command line, so the judge can tell the plugin's own MCP server (a child of THIS
// process, args 'serve --enable-shell') from a process this process never started (the payload's
// 'runtime-host'), instead of blaming the nearest thing called fastctx. Raw facts; the judge decides.
const fastctxTree = () => {
  const query = "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'fastctx.exe' } | ForEach-Object { \"$($_.ProcessId)|$($_.ParentProcessId)|$($_.CommandLine)\" } | Out-String"
  const out = spawnSync('powershell', ['-NoProfile', '-Command', query], { encoding: 'utf8' })
  return String(out.stdout ?? '').trim().split(/\r?\n/).map((row) => row.trim()).filter((row) => row !== '')
}
const schemaNames = (schemas) => Array.isArray(schemas)
  ? schemas.map((row) => (typeof row?.name === 'string' ? row.name : typeof row?.definition?.name === 'string' ? row.definition.name : null)).filter((name) => typeof name === 'string')
  : null
try {
  const appBoot = await import(appBootUrl)
  const boot = await import(profileBootUrl)
  const result = await boot.runProfile({ environment: appBoot.loadLayeredEnv('dsh'), profile, patchFiles: [], args: ['--host', '127.0.0.1', '--port', '0', '--no-open'] })
  const ctx = result.ctx
  note('control.settled', { rootAlive: aliveRoot(ctx) })
  note('ops.tree.settled', { rows: fastctxTree(), self: process.pid })
  const tools = ctx.get('tools')
  note('tools.service', { hasTools: tools !== undefined, hasSchemas: typeof tools?.schemas === 'function', hasRegister: typeof tools?.register === 'function', hasExecute: typeof tools?.execute === 'function' })
  let names = null
  try { names = schemaNames(tools?.schemas?.()) } catch (error) { note('tools.schemas.threw', refusal(error)) }
  note('tools.names', {
    count: names === null ? -1 : names.length,
    ops: names === null ? null : names.filter((name) => name.startsWith('ops_')),
    hasPwsh: names === null ? null : names.includes('pwsh'),
    hasBash: names === null ? null : names.includes('ops_bash'),
    sample: names === null ? null : names.slice(0, 15),
  })
  // R125: which copies the plugin would actually use. Both answers come from the plugin's OWN resolvers
  // (lib/binary.js, lib/shells.js) called with two environments that differ in exactly one variable -
  // DSH_HOME - because the provisioned store lives under it. One boot, one variable, two answers; the
  // ladder's 'tried' list stays visible instead of only its winner.
  const binaryModule = process.env.T54_BINARY_MODULE ?? ''
  const shellsModule = process.env.T54_SHELLS_MODULE ?? ''
  const emptyHome = process.env.T54_EMPTY_HOME ?? ''
  if (binaryModule !== '' || shellsModule !== '') {
    const describeShell = (answer) => ({ available: answer?.available ?? null, source: answer?.source ?? null, file: answer?.file ?? null, detail: answer?.detail ?? null })
    let binary = null
    if (binaryModule !== '') {
      try {
        const { resolveBinary, BINARY_ENV } = await import(binaryModule)
        note('ops.copies.seam', { env: BINARY_ENV, set: typeof process.env[BINARY_ENV] === 'string' })
        try { const resolved = resolveBinary({ env: process.env, platform: process.platform, arch: process.arch }); binary = { file: resolved.file, source: resolved.source, tried: resolved.tried?.map((row) => row.source) ?? null } }
        catch (error) { binary = { threw: error?.name ?? 'Error' } }
      } catch (error) { note('ops.copies.binary.threw', refusal(error)) }
    }
    let shells = null
    if (shellsModule !== '') {
      try {
        const { resolveShells } = await import(shellsModule)
        const config = { publishBashTool: true, allowSystemShellFallback: true }
        const here = resolveShells(config, { env: process.env, platform: process.platform, arch: process.arch })
        const there = emptyHome === '' ? null : resolveShells(config, { env: { ...process.env, DSH_HOME: emptyHome }, platform: process.platform, arch: process.arch })
        shells = { bash: describeShell(here.bash), pwsh: describeShell(here.pwsh), unprovisionedHome: emptyHome, bashWithoutStore: there === null ? null : describeShell(there.bash), pwshWithoutStore: there === null ? null : describeShell(there.pwsh) }
      } catch (error) { note('ops.copies.shells.threw', refusal(error)) }
    }
    note('ops.copies', { binary, shells, dshHome: process.env.DSH_HOME ?? null })
  }
  // The shell component publishes its bash tool per AGENT (lib/session-shells.js:5-50), not into the
  // global registry, and only for an agent whose sandbox mode is danger-full-access. Whether this world
  // has such an agent is therefore a premise, recorded here as a number rather than assumed.
  try {
    const agents = ctx.get('agents')?.list?.() ?? []
    note('agents.inventory', { count: agents.length, opsBash: agents.map((agent) => (ctx.get('tools').schemas(agent) ?? []).map((row) => row.name).filter((name) => name === 'ops_bash').length) })
  } catch (error) { note('agents.inventory.threw', refusal(error)) }
  const compat = ctx.link && ctx.link.compat
  const simple = compat && compat.simple
  note('compat.visible', { hasCompat: compat !== undefined, hasSimple: simple !== undefined, compatRowMounted: compat !== undefined })
  try {
    const compatNames = simple ? simple.tools.names() : null
    note('compat.tools', { count: compatNames === null ? -1 : compatNames.length, ops: compatNames === null ? null : compatNames.filter((name) => name.startsWith('ops_')) })
  } catch (error) { note('compat.tools.threw', refusal(error)) }
  // R121 (T54): when the ops tools are really present (a provisioned runtime), run them and record what
  // the MODEL would see - the rendered content and its byte size - because "saves tokens" is a claim about
  // exactly that number. In the unprovisioned world that gate #88 uses, this records an explicit skip with
  // the reason instead, so the driver stays honest in both worlds rather than silently doing nothing.
  const opsTools = names === null ? [] : names.filter((name) => name.startsWith('ops_'))
  const schemaOf = (list, name) => (Array.isArray(list) ? list.find((row) => (row?.name ?? row?.definition?.name) === name) : undefined)
  if (opsTools.length === 0) {
    note('ops.exec.skipped', { reason: 'no ops_ tools in this registry', runtimeProvisioned: existsSync(join(dshHome, 'dsh-ops', 'bin')) })
  } else {
    let schemas = null
    try { schemas = tools?.schemas?.() } catch (error) { note('ops.schemas.threw', refusal(error)) }
    for (const name of opsTools) {
      const schema = schemaOf(schemas, name)
      note('ops.schema', { tool: name, parameters: schema?.parameters ?? schema?.inputSchema ?? schema?.definition?.parameters ?? null, keys: schema === undefined ? null : Object.keys(schema) })
    }
    const controller = new AbortController()
    // R121 token reading: the same query answered by the ops tool, next to the raw bytes the answer
    // replaces. "Saves tokens" is a claim about the first number versus the second, so both are recorded
    // here and the baseline is named for what it is: the bytes of the files the query touched, summed in
    // this process (a model of "an agent that had to read them", not a host tool's output - this world
    // composes no host grep/glob to compare against).
    const docs = '<workspace>//dsh-link/docs'
    const baseBytes = (predicate) => {
      const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))
      let bytes = 0
      let files = 0
      let tokens = 0
      for (const file of walk(docs)) {
        const text = readFileSync(file, 'utf8')
        if (predicate(file, text)) {
          bytes += Buffer.byteLength(text)
          files += 1
          if (priceContent !== null) tokens += priceContent([{ type: 'text', text }])
        }
      }
      return { bytes, files, tokens }
    }
    const attempts = [
      { call: 'glob', tool: opsTools.find((name) => name.endsWith('glob')), args: { pattern: '**/*.md', path: docs, limit: 50 }, baseline: () => baseBytes((file) => file.endsWith('.md')) },
      { call: 'grep', tool: opsTools.find((name) => name.endsWith('grep')), args: { pattern: 'dsh-ops', path: docs, head_limit: 20 }, baseline: () => baseBytes((file, text) => text.includes('dsh-ops')) },
      { call: 'inspect', tool: opsTools.find((name) => name.endsWith('inspect_local_file')), args: { file_path: '<workspace>//dsh-link/docs/handoff/STATUS.md' }, baseline: () => baseBytes((file) => file.endsWith('STATUS.md')) },
    ]
    for (const attempt of attempts) {
      if (attempt.tool === undefined) { note('ops.exec.absent', { call: attempt.call }); continue }
      try {
        const result = await tools.execute({ callId: 'r121-' + attempt.call, name: attempt.tool, arguments: attempt.args, signal: controller.signal })
        const content = JSON.stringify(result?.content ?? null)
        const baseline = attempt.baseline === undefined ? null : attempt.baseline()
        const tokensTool = priceContent === null || result?.isError === true ? null : priceContent(result.content ?? [])
        note('ops.exec.result', { call: attempt.call, tool: attempt.tool, isError: result?.isError === true, contentBytes: content.length, baselineBytes: baseline?.bytes ?? null, baselineFiles: baseline?.files ?? null, ratio: baseline === null || content.length === 0 ? null : Number((baseline.bytes / content.length).toFixed(1)), tokensTool, tokensBaseline: baseline?.tokens ?? null, tokenRatio: tokensTool === null || !baseline?.tokens ? null : Number((baseline.tokens / tokensTool).toFixed(1)), contentPreview: content.slice(0, 220), errorName: result?.error?.name ?? null })
      } catch (error) { note('ops.exec.threw', { call: attempt.call, tool: attempt.tool, ...refusal(error) }) }
    }
  }
  note('consumer-done')
  await ctx.fiber.dispose()
  note('control.disposed', { rootAlive: aliveRoot(ctx) })
  note('ops.tree.disposed', { rows: fastctxTree(), self: process.pid })
  // Bounded: long enough to see a process that survives disposal stay there, short enough for a gate that
  // runs this driver nine times in self-attack. The verdict on the residual is the judge's, not this wait's.
  await new Promise((resolve) => setTimeout(resolve, 3000))
  note('ops.tree.after-grace', { rows: fastctxTree(), self: process.pid })
  process.exit(0)
} catch (error) { note('driver-error', { message: String(error?.message ?? error).slice(0, 300) }); process.exit(3) }
