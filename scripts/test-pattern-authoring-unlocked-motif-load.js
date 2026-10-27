'use strict';

// Exercises the real motif-loading and library-apply functions with a tiny
// canvas/image harness; no WebGL, DOM, or network access is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const docs = path.resolve(__dirname, '../docs'); // Used to check each committed motif referenced by the game.
const source = fs.readFileSync(path.join(docs, 'js/pattern-authoring.js'), 'utf8'); // The actual shared editor implementation under test.
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from !== -1 && to !== -1, 'pattern editor still contains the expected loader functions');
  return source.slice(from, to);
}
const loadSource = section('    function drawMotifImageIntoSketch(source) {', '    function syncInputsFromCfg()'); // Extracts the implementation unchanged for execution.
const applySource = section('    function applyPatternData(data) {', '\n    if (cfg.motifDataUrl'); // Includes the actual unlocked-library selection handler.
const images = []; // Simulated browser PNG requests, completed manually to exercise races.
const draws = []; // Records which artwork the real draw function actually put on the sketch.
let undoCount = 0; // Ensures a failed load does not erase the previous sketch.
class TestImage {
  constructor() { images.push(this); }
  set src(value) {
    assert.equal(this.crossOrigin, 'anonymous', 'crossOrigin is set before loading external PNGs');
    this._src = value;
  }
  get src() { return this._src; }
}
const ctx = vm.createContext({ Image: TestImage, draws, assert, undo: () => undoCount++ });
const harness = vm.runInContext(`(() => {
  const SKETCH_CANVAS_SIZE = 230;
  const SKETCH_SIZE = 192;
  const PATTERN_DEFAULTS = { motifScale: 1, meshScale: 1, overpassClearanceMultiplier: 3 };
  const PATTERN_SCALE_MIN = 0.4, PATTERN_SCALE_MAX = 3.2, OVERPASS_CLEARANCE_MIN = 3, OVERPASS_CLEARANCE_MAX = 12;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const legacyFrameFields = value => value;
  const cfg = {};
  const sketchCtx = {
    clearRect() {},
    drawImage(image) { draws.push(image.src); },
    globalCompositeOperation: 'destination-out',
  };
  const previewStatus = { textContent: '' };
  let closed = false, loadedLibraryId = 'unlocked-id', motifLoadRevision = 0, motifLoadPending = false;
  let frames = 0, previews = 0;
  const pushUndo = () => undo();
  const drawFrameCanvas = () => { frames++; };
  const schedulePreview = () => { previews++; };
  const syncInputsFromCfg = () => {};
  const updateValLabels = () => {};
  ${loadSource}
  ${applySource}
  return {
    select: applyPatternData,
    open: drawMotifImageIntoSketch,
    cancelPending() { motifLoadRevision++; motifLoadPending = false; },
    pending: () => motifLoadPending,
    status: () => previewStatus.textContent,
    cfg,
    frames: () => frames,
    previews: () => previews,
    composite: () => sketchCtx.globalCompositeOperation,
    libraryId: () => loadedLibraryId,
  };
})()`, ctx);

harness.select({ motifUrl: 'https://static.example.org/motif_unlocked.png', motifScale: 1.5 });
assert.equal(images[0].src, 'https://static.example.org/motif_unlocked.png', 'unlocked repository PNG loads instead of drawing a blank sketch');
assert.equal(harness.cfg.motifScale, 1.5, 'repo pattern placement settings survive selection');
assert.equal(harness.pending(), true, 'saving must wait for the PNG');
images[0].width = images[0].naturalWidth = 192;
images[0].height = images[0].naturalHeight = 192;
images[0].onload();
assert.deepEqual(draws, ['https://static.example.org/motif_unlocked.png'], 'selected motif is drawn');
assert.equal(harness.composite(), 'source-over', 'a preceding eraser cannot erase an imported motif');
assert.equal(harness.pending(), false, 'pattern can save after its PNG loads');

harness.select({ motifDataUrl: 'data:image/png;base64,AA==' });
images[1].onload();
assert.equal(draws[1], 'data:image/png;base64,AA==', 'saved embedded motifs still load');

harness.select({ motifUrl: 'https://static.example.org/old.png' });
harness.select({ motifUrl: 'https://static.example.org/new.png' });
images[2].onload();
assert.equal(draws.length, 2, 'an older request cannot overwrite a newer selection');
images[3].onload();
assert.equal(draws[2], 'https://static.example.org/new.png');

harness.select({ motifUrl: 'https://static.example.org/slow.png' });
harness.cancelPending();
images[4].onload();
assert.equal(draws.length, 3, 'manual drawing cancels an unfinished PNG load');

harness.select({ motifUrl: 'https://static.example.org/missing.png' });
const undosBeforeError = undoCount;
images[5].onerror();
assert.match(harness.status(), /Could not load motif artwork/);
assert.equal(harness.pending(), false);
assert.equal(harness.libraryId(), null, 'a failed PNG cannot be saved with the unlocked library ID');
assert.equal(undoCount, undosBeforeError, 'a failed PNG does not erase the old canvas');

// The initial applied-treatment path must also accept a PNG URL.
assert.match(source, /if \(cfg\.motifDataUrl \|\| cfg\.motifUrl\) drawMotifImageIntoSketch/);
const catalog = JSON.parse(fs.readFileSync(path.join(docs, 'config/patterns/index.json'), 'utf8')); // The shipped list of unlockable and free repo motifs.
for (const entry of catalog.patterns) {
  const definition = JSON.parse(fs.readFileSync(path.join(docs, entry.file), 'utf8')); // The source for the URL provided by RepoPatternLibrary.
  if (definition.motifPng) {
    assert(fs.existsSync(path.join(docs, definition.motifPng)), entry.id + ' motif PNG is shipped alongside its definition');
  }
}
console.log('Pattern Authoring repository PNG import, stale-load protection and embedded motif regression passed');
