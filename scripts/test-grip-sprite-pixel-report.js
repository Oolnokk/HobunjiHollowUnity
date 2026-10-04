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
  let p = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
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
  const stride = width * 4, rgba = Buffer.alloc(width * height * 4);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++], row = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y ? rgba.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const v = raw[src++], a = x >= 4 ? row[x - 4] : 0, b = prev ? prev[x] : 0, c = prev && x >= 4 ? prev[x - 4] : 0;
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

function kindFor(r, g, b) {
  if (Math.max(r, g, b) < 24) return 'outline';
  if (g - r >= 12 && b - r >= 9) return 'verdigris';
  if (r >= g && g >= b && r - b >= 4) return 'wood';
  return 'other';
}

function componentsForKind(w, h, rgba, wanted) {
  const mask = new Uint8Array(w * h); // Marks exact color-family pixels for connected-component haft detection.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (rgba[i + 3] >= 21 && kindFor(rgba[i], rgba[i + 1], rgba[i + 2]) === wanted) mask[y * w + x] = 1;
  }
  const seen = new Uint8Array(mask.length);
  const components = [];
  const dirs = [-1, 0, 1];
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || seen[seed]) continue;
    const queue = [seed], points = [];
    seen[seed] = 1;
    while (queue.length) {
      const idx = queue.pop(), x = idx % w, y = Math.floor(idx / w);
      points.push([x, y]);
      for (const dy of dirs) for (const dx of dirs) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h) continue;
        const next = (y + dy) * w + x + dx;
        if (mask[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
      }
    }
    if (points.length >= 8) components.push(points);
  }
  return components.sort((a, b) => b.length - a.length);
}

function describeComponent(points, w, h) {
  let sx = 0, sy = 0, minX = w, maxX = -1, minY = h, maxY = -1;
  for (const [x, y] of points) { sx += x; sy += y; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const mx = sx / points.length, my = sy / points.length;
  let xx = 0, yy = 0, xy = 0;
  for (const [x, y] of points) { const dx = x - mx, dy = y - my; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  const theta = 0.5 * Math.atan2(2 * xy, xx - yy);
  let ux = Math.cos(theta), uy = Math.sin(theta);
  if (Math.abs(uy) > Math.abs(ux) && uy < 0) { ux = -ux; uy = -uy; }
  let minP = Infinity, maxP = -Infinity;
  for (const [x, y] of points) { const p = (x - mx) * ux + (y - my) * uy; minP = Math.min(minP, p); maxP = Math.max(maxP, p); }
  const middleP = (minP + maxP) / 2;
  const centerX = mx + middleP * ux, centerY = my + middleP * uy;
  const z = ((centerY / h) - 0.5) * (0.5 * h / w);
  return { count: points.length, minX, maxX, minY, maxY, angleDeg: theta * 180 / Math.PI, centerX, centerY, centerZ: z, axisLength: maxP - minP };
}

for (const [name, rel] of FILES) {
  const { width: w, height: h, rgba } = decodeRgbaPng(path.join(ROOT, rel));
  console.log(`\n=== ${name} ${w}x${h} ===`);
  for (const kind of ['wood', 'verdigris']) {
    console.log(`${kind.toUpperCase()} components:`);
    const components = componentsForKind(w, h, rgba, kind).slice(0, 8);
    components.forEach((points, index) => {
      const d = describeComponent(points, w, h);
      console.log(`  #${index + 1} n=${d.count} bbox=x${d.minX}-${d.maxX} y${d.minY}-${d.maxY} angle=${d.angleDeg.toFixed(2)} axisLen=${d.axisLength.toFixed(1)} midpoint=(${d.centerX.toFixed(2)},${d.centerY.toFixed(2)}) z=${d.centerZ.toFixed(6)}`);
    });
  }
}

throw new Error('intentional temporary failure so the connected-color haft report is preserved in CI logs');
