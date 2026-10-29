'use strict';

const assert = require('node:assert/strict'); // Runs the bridge brush fill on a synthetic two-block sprite.
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
const context = vm.createContext({ window, Uint8Array, Uint8ClampedArray, Int8Array, Int32Array, Math });
const file = 'docs/js/modular-weapon-bridge-fill.js';
vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
const { fillBridge, stampLine } = window.ModularWeaponBridgeFill;
const editorHtml = fs.readFileSync('docs/tools/modular-weapon-editor/index.html', 'utf8');
assert(/modular-weapon-bridge-fill\.js\?v=[A-Za-z0-9_-]+/.test(editorHtml), 'Editor must load the bridge fill module.');
assert(editorHtml.indexOf('modular-weapon-bridge-fill.js') < editorHtml.indexOf('sprite-cutter.js'), 'Bridge fill loads before the cutter.');

const W = 60, H = 30;
const SHADE = [60, 90, 95, 255], LIT = [110, 150, 155, 255], INK = [0, 0, 0, 255];
const src = new Uint8ClampedArray(W * H * 4);
const set = (x, y, c) => src.set(c, (y * W + x) * 4);
const get = (px, x, y) => Array.from(px.slice((y * W + x) * 4, (y * W + x) * 4 + 4));
// Two outlined blocks: shaded body with a lit top band.
for (const x0 of [2, 40]) {
  for (let y = 5; y < 25; y++) for (let x = x0; x < x0 + 18; x++) {
    const border = x === x0 || y === 5 || x === x0 + 17 || y === 24;
    set(x, y, border ? INK : (y < 11 ? LIT : SHADE));
  }
}
const mask = new Uint8Array(W * H);
stampLine(mask, W, H, null, { x: 12, y: 15 }, 4);
stampLine(mask, W, H, { x: 12, y: 15 }, { x: 48, y: 15 }, 4);
assert.equal(mask[15 * W + 30], 1, 'Stroke spans the gap.');
assert.equal(mask[2 * W + 30], 0, 'Stroke stays within its radius.');

