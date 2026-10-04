'use strict';

// Executes docs/js/trim-contour-warp.js (cross-species trim transfer) on
// synthetic garments, plus the Pattern Editor's journal replay of the
// 'baseMask' operation that replicated variants start from.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const warp = require(path.join(root, 'docs', 'js', 'trim-contour-warp.js'));

function garment(width, height) {
  return { width, height, rgba: new Uint8ClampedArray(width * height * 4) };
}
function paintRect(g, x0, y0, x1, y1, rgb = [120, 90, 60]) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * g.width + x) * 4;
    g.rgba[i] = rgb[0]; g.rgba[i + 1] = rgb[1]; g.rgba[i + 2] = rgb[2]; g.rgba[i + 3] = 255;
  }
}
function clearRect(g, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.rgba.fill(0, (y * g.width + x) * 4, (y * g.width + x) * 4 + 4);
}
function maskWhere(g, predicate) {
  const mask = new Uint8Array(g.width * g.height);
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) if (g.rgba[(y * g.width + x) * 4 + 3] && predicate(x, y)) mask[y * g.width + x] = 1;
  return mask;
}
function transfer(source, sourceMask, target) {
  return warp.warpTrimMask({
    sourceRgba: source.rgba, sourceMask, sourceWidth: source.width, sourceHeight: source.height,
    targetRgba: target.rgba, targetWidth: target.width, targetHeight: target.height,
  });
}
function countIn(mask, width, x0, y0, x1, y1) {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) n += mask[y * width + x];
  return n;
}

// 1. Two separate cloth pieces that move and resize independently.
const twoSource = garment(60, 60), twoTarget = garment(60, 60);
paintRect(twoSource, 5, 5, 30, 14);   // upper piece
paintRect(twoSource, 10, 30, 50, 50); // lower piece
paintRect(twoTarget, 25, 3, 55, 18);  // upper piece moves right and gets taller
paintRect(twoTarget, 3, 28, 40, 55);  // lower piece moves left and grows
const twoMask = maskWhere(twoSource, (x, y) => (y <= 14 && y <= 6) || (y >= 30 && x <= 12)); // top band of upper piece, left band of lower piece
const two = transfer(twoSource, twoMask, twoTarget);
assert.equal(two.report.matchedRegions, 2, 'both cloth pieces are matched to their counterparts');
const W = twoTarget.width;
assert(countIn(two.mask, W, 27, 3, 53, 4) >= 0.9 * 27 * 2, 'top band lands along the top edge of the moved upper piece');
assert.equal(countIn(two.mask, W, 30, 9, 50, 14), 0, 'interior of the taller upper piece stays untrimmed');
assert(countIn(two.mask, W, 3, 32, 5, 51) >= 0.9 * 3 * 20, 'left band lands along the left edge of the moved lower piece');
assert.equal(countIn(two.mask, W, 15, 32, 38, 53), 0, 'the rest of the lower piece stays untrimmed');
assert.equal(countIn(two.mask, W, 0, 20, 59, 26), 0, 'nothing is bridged through the gap between pieces');

// 2. Inner contour (collar hole): a band around the hole follows the target hole, not the outer hem.
const ringSource = garment(50, 50), ringTarget = garment(50, 50);
paintRect(ringSource, 5, 5, 44, 44); clearRect(ringSource, 18, 18, 31, 31);
paintRect(ringTarget, 3, 3, 46, 46); clearRect(ringTarget, 22, 15, 37, 30); // hole moves up-right and widens
const ringMask = maskWhere(ringSource, (x, y) => x >= 15 && x <= 34 && y >= 15 && y <= 34);
const ring = transfer(ringSource, ringMask, ringTarget);
const RW = ringTarget.width;
assert(countIn(ring.mask, RW, 22, 12, 37, 14) >= 0.8 * 16 * 3, 'band sits above the moved target hole');
assert(countIn(ring.mask, RW, 22, 31, 37, 33) >= 0.8 * 16 * 3, 'band sits below the moved target hole');
assert.equal(countIn(ring.mask, RW, 3, 3, 46, 6), 0, 'outer hem is not trimmed');
assert.equal(countIn(ring.mask, RW, 3, 40, 46, 46), 0, 'outer hem is not trimmed at the bottom either');

