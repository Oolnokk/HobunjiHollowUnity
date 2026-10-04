'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  ['fishingspear', 'docs/assets/toolsprites/harpoon_fishingspear.png'],
  ['bshuakauitl', "docs/assets/toolsprites/b'shuakauitl.png"],
  ['pickshovel', 'docs/assets/toolsprites/shovel_pickshovel.png'],
];

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
}

function decodeRgbaPng(filePath) {
  const bytes = fs.readFileSync(filePath);
  const sig = bytes.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new Error(`Not PNG: ${filePath}`);
  let p = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (p < bytes.length) {
    const len = bytes.readUInt32BE(p); p += 4;
    const type = bytes.subarray(p, p + 4).toString('ascii'); p += 4;
    const data = bytes.subarray(p, p + len); p += len;
    p += 4; // CRC
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`Expected 8-bit non-interlaced RGBA PNG; got depth=${bitDepth} type=${colorType} interlace=${interlace}`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const rgba = Buffer.alloc(width * height * bpp);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y ? rgba.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const v = raw[src++];
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      row[x] = filter === 0 ? v
        : filter === 1 ? (v + a) & 255
        : filter === 2 ? (v + b) & 255
        : filter === 3 ? (v + Math.floor((a + b) / 2)) & 255
        : filter === 4 ? (v + paeth(a, b, c)) & 255
        : (() => { throw new Error(`Unsupported PNG filter ${filter}`); })();
    }
  }
  return { width, height, rgba };
}

function hex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function colorClass(r, g, b) {
  // Exact report is the source of truth; these broad bins only make long shaft runs easy to spot.
  if (g >= r * 1.08 && g >= b * 1.04 && g - r >= 10) return 'verdigris';
  if (r >= g * 0.92 && r >= b * 1.18 && g >= b * 1.08) return 'warm';
  return 'other';
}

function analyze(name, rel) {
  const png = decodeRgbaPng(path.join(ROOT, rel));
  const { width: w, height: h, rgba } = png;
  const alphaCut = 21; // Runtime/editor alphaTest .08 ~= 20.4/255.
  let minX = w, maxX = -1, minY = h, maxY = -1;
  const columnRows = Array(w).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] < alphaCut) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      columnRows[x]++;
    }
  }
  let axisX = 0;
  for (let x = 1; x < w; x++) if (columnRows[x] > columnRows[axisX]) axisX = x;
  const corridor = 5;
  const exact = new Map();
  const rows = [];
  for (let y = minY; y <= maxY; y++) {
    const rowColors = [];
    for (let x = Math.max(minX, axisX - corridor); x <= Math.min(maxX, axisX + corridor); x++) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] < alphaCut) continue;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      rowColors.push([r, g, b]);
      const key = hex(r, g, b);
      const rec = exact.get(key) || { count: 0, minY: y, maxY: y, r, g, b };
      rec.count++; rec.minY = Math.min(rec.minY, y); rec.maxY = Math.max(rec.maxY, y);
      exact.set(key, rec);
    }
    if (!rowColors.length) { rows.push({ y, cls: 'empty', sample: null }); continue; }
    const avg = [0, 1, 2].map(k => Math.round(rowColors.reduce((s, c) => s + c[k], 0) / rowColors.length));
    rows.push({ y, cls: colorClass(...avg), sample: hex(...avg) });
  }

  // Fill single-row classification glitches between identical neighbours before run compression.
  for (let i = 1; i < rows.length - 1; i++) {
    if (rows[i - 1].cls === rows[i + 1].cls && rows[i].cls !== rows[i - 1].cls) rows[i].cls = rows[i - 1].cls;
  }
  const runs = [];
  for (const row of rows) {
    const last = runs[runs.length - 1];
    if (last && last.cls === row.cls && row.y === last.endY + 1) last.endY = row.y;
    else runs.push({ cls: row.cls, startY: row.y, endY: row.y });
  }
  const meaningfulRuns = runs.filter(r => r.endY - r.startY + 1 >= 3);
  const warmRuns = meaningfulRuns.filter(r => r.cls === 'warm').sort((a, b) => (b.endY - b.startY) - (a.endY - a.startY));
  const bestWarm = warmRuns[0] || null;
  const topColors = [...exact.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 18)
    .map(([key, v]) => `${key} n=${v.count} y=${v.minY}-${v.maxY} class=${colorClass(v.r, v.g, v.b)}`);

  const planeW = 0.5;
  const planeH = planeW * (h / w);
  const pixelYToGripZ = y => ((y / h) - 0.5) * planeH;
  const warmCandidate = bestWarm ? {
    startY: bestWarm.startY,
    endY: bestWarm.endY,
    centerY: (bestWarm.startY + bestWarm.endY) / 2,
    centerZ: pixelYToGripZ((bestWarm.startY + bestWarm.endY) / 2),
  } : null;

  console.log(`\n=== ${name} ===`);
  console.log(`size=${w}x${h} opaqueBounds=x${minX}-${maxX} y${minY}-${maxY} haftAxisX=${axisX} rows=${columnRows[axisX]}`);
  console.log(`planeH(base width .5)=${planeH.toFixed(6)} zPerPixel=${(planeH / h).toFixed(9)}`);
  console.log('top shaft-corridor hexes:');
  for (const line of topColors) console.log(`  ${line}`);
  console.log('classification runs >=3 rows:');
  for (const run of meaningfulRuns) {
    console.log(`  ${run.cls.padEnd(9)} y=${run.startY}-${run.endY} len=${run.endY - run.startY + 1} z=${pixelYToGripZ(run.startY).toFixed(4)}..${pixelYToGripZ(run.endY).toFixed(4)}`);
  }
  console.log(`longestWarmCandidate=${JSON.stringify(warmCandidate)}`);
}

for (const [name, rel] of FILES) analyze(name, rel);
throw new Error('intentional temporary failure so the pixel report is preserved in CI logs');
