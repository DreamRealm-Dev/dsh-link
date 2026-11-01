#!/usr/bin/env node
/**
 * Evaluate one expression file (or --inline) inside the running LINK shell page.
 *
 *   node plugins/dsh-link-chat-window/tools/eval.mjs tools/probes/env.js
 *   node plugins/dsh-link-chat-window/tools/eval.mjs --inline "document.title"
 *
 * Prints the JSON value. Non-zero exit on exception / missing page.
 */
import { readFileSync } from 'node:fs'
import { connect } from './cdp.mjs'

const args = process.argv.slice(2)
const port = /^\d+$/.test(args[0] ?? '') ? Number(args.shift()) : undefined
let source
if (args[0] === '--inline') source = args[1]
else if (args[0] !== undefined) source = readFileSync(args[0], 'utf8')
else { console.error('usage: eval.mjs [port] <expr-file | --inline "js">'); process.exit(64) }
const cdp = await connect(port === undefined ? {} : { port })
try {
  const value = await cdp.evaluate(source)
  console.log(JSON.stringify(value, null, 2))
} finally {
  cdp.close()
}