// 3. Signed depth: dark line art bordering the cloth stays untrimmed when the source left it bare.
const lineSource = garment(40, 40), lineTarget = garment(40, 40);
paintRect(lineSource, 4, 4, 35, 35, [10, 10, 10]); paintRect(lineSource, 6, 6, 33, 33);
paintRect(lineTarget, 2, 2, 37, 37, [10, 10, 10]); paintRect(lineTarget, 5, 5, 34, 34);
const lineMask = maskWhere(lineSource, (x, y) => x >= 6 && x <= 33 && y >= 6 && y <= 33 && (x <= 8 || y <= 8 || x >= 31 || y >= 31));
const line = transfer(lineSource, lineMask, lineTarget);
let lineArtTrim = 0, clothBand = 0;
for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
  const p = y * 40 + x, cloth = x >= 5 && x <= 34 && y >= 5 && y <= 34;
  if (!cloth && line.mask[p]) lineArtTrim++;
  if (cloth && (x <= 7 || y <= 7 || x >= 32 || y >= 32) && line.mask[p]) clothBand++;
}
assert.equal(lineArtTrim, 0, 'untrimmed source line art never becomes trim on the target');
assert(clothBand > 0.9 * (30 * 30 - 26 * 26), 'edge band is carried just inside the target line art');

// 4. Run-length journal encoding round-trips exactly.
const runs = warp.encodeMaskRuns(two.mask);
assert.deepStrictEqual(Array.from(warp.decodeMaskRuns(runs, two.mask.length)), Array.from(two.mask), 'baseMask runs round-trip');

// 5. Pattern Editor journal replay: 'baseMask' restores exact pixels, later strokes still apply on top.
const html = fs.readFileSync(path.join(root, 'docs', 'tools', 'pattern-editor', 'index.html'), 'utf8');
function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `Pattern Editor must define ${name}`);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    const ch = html[i], next = html[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) { if (escaped) { escaped = false; continue; } if (ch === '\\') { escaped = true; continue; } if (ch === quote) quote = null; continue; }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}
class CanvasStub {
  constructor(width, height, pixels) { this.width = width; this.height = height; this.pixels = pixels || new Uint8ClampedArray(width * height * 4); }
  getContext() {
    const self = this;
    return {
      getImageData() { return { data: self.pixels.slice() }; },
      createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
      putImageData(image) { self.pixels.set(image.data); },
    };
  }
}
const editor = new Function('window', 'document', `
  const STRUCTURAL_TRIM_ALPHA_MIN = 128, STRUCTURAL_TRIM_DARK_MAX = 28;
  ${['opaqueGarmentMaskFromRgba', 'trimableGarmentMaskFromRgba', 'canvasTrimGeometry', 'maskBounds', 'buildInwardSilhouetteMap', 'distanceFromSelectedContour', 'replayTrimAuthorOps'].map(extractFunction).join('\n')}
  return { replayTrimAuthorOps };
`)({ TrimContourWarp: warp }, { createElement: () => new CanvasStub(1, 1) });
const realAssign = Object.assign;
Object.assign = (targetObj, props) => (props && 'width' in props && 'height' in props && targetObj instanceof CanvasStub) ? new CanvasStub(props.width, props.height) : realAssign(targetObj, props);
try {
  const targetCanvas = new CanvasStub(twoTarget.width, twoTarget.height, twoTarget.rgba);
  const baseOp = { type: 'baseMask', width: twoTarget.width, height: twoTarget.height, runs };
  const replayed = editor.replayTrimAuthorOps([baseOp], targetCanvas);
  const replayedMask = Array.from({ length: two.mask.length }, (_, i) => (replayed.pixels[i * 4 + 3] > 16 ? 1 : 0));
  assert.deepStrictEqual(replayedMask, Array.from(two.mask), 'journal replay of a baseMask op reproduces the transferred pixels exactly');
  const erased = editor.replayTrimAuthorOps([baseOp, { type: 'stroke', mode: 'eraser', sizeNorm: 0.2, points: [{ x: 0.5, y: 0 }] }], targetCanvas);
  let erasedCount = 0;
  for (let i = 0; i < two.mask.length; i++) if (two.mask[i] && erased.pixels[i * 4 + 3] <= 16) erasedCount++;
  assert(erasedCount > 0, 'cleanup strokes recorded after a baseMask op still apply on top of it');
  assert.throws(() => editor.replayTrimAuthorOps([{ ...baseOp, width: 10 }], targetCanvas), /replicate it again/, 'a baseMask for a different canvas size is rejected rather than misaligned');
} finally {
  Object.assign = realAssign;
}

// 6. The editor loads the module and uses it for replication.
assert.match(html, /js\/trim-contour-warp\.js\?v=[A-Za-z0-9_-]+/, 'Pattern Editor loads the contour warp module');
assert.match(html, /transferTrimMaskByContour\(sourceMask, sourceGarment, targetGarment\)/, 'replication transfers the finished mask through the contour warp');

console.log('trim contour warp regression passed');