const out = fillBridge(src, mask, W, H, { outlineThickness: 1, seed: 7 });
assert(out.seeds > 0 && out.grown > 0);
assert.equal(out.grown, out.filled, 'Every hollowed pixel reachable from metal is grown.');
// The stroke's edges over empty space become black rim; its middle becomes metal.
assert.deepEqual(get(out.pixels, 30, 15 - 4 + 0), INK.slice(0, 3).concat(255));
const middle = get(out.pixels, 30, 15);
assert(middle[3] === 255 && (middle[0] === SHADE[0] || middle[0] === LIT[0]), 'Gap middle is a sampled metal tone.');
// The old block outline crossed by the stroke is replaced with metal.
const crossed = get(out.pixels, 19, 15);
assert.notDeepEqual(crossed, INK, 'Block outline under the stroke is hollowed.');
// Only the two sampled tones (plus black rim) are written into the stroke.
for (let p = 0; p < W * H; p++) if (mask[p]) {
  const c = Array.from(out.pixels.slice(p * 4, p * 4 + 3)).join();
  assert(['0,0,0', SHADE.slice(0, 3).join(), LIT.slice(0, 3).join()].includes(c), 'Unexpected color ' + c);
}
// Pixels outside the stroke are untouched.
for (let p = 0; p < W * H; p++) if (!mask[p]) for (let c = 0; c < 4; c++) assert.equal(out.pixels[p * 4 + c], src[p * 4 + c]);
// Deterministic for a given seed.
assert.deepEqual(Array.from(fillBridge(src, mask, W, H, { outlineThickness: 1, seed: 7 }).pixels), Array.from(out.pixels));
// Both tones survive: the blocks' lit top band and shaded body continue into a stroke spanning both heights.
const tall = new Uint8Array(W * H);
stampLine(tall, W, H, { x: 12, y: 13 }, { x: 48, y: 13 }, 7);
const banded = fillBridge(src, tall, W, H, { outlineThickness: 1, seed: 2, lightDirection: null });
assert(banded.shaded > 0 && banded.unshaded > 0, 'Bridge keeps both shaded and unshaded tones.');
assert.deepEqual(get(banded.pixels, 30, 17).slice(0, 3), SHADE.slice(0, 3), 'Lower bridge continues the shaded body.');
assert.deepEqual(get(banded.pixels, 30, 10).slice(0, 3), LIT.slice(0, 3), 'Upper bridge continues the lit band.');
// Outline shading: every hollow pixel touching the black rim is shaded, whatever the light direction.
const isShade = (px, x, y) => get(px, x, y).slice(0, 3).join() === SHADE.slice(0, 3).join();
for (const light of [[0, -1], [0, 1], null]) {
  const r = fillBridge(src, tall, W, H, { outlineThickness: 1, seed: 2, lightDirection: light });
  assert(r.edgeShaded > 0);
  for (let x = 24; x <= 36; x++) {
    assert(isShade(r.pixels, x, 7) && isShade(r.pixels, x, 18), 'Thin shade line along both rims.');
  }
}
// The band is thicker on the side facing away from the light (light from the top → thick bottom band).
const bandDepth = (px, fromY, step) => { let d = 0; for (let y = fromY; isShade(px, 30, y) && d < 12; y += step) d++; return d; };
const topLit = fillBridge(src, tall, W, H, { outlineThickness: 1, seed: 2, lightDirection: [0, -1], shadeWidth: 0.4 });
const bottomLit = fillBridge(src, tall, W, H, { outlineThickness: 1, seed: 2, lightDirection: [0, 1], shadeWidth: 0.4 });
const lightUpper = fillBridge(src, tall, W, H, { outlineThickness: 1, seed: 2, lightDirection: [0, -1], shadeWidth: 0 });
assert(bandDepth(bottomLit.pixels, 7, 1) > bandDepth(topLit.pixels, 7, 1), 'Top band thickens when the light is below.');
assert(bandDepth(lightUpper.pixels, 7, 1) >= 1, 'Even at 0% a one-pixel shade line remains.');
// Colors that aren't the base metal hue (a red grip wrap) are kept under the stroke and never spread into it.
const wrapped = new Uint8ClampedArray(src);
const WRAP = [150, 40, 30, 255];
for (let y = 12; y < 18; y++) for (let x = 3; x < 19; x++) wrapped.set(WRAP, (y * W + x) * 4);
const wrapOut = fillBridge(wrapped, mask, W, H, { outlineThickness: 1, seed: 7, lightDirection: null });
for (let p = 0; p < W * H; p++) {
  const c = Array.from(wrapOut.pixels.slice(p * 4, p * 4 + 4)).join();
  if (Array.from(wrapped.slice(p * 4, p * 4 + 4)).join() === WRAP.join()) assert.equal(c, WRAP.join(), 'Wrap kept.');
  else if (mask[p]) assert.notEqual(c, WRAP.join(), 'Wrap color never spreads into the bridge.');
}
// Painted-over metal is kept; only empty space and outline ink under the stroke are regrown. The one exception is
// shaded metal on a channel linking the two blocks' lit bands, which becomes unshaded.
let relitCount = 0;
for (let p = 0; p < W * H; p++) if (mask[p] && src[p * 4 + 3] && src[p * 4] > 0) {
  const before = Array.from(src.slice(p * 4, p * 4 + 4)), after = Array.from(out.pixels.slice(p * 4, p * 4 + 4));
  if (before.join() === after.join()) continue;
  assert.deepEqual([before, after], [SHADE, LIT], 'Painted-over metal may only change from shaded to unshaded.');
  relitCount++;
}
assert(out.preserved > 0 && out.pools === 2 && out.poolsLinked === 1 && relitCount > 0);
// Separate unshaded pools touching the hollow get linked by an unshaded channel. Each block's lit pool sits in its
// own corner (left block bottom, right block top), so a plain race would leave the bridge shaded in the middle.
const pools = new Uint8ClampedArray(W * H * 4);
const setP = (x, y, c) => pools.set(c, (y * W + x) * 4);
for (const x0 of [2, 40]) for (let y = 2; y < 28; y++) for (let x = x0; x < x0 + 18; x++) {
  const border = x === x0 || y === 2 || x === x0 + 17 || y === 27;
  const litCorner = x0 === 2 ? (y >= 20 && y < 26) : (y >= 4 && y < 10);
  setP(x, y, border ? INK : litCorner ? LIT : SHADE);
}
const span = new Uint8Array(W * H);
stampLine(span, W, H, { x: 17, y: 15 }, { x: 42, y: 15 }, 12);
const linked = fillBridge(pools, span, W, H, { outlineThickness: 1, seed: 5, lightDirection: null });
assert.equal(linked.pools, 2);
assert.equal(linked.poolsLinked, 1);
assert(linked.channelled > 0);
// Walk the bridge middle column: a lit pixel exists there, and lit pixels connect both pools.
const litAt = (x, y) => { const p = (y * W + x) * 4; return linked.pixels[p] === LIT[0] && linked.pixels[p + 1] === LIT[1]; };
const seen = new Uint8Array(W * H), stack = [];
for (let y = 0; y < H; y++) for (let x = 0; x < 20; x++) if (litAt(x, y)) { seen[y * W + x] = 1; stack.push([x, y]); }
let reachedRight = false;
while (stack.length) {
  const [x, y] = stack.pop();
  if (x >= 40) { reachedRight = true; break; }
  for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny * W + nx] || !litAt(nx, ny)) continue;
    seen[ny * W + nx] = 1; stack.push([nx, ny]);
  }
}
assert(reachedRight, 'An unshaded channel connects the left and right lit pools.');
// A stroke touching no metal is rejected with a clear message.
const lonely = new Uint8Array(W * H);
stampLine(lonely, W, H, null, { x: 30, y: 2 }, 1);
assert.throws(() => fillBridge(src, lonely, W, H), /touch metal/);
assert.throws(() => fillBridge(src, new Uint8Array(W * H), W, H), /Paint over/);
// Auto-bridge: the two separate blocks get one stroke across the gap, overlapping both; touching pieces get none.
const { autoBridgeStrokes } = window.ModularWeaponBridgeFill;
const auto = autoBridgeStrokes(src, W, H, { radius: 5 });
assert.equal(auto.length, 1, 'One stroke joins two pieces.');
const xs = auto[0].points.map(([x]) => x);
assert(auto[0].closed && Math.min(...xs) <= 20 && Math.max(...xs) >= 40, 'The bridge polygon spans the gap between the blocks.');
const autoMask = new Uint8Array(W * H);
window.ModularWeaponBridgeFill.stampStroke(autoMask, W, H, auto[0]);
for (let x = 21; x < 40; x++) assert(autoMask[15 * W + x], 'Gap middle is covered.');
assert(!autoMask[1 * W + 30], 'Bridge stays the height of the facing edges, not the whole frame.');
assert(fillBridge(src, autoMask, W, H, { outlineThickness: 1 }).grown > 0, 'The proposed stroke fills.');
const joined = new Uint8ClampedArray(src);
for (let y = 12; y < 18; y++) for (let x = 19; x < 41; x++) joined.set(SHADE, (y * W + x) * 4);
assert.equal(autoBridgeStrokes(joined, W, H, { radius: 5 }).length, 0, 'Touching pieces need no bridge.');
// Outline ink belonging to another material (wood) stays black under the stroke; ink outlining metal opens up.
const WOOD = [120, 100, 40, 255];
const woody = new Uint8ClampedArray(W * H * 4);
for (let y = 5; y < 25; y++) for (let x = 2; x < 20; x++) woody.set(x === 2 || y === 5 || x === 19 || y === 24 ? INK : SHADE, (y * W + x) * 4);
for (let y = 5; y < 25; y++) for (let x = 40; x < 58; x++) woody.set(x === 40 || y === 5 || x === 57 || y === 24 ? INK : WOOD, (y * W + x) * 4);
const woodOut = fillBridge(woody, mask, W, H, { outlineThickness: 1, seed: 1 });
assert.deepEqual(get(woodOut.pixels, 40, 15), INK, 'Wood outline under the stroke stays black.');
assert.notDeepEqual(get(woodOut.pixels, 19, 15), INK, 'Metal outline under the stroke opens up.');
// Smudge: metal is pushed out into the gap and gets a fresh outline at the sprite's measured thickness; wood never moves.
{
  const T = window.ModularWeaponBridgeFill, sm = new Uint8ClampedArray(W * H * 4);
  for (let y = 5; y < 25; y++) for (let x = 2; x < 22; x++) sm.set(x < 4 || y < 7 || x > 19 || y > 22 ? INK : SHADE, (y * W + x) * 4);
  for (let y = 5; y < 25; y++) for (let x = 40; x < 58; x++) sm.set(x < 42 || y < 7 || x > 55 || y > 22 ? INK : WOOD, (y * W + x) * 4);
  const before = new Uint8ClampedArray(sm);
  const res = T.smudgeStroke(sm, W, H, { r: 5, points: [[17, 15], [22, 15], [27, 15], [31, 15]] });
  assert.equal(res.thickness, 2, 'Outline thickness measured from the sprite (2 px).');
  assert.deepEqual(get(sm, 26, 15).slice(0, 3), SHADE.slice(0, 3), 'Metal pushed into the gap.');
  let tip = 22; while (get(sm, tip, 15).join() === SHADE.join()) tip++;
  assert(tip > 26 && get(sm, tip, 15).join() === INK.join() && get(sm, tip + 1, 15).join() === INK.join(), 'Pushed metal ends in a fresh 2px outline.');
  for (let y = 5; y < 25; y++) for (let x = 40; x < 58; x++) assert.deepEqual(get(sm, x, y), get(before, x, y), 'Wood and its outline untouched.');
  // Regenerating the whole sprite's outline at an explicit thickness replaces the metal outline, not the wood's.
  const regen = new Uint8ClampedArray(before);
  T.rebuildOutline(before, regen, W, H, new Uint8Array(W * H).fill(1), { outlineThickness: 1 });
  assert.deepEqual(get(regen, 2, 15).slice(3), [0], 'Outer layer of the old 2px metal outline removed.');
  assert.deepEqual(get(regen, 3, 15), INK, 'New 1px outline drawn against the metal.');
  assert.deepEqual(get(regen, 40, 15), INK, 'Wood outline kept.');
}
console.log('modular weapon bridge fill OK');

