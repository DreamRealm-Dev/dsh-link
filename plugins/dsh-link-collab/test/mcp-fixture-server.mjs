#!/usr/bin/env node
/**
 * R55 self-check fixture: a real MCP-over-stdio server, written against
 * docs/research/mcp-stdio-wire.md (not against the producer's client).
 *
 * It is a child process the self-check spawns; the gate writes its own peer instead of importing this
 * one. Flags arm the shapes the wire document names: a mismatched version, a malformed line, stderr
 * logging, a slow answer and a server that dies mid-call.
 *
 * On the wire: one message per line, never a raw newline inside a line (the JSON encoder escapes it),
 * stdout carries only frames and stderr carries only logs.
 */

import { appendFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const value = (name, fallback) => {
  const index = argv.indexOf(name)
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback
}

const SEQ = value('--seq', null)
const WIRE = value('--wire', null)
const TRACE = value('--trace', null)
const ANSWERED_VERSION = value('--version', '2025-06-18')
const STDERR_LINES = Number(value('--stderr', '0'))
const MALFORMED = flag('--malformed')
const HANGUP = value('--hangup', null)
const SLOW_MS = Number(value('--slow-ms', '0'))
const TTY = String.fromCharCode(9)

if (SEQ !== null) writeFileSync(SEQ, '', 'utf8')
if (WIRE !== null) writeFileSync(WIRE, '', 'utf8')
if (TRACE !== null) writeFileSync(TRACE, '', 'utf8')
for (let index = 0; index < STDERR_LINES; index += 1) process.stderr.write('fixture log line ' + String(index + 1) + String.fromCharCode(10))

const tools = [
  { name: 'add', description: 'Add two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
  { name: 'fail', description: 'Always fails', inputSchema: { type: 'object', properties: {} } },
  { name: 'image', description: 'Returns text and an image block', inputSchema: { type: 'object', properties: {} } },
  { name: 'nl', description: 'Returns text that contains a newline', inputSchema: { type: 'object', properties: {} } },
  { name: 'slow', description: 'Answers after --slow-ms', inputSchema: { type: 'object', properties: {} } },
  { name: 'crash', description: 'Exits without answering', inputSchema: { type: 'object', properties: {} } },
]

const note = (entry) => { if (TRACE !== null) appendFileSync(TRACE, JSON.stringify(entry) + String.fromCharCode(10), 'utf8') }

const send = (frame) => {
  note({ dir: 'out', method: frame.method === undefined ? null : frame.method, id: frame.id === undefined ? null : frame.id, isResult: frame.result !== undefined })
  const line = JSON.stringify(frame)
  if (WIRE !== null) appendFileSync(WIRE, line + String.fromCharCode(10), 'utf8')
  process.stdout.write(line + String.fromCharCode(10))
}

const call = (id, name, args) => {
  if (name === HANGUP) process.exit(7)
  if (name === 'add') return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String((args?.a ?? 0) + (args?.b ?? 0)) }] } })
  if (name === 'fail') return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Something went wrong' }], isError: true } })
  if (name === 'image') return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'see below' }, { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }] } })
  if (name === 'nl') return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: ['line one', 'line two' + TTY + 'tabbed'].join(String.fromCharCode(10)) }] } })
  if (name === 'slow') {
    setTimeout(() => send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'slow done' }] } }), SLOW_MS)
    return undefined
  }
  return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool: ' + String(name) } })
}

const handle = (frame) => {
  if (SEQ !== null) appendFileSync(SEQ, JSON.stringify({ method: frame.method, id: frame.id === undefined ? null : frame.id }) + String.fromCharCode(10), 'utf8')
  note({ dir: 'in', method: frame.method, id: frame.id === undefined ? null : frame.id })
  if (MALFORMED && frame.method === 'initialize') {
    // A line that is not JSON at all: the client must not hang on it (wire §四 -32700).
    process.stdout.write('{ this is not json' + String.fromCharCode(10))
    return
  }
  if (frame.id === undefined) return
  if (frame.method === 'initialize') {
    return send({ jsonrpc: '2.0', id: frame.id, result: { protocolVersion: ANSWERED_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'r55-fixture', version: '0.1' } } })
  }
  if (frame.method === 'tools/list') {
    return send({ jsonrpc: '2.0', id: frame.id, result: { tools } })
  }
  if (frame.method === 'tools/call') {
    const params = frame.params ?? {}
    return call(frame.id, params.name, params.arguments)
  }
  return send({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'Method not found: ' + String(frame.method) } })
}

let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += String(chunk)
  let cut = buffer.indexOf(String.fromCharCode(10))
  while (cut >= 0) {
    const line = buffer.slice(0, cut).trim()
    buffer = buffer.slice(cut + 1)
    if (line !== '') {
      try { handle(JSON.parse(line)) } catch { process.stderr.write('fixture could not parse a line' + String.fromCharCode(10)) }
    }
    cut = buffer.indexOf(String.fromCharCode(10))
  }
})
process.stdin.on('end', () => process.exit(0))
