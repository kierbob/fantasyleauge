#!/usr/bin/env node
'use strict';
// Draws the app icon (basketball on a dark tile) as PNGs without any image libraries.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 4; // supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0; let g = 0; let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [pr, pg, pb] = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += pr; g += pg; b += pb;
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r / (SS * SS); raw[o + 1] = g / (SS * SS); raw[o + 2] = b / (SS * SS); raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const BG = [17, 19, 21];
const RED = [208, 2, 27];
const BALL = [238, 118, 35];
const SEAM = [30, 20, 14];
function pixel(u, v) {
  if (v > 0.9) return RED; // accent stripe like the app's top bar
  const cx = 0.5; const cy = 0.46; const R = 0.33;
  const dx = u - cx; const dy = v - cy;
  const d = Math.hypot(dx, dy);
  if (d > R) return BG;
  const w = 0.018;
  const seam = Math.abs(dx) < w || Math.abs(dy) < w
    || Math.abs(Math.hypot(u - (cx - R * 1.35), dy) - R * 1.05) < w
    || Math.abs(Math.hypot(u - (cx + R * 1.35), dy) - R * 1.05) < w;
  if (seam || d > R - w * 1.2) return SEAM;
  const shade = 1 - 0.28 * Math.max(0, (dx + dy) / R); // light from top-left
  return BALL.map((c) => c * shade);
}

const out = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  fs.writeFileSync(path.join(out, name), png(size, pixel));
  console.log(`wrote public/icons/${name}`);
}
