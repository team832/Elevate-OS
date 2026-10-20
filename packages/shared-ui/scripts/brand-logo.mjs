#!/usr/bin/env node
/**
 * Brand logo installer (no dependencies — node:zlib only).
 *
 *   node packages/shared-ui/scripts/brand-logo.mjs [source.png]
 *
 * Reads the source logo (default: the owner's file in the repo root), trims the
 * excess black margin LOSSLESSLY (pixels are copied byte-for-byte; only the
 * PNG row filters are re-encoded), and writes the result to every app's
 * `public/brand/elevate-logo.png`, plus the trimmed size to
 * `packages/shared-ui/src/brand-asset.ts`.
 *
 * To swap the logo: drop the new PNG in the repo root and run this script with
 * its file name. Nothing else needs to change. Non-PNG sources are refused.
 * Pass `--no-trim` to copy the file unchanged.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const DEFAULT_SOURCE = 'Screenshot 2026-08-21 191756.png';
const APPS = ['platform', 'business-ops-os', 'academic-os', 'marketing-os'];
/** Pixels whose brightest channel is at or below this are background (JPEG-style noise included). */
const BACKGROUND_MAX = 48;
/** Keep a little breathing room around the mark, in source pixels. */
const PADDING = 16;

const args = process.argv.slice(2);
const noTrim = args.includes('--no-trim');
const sourceArg = args.find((a) => !a.startsWith('--')) ?? DEFAULT_SOURCE;
const source = path.resolve(repoRoot, sourceArg);
if (!existsSync(source)) {
  console.error(`Logo source not found: ${source}`);
  process.exit(1);
}
const input = readFileSync(source);
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!input.subarray(0, 8).equals(SIGNATURE)) {
  console.error('Only PNG sources are supported.');
  process.exit(1);
}

// --- read chunks ---------------------------------------------------------------------------------
const chunks = [];
for (let o = 8; o < input.length;) {
  const len = input.readUInt32BE(o);
  const type = input.toString('ascii', o + 4, o + 8);
  chunks.push({ type, data: input.subarray(o + 8, o + 8 + len) });
  o += 12 + len;
}
const ihdr = chunks.find((c) => c.type === 'IHDR').data;
const width = ihdr.readUInt32BE(0);
const height = ihdr.readUInt32BE(4);
const [bitDepth, colorType, , , interlace] = [ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]];
const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];

function install(png, w, h) {
  for (const app of APPS) {
    const dir = path.join(repoRoot, 'apps', app, 'public', 'brand');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'elevate-logo.png'), png);
  }
  writeFileSync(
    path.join(repoRoot, 'packages', 'shared-ui', 'src', 'brand-asset.ts'),
    `// Written by packages/shared-ui/scripts/brand-logo.mjs — do not edit by hand.\n` +
      `/** Intrinsic size of public/brand/elevate-logo.png (used for width/height attributes only). */\n` +
      `export const BRAND_LOGO_SIZE = { width: ${w}, height: ${h} } as const;\n`,
  );
  console.log(`Installed ${w}×${h} logo into ${APPS.length} apps (public/brand/elevate-logo.png).`);
}

if (noTrim || bitDepth !== 8 || !channels || interlace !== 0) {
  if (!noTrim) console.warn('Unsupported PNG layout for trimming; copying the file unchanged.');
  install(input, width, height);
  process.exit(0);
}

// --- decode (un-filter) ----------------------------------------------------------------------------
const raw = zlib.inflateSync(
  Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)),
);
const bpp = channels;
const stride = width * bpp;
const pixels = Buffer.alloc(stride * height);
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)];
  const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
  const out = pixels.subarray(y * stride, (y + 1) * stride);
  const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? out[x - bpp] : 0;
    const b = prev ? prev[x] : 0;
    const c = prev && x >= bpp ? prev[x - bpp] : 0;
    let v = line[x];
    if (filter === 1) v += a;
    else if (filter === 2) v += b;
    else if (filter === 3) v += (a + b) >> 1;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[x] = v & 0xff;
  }
}

// --- bounding box of the mark ----------------------------------------------------------------------
const colourChannels = colorType === 0 || colorType === 4 ? 1 : 3;
let [minX, minY, maxX, maxY] = [width, height, -1, -1];
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = y * stride + x * bpp;
    let max = 0;
    for (let k = 0; k < colourChannels; k++) max = Math.max(max, pixels[i + k]);
    if (max > BACKGROUND_MAX) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
if (maxX < 0) {
  console.warn('No mark found against the background; copying the file unchanged.');
  install(input, width, height);
  process.exit(0);
}
minX = Math.max(0, minX - PADDING);
minY = Math.max(0, minY - PADDING);
maxX = Math.min(width - 1, maxX + PADDING);
maxY = Math.min(height - 1, maxY + PADDING);
const w = maxX - minX + 1;
const h = maxY - minY + 1;

