'use strict';
const assert = require('node:assert/strict'); // Verifies uploaded RGBA sprite masks, not just the availability of their URLs.
const fs = require('node:fs'); // Reads the exact PNG bytes used by the browser/held-item renderer.
const zlib = require('node:zlib'); // PNG's built-in lossless IDAT stream uses standard DEFLATE.

function summary(file) {
  const png = fs.readFileSync(file); // Loaded once per distinct authored source.
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', 'PNG signature: ' + file);
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20); // Used to compute the literal RGBA scanline footprint.
  assert.equal(png[24], 8, '8-bit sprites required: ' + file);
  assert.equal(png[25], 6, 'RGBA transparency required: ' + file);
  const chunks = []; // Concatenated IDAT blocks contain the actual rows, not browser-generated fallback pixels.
  for (let cursor = 8; cursor + 12 <= png.length;) {
    const length = png.readUInt32BE(cursor);
    const type = png.toString('ascii', cursor + 4, cursor + 8);
    if (type === 'IDAT') chunks.push(png.subarray(cursor + 8, cursor + 8 + length));
    cursor += 12 + length;
    if (type === 'IEND') break;
  }
  const data = zlib.inflateSync(Buffer.concat(chunks)); // PNG filter bytes still need per-row reconstruction.
  const stride = width * 4; // Four eight-bit RGBA channels per source pixel.
  let prior = Buffer.alloc(stride), offset = 0; // Previous row for filters 2–4 and the running compressed-data index.
  const stats = { file: file.split('/').pop(), width, height, transparent: 0, solid: 0, partial: 0, darkSolid: 0, whiteSolid: 0 }; // Measured alpha distribution to diagnose obscured overlays.
  for (let row = 0; row < height; row++) {
    const filter = data[offset++]; // PNG filter is stored before each compressed scanline.
    const current = Buffer.alloc(stride);
    for (let col = 0; col < stride; col++) {
      const left = col >= 4 ? current[col - 4] : 0, up = prior[col], upperLeft = col >= 4 ? prior[col - 4] : 0;
      let prediction = 0;
      if (filter === 1) prediction = left;
      else if (filter === 2) prediction = up;
      else if (filter === 3) prediction = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
        prediction = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      } else assert.equal(filter, 0, 'Supported PNG filter method: ' + file);
      current[col] = (data[offset + col] + prediction) & 255;
    }
    for (let col = 0; col < stride; col += 4) {
      const alpha = current[col + 3]; // Source alpha, after PNG row filters, is the actual compositing mask.
      if (alpha === 0) stats.transparent++;
      else if (alpha === 255) stats.solid++;
      else stats.partial++;
      if (alpha >= 240 && Math.max(current[col], current[col + 1], current[col + 2]) <= 20) stats.darkSolid++;
      if (alpha >= 240 && Math.min(current[col], current[col + 1], current[col + 2]) >= 245) stats.whiteSolid++;
    }
    offset += stride;
    prior = current;
  }
  assert.equal(offset, data.length, 'Decoded all PNG scanlines for ' + file);
  assert.equal(stats.transparent + stats.solid + stats.partial, width * height);
  return stats;
}
const assets = ['scroll.png', 'scroll_binding.png', 'powder.png', 'iridescent_sheen.png'];
const stats = assets.map(name => summary('docs/assets/objectsprites/' + name)); // The same layers the real sprite compositor loads.
for (const data of stats) {
  assert.ok(data.solid + data.partial > 0, data.file + ' must have visible painted pixels');
  console.log('Koma PNG alpha:', JSON.stringify(data));
}
assert.equal(stats[0].width, stats[1].width);
assert.equal(stats[0].height, stats[1].height);
console.log('Uploaded scroll layers, Koma powder and iridescent overlay PNG masks decoded successfully.');
