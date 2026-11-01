import { appendFileSync } from 'node:fs'
const marker = process.env.R91_MARKER
const note = (event, extra = {}) => appendFileSync(marker, JSON.stringify({ event, ...extra }) + '\n')
const refusal = (error) => ({ name: error?.name ?? typeof error, message: String(error?.message ?? error).slice(0, 180) })
try {
  const appBoot = await import(process.env.R91_APP_BOOT)
  const boot = await import(process.env.R91_PROFILE_BOOT)
  // --no-open: without it the kernel opens a browser window on whatever machine runs the gate. This booter
  // is started by verify-compat-simple-default-output.mjs on every suite run (twice per run: the shipped side
  // and the patched side), and it was measurably popping a window each time - nobody was looking at it.
  const result = await boot.runProfile({ environment: appBoot.loadLayeredEnv('dsh'), profile: process.env.R91_PROFILE, patchFiles: [], args: ['--host', '127.0.0.1', '--port', process.env.R91_PORT ?? '31880', '--no-open'] })
  note('settled', { rootAlive: (() => { try { return result.ctx.reflect.get('dshHomePath', false) !== undefined } catch { return false } })() })
  const simple = result.ctx.link && result.ctx.link.compat && result.ctx.link.compat.simple
  note({ event: 'available', value: simple.available() })
  const body = (args) => ({ echo: args?.value ?? null })
  try {
    const h = simple.tools.add('r91-no-output', { parameters: { value: { type: 'string' } }, execute: body })
    note({ event: 'A.no-output.ok', definition: h.definition })
  } catch (error) { note({ event: 'A.no-output.threw', ...refusal(error) }) }
  try {
    const h = simple.tools.add('r91-with-output', { parameters: { value: { type: 'string' } }, output: { type: 'string' }, execute: body })
    note({ event: 'B.with-output.ok', definition: h.definition, has: simple.tools.has('r91-with-output'), namesInclude: simple.tools.names().includes('r91-with-output'), namesCount: simple.tools.names().length })
  } catch (error) { note({ event: 'B.with-output.threw', ...refusal(error) }) }
  try {
    const h = simple.tools.add('r91-json-output', { parameters: { value: { type: 'string' } }, output: { type: 'json' }, execute: body })
    note({ event: 'C.explicit-json.ok', definition: h.definition })
  } catch (error) { note({ event: 'C.explicit-json.threw', ...refusal(error) }) }
  await result.ctx.fiber.dispose()
  process.exit(0)
} catch (error) { note({ event: 'driver-error', message: String(error?.message ?? error).slice(0, 300) }); process.exit(3) }
