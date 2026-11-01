/**
 * Load the TypeScript compat layer from a plain Node script.
 *
 * The layer is TypeScript because it ships inside a kernel plugin, and the
 * verification scripts are plain `.mjs` because they run before any build. esbuild
 * is the same tool the plugin build uses, so both paths read the same source:
 * the script bundles `compat/index.ts` in memory and imports the result, and no
 * second copy of the resolver can drift from the one the kernel runs.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Import the compat layer.
 *
 * @returns the module `compat/index.ts` exports.
 */
export async function loadCompatModule() {
  const result = await build({
    entryPoints: [join(HERE, 'index.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'warning',
  })
  const code = result.outputFiles[0].text
  return import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'))
}
