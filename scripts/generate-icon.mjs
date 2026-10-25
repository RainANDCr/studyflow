/**
 * 纯 Node 图标生成器（无 canvas 依赖）：
 * 用 zlib 手写 PNG 编码，按有符号距离函数绘制「紫渐变圆角底 + 白色圆环 + 圆心」图标，
 * 输出 scripts/icon-source.png（1024，tauri icon 源）与 public/icons/icon-{192,512}.png（PWA）。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/* ---------- 绘制 ---------- */
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const smooth = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

// 圆角矩形 SDF（居中，半宽半高 hw/hh，圆角 r）
function sdfRoundRect(px, py, hw, hh, r) {
  const qx = Math.abs(px) - (hw - r)
  const qy = Math.abs(py) - (hh - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4)
  const c1 = [124, 92, 255] // #7c5cff
  const c2 = [79, 70, 229] // #4f46e5
  const aa = 1.5 / size // 抗锯齿宽度
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5
      const v = (y + 0.5) / size - 0.5
      const boxAlpha = 1 - smooth(-aa, aa, sdfRoundRect(u, v, 0.5, 0.5, 0.22))
      const g = clamp01((u + v) + 0.5)
      let r = lerp(c1[0], c2[0], g)
      let gg = lerp(c1[1], c2[1], g)
      let b = lerp(c1[2], c2[2], g)
      // 白色圆环：半径 0.26，半厚 0.023
      const dRing = Math.abs(Math.hypot(u, v) - 0.26) - 0.023
      const ring = 1 - smooth(-aa, aa, dRing)
      // 白色圆心：半径 0.078
      const dDot = Math.hypot(u, v) - 0.078
      const dot = 1 - smooth(-aa, aa, dDot)
      const white = Math.max(ring, dot)
      r = lerp(r, 255, white)
      gg = lerp(gg, 255, white)
      b = lerp(b, 255, white)
      const i = (y * size + x) * 4
      buf[i] = Math.round(r)
      buf[i + 1] = Math.round(gg)
      buf[i + 2] = Math.round(b)
      buf[i + 3] = Math.round(boxAlpha * 255)
    }
  }
  return buf
}

mkdirSync(join(root, 'public', 'icons'), { recursive: true })
for (const [file, size] of [
  ['scripts/icon-source.png', 1024],
  ['public/icons/icon-512.png', 512],
  ['public/icons/icon-192.png', 192],
]) {
  mkdirSync(join(root, dirname(file)), { recursive: true })
  writeFileSync(join(root, file), encodePng(size, size, render(size)))
  console.log(`generated ${file} (${size}x${size})`)
}
