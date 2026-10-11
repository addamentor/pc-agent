// Generates the app and tray icons as PNGs with no image dependencies.
// Run: npm run icons
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel((x + 0.5) / size, (y + 0.5) / size, size)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const clamp = (v) => Math.max(0, Math.min(1, v))
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

// Rounded indigo tile with a white ring and centre dot (a "radar" for tasks).
function icon(alert) {
  return (u, v, size) => {
    const aa = 1.5 / size
    const dx = Math.abs(u - 0.5) - 0.5 + 0.2
    const dy = Math.abs(v - 0.5) - 0.5 + 0.2
    const box = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - 0.2
    const tileA = clamp(0.5 - box / aa)
    let col = mix([79, 70, 229], [124, 58, 237], v)
    const r = Math.hypot(u - 0.5, v - 0.5)
    const ring = clamp(0.5 - (Math.abs(r - 0.26) - 0.05) / aa)
    const dot = clamp(0.5 - (r - 0.08) / aa)
    col = mix(col, [255, 255, 255], Math.max(ring, dot))
    if (alert) {
      const ar = Math.hypot(u - 0.8, v - 0.2)
      const badge = clamp(0.5 - (ar - 0.2) / aa)
      col = mix(col, [239, 68, 68], badge)
      return [...col.map(Math.round), Math.round(255 * Math.max(tileA, badge))]
    }
    return [...col.map(Math.round), Math.round(255 * tileA)]
  }
}

mkdirSync('build', { recursive: true })
mkdirSync('resources', { recursive: true })
// Windows .ico with embedded PNG images (supported since Vista).
function ico(sizes) {
  const imgs = sizes.map((n) => png(n, icon(false)))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(imgs.length, 4)
  let offset = 6 + 16 * imgs.length
  const entries = imgs.map((img, i) => {
    const e = Buffer.alloc(16)
    const n = sizes[i]
    e[0] = n >= 256 ? 0 : n
    e[1] = n >= 256 ? 0 : n
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(img.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += img.length
    return e
  })
  return Buffer.concat([header, ...entries, ...imgs])
}

writeFileSync('build/icon.png', png(256, icon(false)))
writeFileSync('build/icon.ico', ico([256, 64, 48, 32, 16]))
writeFileSync('resources/icon.png', png(256, icon(false)))
writeFileSync('resources/tray.png', png(32, icon(false)))
writeFileSync('resources/tray-alert.png', png(32, icon(true)))
console.log('icons written')
