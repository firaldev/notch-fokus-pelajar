// Generate placeholder icons for Notch Fokus Pelajar at build time.
// Why this script exists: the GitHub push tool only accepts text files,
// so the binary PNG/ICO files in src-tauri/icons/ are NOT pushed to the
// repository. This script recreates them on the build machine (Windows
// runner in GitHub Actions, or a developer PC) before Tauri builds.
// Node only, no dependencies: PNG encoding uses the built-in zlib module.
//
// Usage:
//   node scripts/generate-icons.js [output-dir]
// Default output dir: src-tauri/icons (relative to the repo root).
//
// Outputs (Tauri v2 bundle.icon entries in tauri.conf.json):
//   icon.png (512x512), 128x128@2x.png (256x256), 128x128.png, 32x32.png,
//   icon.ico (single 256x256 PNG entry, valid Vista-style ICO).
// Design: dark background with a teal disc in the centre. Placeholder
// only — not a final logo.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = process.argv[2] || join(ROOT, "src-tauri", "icons");

// CRC-32 (PNG uses CRC-32/ISO-HDLC, polynomial 0xEDB88320).
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

// RGBA pixels: dark background (#111827) with a teal disc (#2dd4bf)
// centred, radius 34% of the image size. Filter byte 0 per scanline.
function makePng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.34;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const teal = dx * dx + dy * dy <= r * r;
      const o = row + 1 + x * 4;
      if (teal) {
        raw[o] = 45; raw[o + 1] = 212; raw[o + 2] = 191; raw[o + 3] = 255;
      } else {
        raw[o] = 17; raw[o + 1] = 24; raw[o + 2] = 39; raw[o + 3] = 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // compression, filter, interlace
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ICO with one entry: 256x256 PNG (width/height byte 0 means 256).
function makeIco(png256) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 256
  entry[1] = 0; // height 256
  entry[2] = 0; // colours
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png256.length, 8);
  entry.writeUInt32LE(22, 12); // offset of image data
  return Buffer.concat([header, entry, png256]);
}

mkdirSync(OUT_DIR, { recursive: true });
const files = [
  ["icon.png", makePng(512)],
  ["128x128@2x.png", makePng(256)],
  ["128x128.png", makePng(128)],
  ["32x32.png", makePng(32)],
];
for (const [name, data] of files) writeFileSync(join(OUT_DIR, name), data);
writeFileSync(join(OUT_DIR, "icon.ico"), makeIco(files[1][1]));
console.log(`Icons written to ${OUT_DIR}: ${[...files.map(([n]) => n), "icon.ico"].join(", ")}`);
