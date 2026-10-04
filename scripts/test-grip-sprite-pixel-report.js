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
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Not PNG: ${filePath}`);
  let p = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (p < bytes.length) {
    const len = bytes.readUInt32BE(p); p += 4;
    const type = bytes.subarray(p, p + 4).toString('ascii'); p += 4;
    const data = bytes.subarray(p, p + len); p += len + 4;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) throw new Error(`Expected RGBA8 non-interlaced PNG: ${filePath}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = Buffer.alloc(width * height * 4);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y ? rgba.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const v = raw[src++];
      const a = x >= 4 ? row[x - 4] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= 4 ? prev[x - 4] : 0;
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

function colorKind(r, g, b) {
  if (Math.max(r, g, b) < 24) return 'outline'; // Dark ink should not split a continuous haft-color run.
  if (g - r >= 12 && b - r >= 9) return 'verdigris'; // Covers the sprite's #466461/#67938F/#7CB0AA family.
  if (r >= g && g >= b && r - b >= 4) return 'wood'; // Covers the brown/tan #403B36/#5E564F/#504A2A family.
  return 'other';
}

function analyze(name, rel) {
  const { width: w, height: h, rgba } = decodeRgbaPng(path.join(ROOT, rel));
  const alphaCut = 21; // Runtime/editor alphaTest .08 ~= 20.4/255.
  const opaqueByX = Array(w).fill(0); // Used to locate the longest opaque haft axis automatically.
  let minY = h, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (rgba[i + 3] < alphaCut) continue;
    opaqueByX[x]++;
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  let axisX = 0;
  for (let x = 1; x < w; x++) if (opaqueByX[x] > opaqueByX[axisX]) axisX = x;

  const bins = [];
  const binSize = 20;
  for (let startY = Math.floor(minY / binSize) * binSize; startY <= maxY; startY += binSize) {
    const counts = { wood: 0, verdigris: 0, other: 0, outline: 0 };
    for (let y = Math.max(minY, startY); y <= Math.min(maxY, startY + binSize - 1); y++) {
      for (let x = Math.max(0, axisX - 7); x <= Math.min(w - 1, axisX + 7); x++) {
        const i = (y * w + x) * 4;
        if (rgba[i + 3] < alphaCut) continue;
        counts[colorKind(rgba[i], rgba[i + 1], rgba[i + 2])]++;
      }
    }
    const colored = counts.wood + counts.verdigris + counts.other;
    const cls = counts.wood >= Math.max(3, counts.verdigris * 1.5) && counts.wood >= counts.other ? 'WOOD'
      : counts.verdigris >= Math.max(3, counts.wood) && counts.verdigris >= counts.other ? 'VERD'
      : 'mixed';
    bins.push({ startY, endY: Math.min(maxY, startY + binSize - 1), ...counts, colored, cls });
  }

  const planeH = 0.5 * h / w;
  const zForY = y => ((y / h) - 0.5) * planeH;
  console.log(`\n=== ${name} axisX=${axisX} opaqueY=${minY}-${maxY} z/pixel=${(planeH / h).toFixed(9)} ===`);
  for (const bin of bins) {
    if (!bin.colored && !bin.outline) continue;
    console.log(`${String(bin.startY).padStart(4)}-${String(bin.endY).padEnd(4)} ${bin.cls.padEnd(5)} wood=${String(bin.wood).padStart(3)} verd=${String(bin.verdigris).padStart(3)} other=${String(bin.other).padStart(3)} outline=${String(bin.outline).padStart(3)} z=${zForY(bin.startY).toFixed(4)}..${zForY(bin.endY).toFixed(4)}`);
  }
}

for (const [name, rel] of FILES) analyze(name, rel);
throw new Error('intentional temporary failure so the refined pixel report is preserved in CI logs');
