// Read one DSH session log (zstd frame sequence) and print a compact summary.
// Usage: node read-session.mjs <session.v3.jsonl.zstd> [--all]
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const file = process.argv[2]
const all = process.argv.includes('--all')
const raw = readFileSync(file)
const magic = [0x28, 0xb5, 0x2f, 0xfd]
const offsets = []
for (let i = 0; i + 3 < raw.length; i += 1) {
  if (raw[i] === magic[0] && raw[i + 1] === magic[1] && raw[i + 2] === magic[2] && raw[i + 3] === magic[3]) offsets.push(i)
}
let text = ''
for (let i = 0; i < offsets.length; i += 1) {
  const end = i + 1 < offsets.length ? offsets[i + 1] : raw.length
  try {
    text += zstdDecompressSync(raw.subarray(offsets[i], end)).toString('utf8')
  } catch (error) {
    console.log('frame', i, 'failed:', error.message)
  }
}
const lines = text.split(/\r?\n/).filter((line) => line.length > 0)
console.log('frames:', offsets.length, 'lines:', lines.length, 'bytes:', text.length)
for (const line of lines) {
  let event
  try {
    event = JSON.parse(line)
  } catch {
    console.log('UNPARSED:', line.slice(0, 160))
    continue
  }
  const type = event === null || typeof event !== 'object' ? '?' : String(event.type)
  const data = event === null || typeof event !== 'object' ? undefined : event.data
  if (type === 'request/header') {
    console.log(type, 'reason=' + String(data?.reason), 'config=' + JSON.stringify(data?.header?.config))
  } else if (type === 'assistant/message') {
    console.log(type, JSON.stringify({ provider: data?.message?.source?.provider, model: data?.message?.source?.model }))
  } else if (type === 'turn/end' || type === 'subagent/descriptor' || type === 'subagent/catalog') {
    console.log(type, JSON.stringify(data))
  } else if (type === 'user/message') {
    const text = (data?.content ?? []).map((block) => block?.text ?? '').join(' ')
    console.log(type, text.slice(0, 300))
  } else if (all) {
    console.log(type, String(JSON.stringify(data)).slice(0, 300))
  } else {
    console.log(type)
  }
}