// Pair-specific bridges survive config validation; explicit removal is kept; junk is rejected.
{
  const gameHtml = fs.readFileSync('docs/index.html', 'utf8');
  assert(/js\/modular-weapon-bridge-fill\.js\?v=[A-Za-z0-9_-]+/.test(gameHtml), 'The game loads the bridge fill module.');
  assert(gameHtml.indexOf('js/modular-weapon-bridge-fill.js') < gameHtml.indexOf('js/modular-weapons.js'), 'Bridge fill loads before the compositor.');
  const win = { console };
  const ctx = vm.createContext({ window: win, JSON, Object, Array, Number, Math, String, Map, WeakMap, Promise, Error });
  for (const path of ['docs/config/modular-weapons.js', 'docs/js/modular-weapons.js']) {
    vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  }
  const api = win.ModularWeapons;
  const cfg = JSON.parse(JSON.stringify(api.getConfig()));
  const shaftKey = Object.keys(cfg.shafts)[0], headKey = Object.keys(cfg.heads)[0];
  cfg.shafts[shaftKey].overrides[headKey] = { bridges: {
    strokes: [{ r: 12, points: [[100, 200], [140, 260], ['bad', 3]] }, { r: 5, points: [] }],
    outline: 99, light: [0, -1], shade: 0.4, seed: 3 } };
  const saved = api.replace(cfg).shafts[shaftKey].overrides[headKey].bridges;
  assert.equal(saved.strokes.length, 1, 'Empty strokes dropped.');
  assert.equal(JSON.stringify(saved.strokes[0].points), '[[100,200],[140,260]]', 'Non-numeric points dropped.');
  assert.equal(saved.outline, 32, 'Outline clamped.');
  assert.equal(JSON.stringify(saved.light), '[0,-1]');
  assert.equal(api.settings(shaftKey, headKey).bridges.shade, 0.4, 'Settings expose the pair bridges to compose().');
  cfg.shafts[shaftKey].overrides[headKey] = { bridges: null };
  assert.equal(api.replace(cfg).shafts[shaftKey].overrides[headKey].bridges, null, 'Explicit removal is kept.');
}
console.log('modular weapon pair bridges OK');