// --- encode the crop (pixel bytes copied exactly; each row gets the PNG filter that packs best) ------
const rowLen = w * bpp;
const cropRow = (y) =>
  pixels.subarray((minY + y) * stride + minX * bpp, (minY + y) * stride + (minX + w) * bpp);
const outRaw = Buffer.alloc((rowLen + 1) * h);
for (let y = 0; y < h; y++) {
  const cur = cropRow(y);
  const prev = y > 0 ? cropRow(y - 1) : null;
  let best = null;
  let bestScore = Infinity;
  for (let f = 0; f <= 4; f++) {
    const line = Buffer.alloc(rowLen);
    let score = 0;
    for (let x = 0; x < rowLen; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      const v = (cur[x] - pred) & 0xff;
      line[x] = v;
      score += v < 128 ? v : 256 - v;
    }
    if (score < bestScore) {
      bestScore = score;
      best = { f, line };
    }
  }
  outRaw[y * (rowLen + 1)] = best.f;
  best.line.copy(outRaw, y * (rowLen + 1) + 1);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const newIhdr = Buffer.from(ihdr);
newIhdr.writeUInt32BE(w, 0);
newIhdr.writeUInt32BE(h, 4);
// Keep colour-management chunks (sRGB, gAMA, cHRM, iCCP, pHYs) so the colours look the same.
const keep = chunks.filter((c) => ['sRGB', 'gAMA', 'cHRM', 'iCCP', 'pHYs'].includes(c.type));
const png = Buffer.concat([
  SIGNATURE,
  chunk('IHDR', newIhdr),
  ...keep.map((c) => chunk(c.type, c.data)),
  chunk('IDAT', zlib.deflateSync(outRaw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
console.log(`Trimmed ${width}×${height} → ${w}×${h} (offset ${minX},${minY}).`);
install(png, w, h);

// --- favicon: the logo's first letter ("e") on its own black ground, as a PNG inside an ICO ----------
// Served by the platform at /favicon.ico for every zone. Uses the letter, not the chevron alone.
if (bpp === 4) {
  const isMark = (x, y) => {
    const i = y * stride + x * bpp;
    return Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > BACKGROUND_MAX;
  };
  const colHasMark = (x) => {
    for (let y = minY; y <= maxY; y++) if (isMark(x, y)) return true;
    return false;
  };
  let gx0 = minX;
  while (gx0 <= maxX && !colHasMark(gx0)) gx0++;
  let gx1 = gx0;
  while (gx1 + 1 <= maxX && colHasMark(gx1 + 1)) gx1++;
  let gy0 = maxY;
  let gy1 = minY;
  for (let y = minY; y <= maxY; y++)
    for (let x = gx0; x <= gx1; x++)
      if (isMark(x, y)) {
        gy0 = Math.min(gy0, y);
        gy1 = Math.max(gy1, y);
      }
  const gw = gx1 - gx0 + 1;
  const gh = gy1 - gy0 + 1;
  const size = Math.min(256, Math.ceil(Math.max(gw, gh) * 1.4));
  const ox = Math.floor((size - gw) / 2);
  const oy = Math.floor((size - gh) / 2);
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const r = y * (size * 4 + 1);
    rows[r] = 0;
    for (let x = 0; x < size; x++) {
      const sx = gx0 + x - ox;
      const sy = gy0 + y - oy;
      const d = r + 1 + x * 4;
      if (sx >= gx0 && sx <= gx1 && sy >= gy0 && sy <= gy1)
        pixels.copy(rows, d, sy * stride + sx * 4, sy * stride + sx * 4 + 4);
      else rows.writeUInt32BE(0x000000ff, d); // opaque black ground
    }
  }
  const icoIhdr = Buffer.from(ihdr);
  icoIhdr.writeUInt32BE(size, 0);
  icoIhdr.writeUInt32BE(size, 4);
  const iconPng = Buffer.concat([
    SIGNATURE,
    chunk('IHDR', icoIhdr),
    ...keep.map((c) => chunk(c.type, c.data)),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(1, 4); // one image
  header[6] = size === 256 ? 0 : size;
  header[7] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, 10); // planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(iconPng.length, 14);
  header.writeUInt32LE(22, 18);
  writeFileSync(
    path.join(repoRoot, 'apps', 'platform', 'public', 'favicon.ico'),
    Buffer.concat([header, iconPng]),
  );
  console.log(`Wrote apps/platform/public/favicon.ico (${size}×${size}, from the first letter).`);
}
