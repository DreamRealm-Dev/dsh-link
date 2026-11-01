import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const ARGS = process.argv.slice(2)
const RELAXED = ARGS.includes('--relaxed')
const DOC = ARGS.filter((a) => a !== '--relaxed')[0]
const text = readFileSync(DOC, 'utf8')
const CRLF = text.indexOf(String.fromCharCode(13) + String.fromCharCode(10)) !== -1
const NL = CRLF ? String.fromCharCode(13) + String.fromCharCode(10) : String.fromCharCode(10)
const lines = text.split(NL)
const ROW = /^[|] ([A-Za-z0-9._-]+) [|] ([^|:]+):([0-9]+) [|] (.*) [|]$/
const rows = []
for (let i = 0; i < lines.length; i += 1) { const m = ROW.exec(lines[i]); if (m !== null) rows.push({ at: i, id: m[1], file: m[2].trim(), line: Number(m[3]), fragments: m[4] }) }
const parts = (f) => f.split(' ; ').map((x) => x.trim()).filter(Boolean)
let moved = 0, requoted = 0; const failed = []
for (const row of rows) {
  if (!existsSync(row.file)) { failed.push(row.id); continue }
  const target = readFileSync(row.file, 'utf8').split(/\r?\n/)
  const all = parts(row.fragments)
  const holdsAll = (n) => { const t = String(target[n - 1] ?? ''); return all.every((f) => t.indexOf(f) !== -1) }
  if (holdsAll(row.line)) continue
  let best = null
  for (let n = 1; n <= target.length; n += 1) { if (!holdsAll(n)) continue; const d = Math.abs(n - row.line); if (best === null || d < best.d) best = { n, d } }
  if (best !== null) { lines[row.at] = '| ' + row.id + ' | ' + row.file + ':' + String(best.n) + ' | ' + row.fragments + ' |'; moved += 1; console.log('  moved ' + row.id + ': ' + String(row.line) + ' -> ' + String(best.n)); continue }
  if (!RELAXED) { failed.push(row.id); continue }
  const key = all[0]
  let near = null
  for (let n = 1; n <= target.length; n += 1) { if (String(target[n - 1] ?? '').indexOf(key) === -1) continue; const d = Math.abs(n - row.line); if (near === null || d < near.d) near = { n, d } }
  if (near === null) { failed.push(row.id + ' (first fragment gone: ' + key.slice(0, 40) + ')'); continue }
  const quote = String(target[near.n - 1]).trim().slice(0, 90).replace(/[|]/g, '/')
  lines[row.at] = '| ' + row.id + ' | ' + row.file + ':' + String(near.n) + ' | ' + quote + ' |'
  requoted += 1;
  console.log('  requoted ' + row.id + ': ' + String(row.line) + ' -> ' + String(near.n) + ' quoting ' + JSON.stringify(quote.slice(0, 60)))
}
writeFileSync(DOC, lines.join(NL))
console.log('moved ' + String(moved) + ', requoted ' + String(requoted) + ', still failing ' + String(failed.length))
for (const f of failed.slice(0, 10)) console.log('  ' + f)
