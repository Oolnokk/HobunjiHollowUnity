'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const editorPath = path.join(root, 'docs', 'tools', 'pattern-editor', 'index.html');
const html = fs.readFileSync(editorPath, 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert(start >= 0, `Pattern Editor must define ${name}`);
  const brace = html.indexOf('{', start);
  assert(brace >= 0, `Pattern Editor function ${name} must have a body`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i], next = html[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Could not extract complete function ${name}`);
}

const helperNames = [
  'opaqueGarmentMaskFromRgba',
  'trimableGarmentMaskFromRgba',
  'canvasTrimGeometry',
  'maskBounds',
  'connectedTrimRegions',
  'trimRegionFeature',
  'matchTrimReplayRegions',
  'nearestTrimRegion',
  'nearestRegionBoundaryPoint',
  'normalizedXYInBounds',
  'remapTrimAuthorOpsForTarget',
];

const helperSource = helperNames.map(extractFunction).join('\n');
const buildHarness = new Function(`
  const STRUCTURAL_TRIM_ALPHA_MIN = 128;
  const STRUCTURAL_TRIM_DARK_MAX = 28;
  const cloneTrimAuthorOps = ops => JSON.parse(JSON.stringify(ops));
  ${helperSource}
  return { canvasTrimGeometry, maskBounds, connectedTrimRegions, remapTrimAuthorOpsForTarget };
`);
const helpers = buildHarness();

class CanvasStub {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    const self = this;
    return {
      getImageData() { return { data: self.pixels.slice() }; },
    };
  }
}

function fillRect(canvas, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * canvas.width + x) * 4;
    canvas.pixels[i] = 120;
    canvas.pixels[i + 1] = 90;
    canvas.pixels[i + 2] = 60;
    canvas.pixels[i + 3] = 255;
  }
}

function normalizedPixel(x, y, bounds) {
  return {
    x: bounds.width > 1 ? (x - bounds.x) / (bounds.width - 1) : 0.5,
    y: bounds.height > 1 ? (y - bounds.y) / (bounds.height - 1) : 0.5,
  };
}

function denormalizedPixel(point, bounds) {
  return {
    x: bounds.x + point.x * Math.max(0, bounds.width - 1),
    y: bounds.y + point.y * Math.max(0, bounds.height - 1),
  };
}

const source = new CanvasStub(24, 24);
const target = new CanvasStub(24, 24);
fillRect(source, 2, 2, 8, 5);    // Upper source cloth island.
fillRect(source, 5, 13, 17, 19); // Lower source cloth island.
fillRect(target, 11, 1, 21, 5);  // Upper target island moves right and widens.
fillRect(target, 1, 11, 11, 21); // Lower target island moves left and grows taller.

const sourceGeometry = helpers.canvasTrimGeometry(source);
const targetGeometry = helpers.canvasTrimGeometry(target);
const sourceBounds = helpers.maskBounds(sourceGeometry.mask, source.width, source.height);
const targetBounds = helpers.maskBounds(targetGeometry.mask, target.width, target.height);
assert(sourceBounds && targetBounds, 'synthetic source and target garments must have structural bounds');

const upper = normalizedPixel(5, 3, sourceBounds);
const lower = normalizedPixel(10, 16, sourceBounds);
const ops = [
  { type: 'selectFullOutline' },
  { type: 'stroke', mode: 'paint', sizeNorm: 0.1, points: [upper] },
  { type: 'stroke', mode: 'eraser', sizeNorm: 0.1, points: [upper, lower] },
  { type: 'stroke', mode: 'brush', sizeNorm: 0.1, points: [upper] },
  { type: 'expandInward', amount: 4 },
];

const remapped = helpers.remapTrimAuthorOpsForTarget(ops, source, target);
assert.equal(remapped[0].type, 'selectFullOutline', 'non-stroke authoring order begins unchanged');
assert.equal(remapped.at(-1).type, 'expandInward', 'non-stroke authoring order ends unchanged');

const paint = remapped.find(op => op.type === 'stroke' && op.mode === 'paint');
assert(paint, 'region mapper retains Direct Paint operations');
const paintPx = denormalizedPixel(paint.points[0], targetBounds);
assert(paintPx.x >= 11 && paintPx.x <= 21 && paintPx.y >= 1 && paintPx.y <= 5,
  'upper source edit maps into the upper target cloth island rather than global garment coordinates');

const erasers = remapped.filter(op => op.type === 'stroke' && op.mode === 'eraser');
assert.equal(erasers.length, 2, 'a stroke that crosses disconnected cloth regions is split instead of drawing a bridge through empty space');
const erasePixels = erasers.map(op => denormalizedPixel(op.points[0], targetBounds));
assert(erasePixels.some(p => p.x >= 11 && p.y <= 5), 'one eraser segment remains on the upper target island');
assert(erasePixels.some(p => p.x <= 11 && p.y >= 11), 'one eraser segment remains on the lower target island');

const brush = remapped.find(op => op.type === 'stroke' && op.mode === 'brush');
assert(brush, 'region mapper retains Outline Brush operations');
const brushPx = denormalizedPixel(brush.points[0], targetBounds);
const targetLayout = helpers.connectedTrimRegions(targetGeometry.mask, target.width, target.height);
const upperRegion = targetLayout.regions.find(region => (
  brushPx.x >= region.bounds.x && brushPx.x <= region.bounds.x + region.bounds.width - 1 &&
  brushPx.y >= region.bounds.y && brushPx.y <= region.bounds.y + region.bounds.height - 1
));
assert(upperRegion, 'remapped Outline Brush point belongs to a target structural region');
assert(upperRegion.boundaryIndices.some(index => {
  const x = index % target.width, y = Math.floor(index / target.width);
  return Math.abs(x - brushPx.x) < 0.01 && Math.abs(y - brushPx.y) < 0.01;
}), 'remapped Outline Brush snaps to the matching local target contour');

assert.notEqual(erasers[0].sizeNorm, erasers[1].sizeNorm,
  'brush/eraser size scales independently with each matched cloth region rather than one whole-garment scale');

console.log('trim region replay regression passed');
