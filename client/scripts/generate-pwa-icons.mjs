#!/usr/bin/env node
/**
 * Generates the KumonScan Family PWA icon set into client/public/icons/.
 *
 * Dependency-free: rasterizes the mark (white "K" on primary #1B6EF3 from
 * DESIGN.md) per pixel and writes PNGs with a minimal encoder. Regenerate
 * with: node scripts/generate-pwa-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const PRIMARY = [0x1b, 0x6e, 0xf3];
const WHITE = [0xff, 0xff, 0xff];

// ---------------------------------------------------------------------------
// Minimal PNG encoder (RGBA, 8-bit, no interlace)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Rasterizer
// ---------------------------------------------------------------------------

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Signed coverage for an edge at `dist` (px inside is positive). */
function coverage(dist) {
  return clamp01(dist + 0.5);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = clamp01(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

function roundedRectDist(px, py, size, radius) {
  const half = size / 2;
  const qx = Math.abs(px - half) - (half - radius);
  const qy = Math.abs(py - half) - (half - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return radius - (outside + inside);
}

/**
 * Renders the mark. `maskable` fills the whole square (the OS applies its
 * own mask) and keeps the glyph inside the 66% safe zone; the standard
 * variant draws its own rounded square.
 */
function renderIcon(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  const glyphScale = maskable ? 0.78 : 1;

  // Glyph geometry in unit space, scaled around the center.
  const u = (v) => size / 2 + (v - 0.5) * size * glyphScale;
  const strokeHalf = (0.115 * size * glyphScale) / 2;
  const bar = { x0: u(0.345), x1: u(0.455), y0: u(0.27), y1: u(0.73) };
  const joint = { x: u(0.455), y: u(0.5) };
  const upper = { x: u(0.665), y: u(0.285) };
  const lower = { x: u(0.665), y: u(0.715) };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      const bgCoverage = maskable
        ? 1
        : coverage(roundedRectDist(px, py, size, size * 0.225));

      // K = rounded-cap vertical bar + two rounded-cap diagonals.
      // Signed distances: negative inside a stroke, positive outside.
      const barDist =
        distToSegment(px, py, (bar.x0 + bar.x1) / 2, bar.y0, (bar.x0 + bar.x1) / 2, bar.y1) -
        (bar.x1 - bar.x0) / 2;
      const upperDist =
        distToSegment(px, py, joint.x, joint.y, upper.x, upper.y) - strokeHalf;
      const lowerDist =
        distToSegment(px, py, joint.x, joint.y, lower.x, lower.y) - strokeHalf;
      const glyphCoverage = coverage(-Math.min(barDist, upperDist, lowerDist));

      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        rgba[i + c] = Math.round(
          PRIMARY[c] + (WHITE[c] - PRIMARY[c]) * glyphCoverage
        );
      }
      rgba[i + 3] = Math.round(255 * bgCoverage);
    }
  }

  return encodePng(size, rgba);
}

// ---------------------------------------------------------------------------

const ICONS = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'maskable-192.png', size: 192, maskable: true },
  { file: 'maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: true },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const { file, size, maskable } of ICONS) {
  const png = renderIcon(size, { maskable });
  writeFileSync(join(OUT_DIR, file), png);
  console.log(`wrote icons/${file} (${size}x${size}, ${png.length} bytes)`);
}
