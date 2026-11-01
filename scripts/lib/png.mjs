/**
 * Read PNG pixels without an image viewer.
 *
 * The material's properties are quantities — how much of a backdrop shows
 * through, where a surface stops painting one — and a quantity read by eye is a
 * guess. So the images this package captures are decoded here: zlib inflate plus
 * the five scanline filters, no dependencies, no image budget.
 */

import { inflateSync } from 'node:zlib'

/**
 * Decode a PNG buffer to raw rows.
 * @param buffer - the complete PNG file.
 * @returns its width, height, channel count and RGBA-or-RGB rows.
 */
export function decode(buffer) {
  let offset = 8
  let width = 0
  let height = 0
  let channels = 4
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const colorType = data.readUInt8(9)
      if (data.readUInt8(8) !== 8) throw new Error('only 8-bit PNGs are handled')
      channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
      if (channels === 0) throw new Error('unexpected colour type ' + colorType)
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? out[y * stride + i - channels] : 0
      const b = y > 0 ? out[(y - 1) * stride + i] : 0
      const c = y > 0 && i >= channels ? out[(y - 1) * stride + i - channels] : 0
      const value = line[i]
      const restored = filter === 0 ? value
        : filter === 1 ? value + a
          : filter === 2 ? value + b
            : filter === 3 ? value + ((a + b) >> 1)
              : value + paeth(a, b, c)
      out[y * stride + i] = restored & 0xff
    }
  }
  return { width, height, channels, pixels: out }
}

/**
 * Mean and extremes of a rectangle inside a decoded image.
 * @param image - a decoded image.
 * @param x - left edge, in pixels.
 * @param y - top edge, in pixels.
 * @param width - rectangle width; defaults to the rest of the row.
 * @param height - rectangle height; defaults to the rest of the image.
 * @returns the mean as '#rrggbb', the spread between the darkest and lightest
 * pixel, and the pixel count.
 */
export function stats(image, x = 0, y = 0, width = image.width - x, height = image.height - y) {
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  let min = 255
  let max = 0
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const i = (row * image.width + column) * image.channels
      const value = (image.pixels[i] + image.pixels[i + 1] + image.pixels[i + 2]) / 3
      r += image.pixels[i]
      g += image.pixels[i + 1]
      b += image.pixels[i + 2]
      if (value < min) min = value
      if (value > max) max = value
      count += 1
    }
  }
  const hex = (v) => Math.round(v / count).toString(16).padStart(2, '0')
  return { mean: '#' + hex(r) + hex(g) + hex(b), spread: Number((max - min).toFixed(1)), pixels: count }
}

/**
 * Per-row statistics: what the image looks like one scanline at a time.
 *
 * This is the instrument for a vertical question — where a surface stops
 * painting its backdrop, where a seam falls — which a single region mean buries.
 * @param image - a decoded image.
 * @param x - left edge of the sample column range.
 * @param width - width of the sample range.
 * @returns one entry per row: index, mean luminance, darkest, lightest, and how
 * many pixels sit more than {@link INK} away from the row's mean.
 */
export function rowProfile(image, x = 0, width = image.width - x) {
  const rows = []
  for (let y = 0; y < image.height; y += 1) {
    let sum = 0
    let min = 255
    let max = 0
    const values = []
    for (let column = x; column < x + width; column += 1) {
      const i = (y * image.width + column) * image.channels
      const value = (image.pixels[i] + image.pixels[i + 1] + image.pixels[i + 2]) / 3
      values.push(value)
      sum += value
      if (value < min) min = value
      if (value > max) max = value
    }
    const mean = sum / width
    let ink = 0
    for (const value of values) if (Math.abs(value - mean) > INK) ink += 1
    rows.push({ y, mean: Number(mean.toFixed(1)), min, max, spread: Math.round((max - min) * 10) / 10, ink })
  }
  return rows
}

/** Luminance distance from a row's mean that counts as ink rather than shading. */
const INK = 24
