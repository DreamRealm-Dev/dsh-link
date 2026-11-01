#!/usr/bin/env node
/**
 * Read the pixels of a PNG file — a capture, or a screenshot someone sent.
 *
 *   node scripts/png-profile.mjs <file.png> [--clip x,y,w,h] [--rows] [--step n]
 *                                   [--ascii [width]]
 *
 * Prints the region's mean and spread; with --rows, one line per scanline, which
 * is what answers a vertical question: where a surface stops painting what is
 * behind it; with --ascii, a coarse luminance map of the region, which is how a
 * layout gets read without spending an image on it (a character cell is roughly
 * twice as tall as it is wide, so rows are averaged in pairs). Measurements are
 * the only way a screenshot gets reviewed here, so this works on a file path
 * rather than on the live page — a reported defect can be measured exactly as it
 * was reported.
 */
import { readFileSync } from 'node:fs'
import { decode, stats, rowProfile } from './lib/png.mjs'

const args = process.argv.slice(2)
const file = args.shift()
if (file === undefined) { console.error('usage: png-profile.mjs <file.png> [--clip x,y,w,h] [--rows] [--step n]'); process.exit(64) }
const clipIndex = args.indexOf('--clip')
const clip = clipIndex === -1 ? undefined : args[clipIndex + 1].split(',').map(Number)
const step = args.includes('--step') ? Number(args[args.indexOf('--step') + 1]) : 1
const rows = args.includes('--rows')

const image = decode(readFileSync(file))
console.log(JSON.stringify({ file, size: [image.width, image.height], channels: image.channels }))
if (clip === undefined) console.log(JSON.stringify(stats(image)))
else console.log(JSON.stringify({ clip, ...stats(image, clip[0], clip[1], clip[2], clip[3]) }))
if (args.includes('--ascii')) {
  const index = args.indexOf('--ascii')
  const target = /^\d+$/.test(args[index + 1] ?? '') ? Number(args[index + 1]) : 80
  const x = clip === undefined ? 0 : clip[0]
  const y = clip === undefined ? 0 : clip[1]
  const width = clip === undefined ? image.width : clip[2]
  const height = clip === undefined ? image.height : clip[3]
  const columns = Math.min(target, width)
  const blocks = Math.max(1, Math.round(columns / 2))
  const cell = width / columns
  const aspect = 2
  const ramp = ' .:-=+*#%@'
  for (let row = 0; row < height; row += cell * aspect) {
    let line = ''
    for (let column = 0; column < columns; column += 1) {
      let sum = 0
      let count = 0
      for (let py = Math.floor(y + row); py < Math.min(y + height, y + row + cell * aspect); py += 1) {
        for (let px = Math.floor(x + column * cell); px < Math.min(x + width, x + (column + 1) * cell); px += 1) {
          const i = (Math.floor(py) * image.width + Math.floor(px)) * image.channels
          sum += (image.pixels[i] + image.pixels[i + 1] + image.pixels[i + 2]) / 3
          count += 1
        }
      }
      const value = count === 0 ? 0 : sum / count
      line += ramp[Math.min(ramp.length - 1, Math.round((value / 255) ** 0.6 * (ramp.length - 1)))]
    }
    console.log(String(Math.round(row)).padStart(4) + ' |' + line + '|')
  }
}
if (rows) {
  const x = clip === undefined ? 0 : clip[0]
  const width = clip === undefined ? image.width : clip[2]
  const from = clip === undefined ? 0 : clip[1]
  const to = clip === undefined ? image.height : clip[1] + clip[3]
  for (const row of rowProfile(image, x, width).slice(from, to)) {
    if ((row.y - from) % step !== 0) continue
    console.log('y=' + String(row.y).padStart(4) + '  mean=' + String(row.mean).padStart(6) + '  min=' + String(row.min).padStart(3) + '  max=' + String(row.max).padStart(3) + '  spread=' + String(row.spread).padStart(6) + '  ink=' + row.ink)
  }
}
