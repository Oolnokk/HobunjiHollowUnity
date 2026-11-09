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
// Smudge-family tools and separate shading, on a 2px-outlined block (W×H frame).
{
  const T = window.ModularWeaponBridgeFill, BW = 48, BH = 24;
  const at = (a, x, y) => Array.from(a.slice((y * BW + x) * 4, (y * BW + x) * 4 + 4)).join();
  const block = () => { const a = new Uint8ClampedArray(BW * BH * 4);
    for (let y = 4; y < 20; y++) for (let x = 4; x < 30; x++) a.set(x < 6 || y < 6 || x > 27 || y > 17 ? INK : SHADE, (y * BW + x) * 4); return a; };
  const tally = (a, c) => { let k = 0; for (let p = 0; p < BW * BH; p++) if (at(a, p % BW, (p / BW) | 0) === c.join()) k++; return k; };
  // Plow: metal swept by the blade piles up flat against its front and travels with it; the swept path is empty.
  const plowed = block(), plow = T.toolStepper(plowed, BW, BH, { tool: 'plow', r: 4, points: [] });
  for (let x = 20; x <= 34; x += 2) plow.step({ x, y: 12 }, { x: x + 2, y: 12 });
  plow.finish();
  assert.equal(at(plowed, 24, 12).split(',')[3], '0', 'The plowed path is empty.');
  const fronts = [9, 10, 11, 12, 13, 14, 15].map(y => { let x = 47; while (x > 30 && at(plowed, x, y) !== SHADE.join()) x--; return x; });
  assert(fronts.every(f => f === fronts[0]) && fronts[0] > 32, 'Pushed metal ends in a flat face against the blade: ' + fronts);
  // Puff: a dent in the edge is filled and the outline runs straight across it again.
  const dented = block();
  for (let y = 4; y < 9; y++) for (let x = 12; x < 16; x++) dented.set(y < 7 ? [0, 0, 0, 0] : INK, (y * BW + x) * 4);
  const puff = T.toolStepper(dented, BW, BH, { tool: 'puff', r: 7, strength: 0.8, points: [] });
  puff.step({ x: 9, y: 6 }, { x: 19, y: 6 }); puff.finish();
  for (let x = 6; x < 28; x++) assert.equal(at(dented, x, 6), SHADE.join(), 'Dent filled at x=' + x);
  for (let x = 6; x < 28; x++) assert.equal(at(dented, x, 5), INK.join(), 'Outline straight across the dent at x=' + x);
  // Puffing a straight edge again changes nothing (no ballooning).
  const flat = block(), again = T.toolStepper(flat, BW, BH, { tool: 'puff', r: 7, strength: 1, points: [] });
  for (let i = 0; i < 5; i++) again.step({ x: 9, y: 6 }, { x: 19, y: 6 });
  assert.equal(again.finish().changed, 0, 'A smooth edge does not grow.');
  // Revert: repeated passes ease a smudge back toward the reference.
  const original = block(), work = new Uint8ClampedArray(original);
  const smudge = T.toolStepper(work, BW, BH, { tool: 'smudge', r: 5, points: [] }); smudge.step({ x: 22, y: 12 }, { x: 36, y: 12 }); smudge.finish();
  const diff = a => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== original[i]) d++; return d; };
  const smudged = diff(work);
  for (let pass = 0; pass < 6; pass++) {
    const revert = T.toolStepper(work, BW, BH, { tool: 'revert', r: 10, strength: 0.6, seed: pass, points: [] }, { reference: original });
    revert.step({ x: 28, y: 12 }, { x: 34, y: 12 }); revert.finish();
  }
  assert(smudged > 100 && diff(work) < smudged / 5, 'Revert eased the smudge back: ' + smudged + ' → ' + diff(work));
  // Same seed, same steps → same result (live preview matches the saved replay).
  const r1 = block(), r2 = block(), ref = block(); r1.set(LIT, (12 * BW + 12) * 4); r2.set(LIT, (12 * BW + 12) * 4);
  for (const img of [r1, r2]) { const st = T.toolStepper(img, BW, BH, { tool: 'revert', r: 6, strength: 0.5, seed: 9, points: [] }, { reference: ref }); st.step({ x: 10, y: 12 }, { x: 14, y: 12 }); st.finish(); }
  assert.equal(Array.from(r1).join(), Array.from(r2).join(), 'Seeded revert is deterministic.');
  // Separate shading: mixed tones consolidate into pools; each tone keeps its count.
  const mixed = block(); let seed = 5; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 6; y < 18; y++) for (let x = 6; x < 28; x++) if (rnd() < (x < 17 ? 0.75 : 0.25)) mixed.set(LIT, (y * BW + x) * 4);
  const borders = a => { let e = 0; for (let y = 0; y < BH; y++) for (let x = 0; x < BW - 1; x++) { const u = at(a, x, y), v = at(a, x + 1, y); if (u !== v && [u, v].every(c => c === SHADE.join() || c === LIT.join())) e++; } return e; };
  const litBefore = tally(mixed, LIT), bordersBefore = borders(mixed);
  const sep = T.separateShading(mixed, BW, BH, { tolerance: 0.2, pool: 4 });
  assert(sep.swapped > 0 && tally(mixed, LIT) === litBefore, 'Tone counts preserved.');
  assert(borders(mixed) < bordersBefore / 3, 'Tones consolidated: ' + bordersBefore + ' → ' + borders(mixed));
}
// Clean up outline: grime and enclosed black specks become metal; a lumpy outline comes back even; a groove stays.
{
  const T = window.ModularWeaponBridgeFill, CW = 60, CH = 40;
  const at = (a, x, y) => Array.from(a.slice((y * CW + x) * 4, (y * CW + x) * 4 + 4)).join();
  const img = new Uint8ClampedArray(CW * CH * 4), put = (x, y, c) => img.set(c, (y * CW + x) * 4);
  for (let y = 8; y < 32; y++) for (let x = 8; x < 52; x++) put(x, y, x < 11 || y < 11 || x > 48 || y > 28 ? INK : (y < 16 ? LIT : SHADE));
  for (let y = 4; y < 8; y++) for (let x = 20 + (y % 2); x < 26; x++) put(x, y, INK); // A lumpy bulge on the outline.
  for (let y = 20; y < 26; y++) for (let x = 14; x < 46; x++) put(x, y, INK); // A 6px groove: real detail, bigger than a speck.
  put(30, 18, INK); put(31, 18, INK); // An enclosed 2px speck.
  const GRIME = [24, 40, 40, 255]; for (let x = 34; x < 38; x++) put(x, 27, GRIME); // Dark outline fringe smudged in.
  const res = T.cleanOutline(img, CW, CH, new Uint8Array(CW * CH).fill(1), { speck: 20, smoothing: 2 });
  assert(res.specks >= 6, 'Speck and grime pulled out: ' + res.specks);
  assert.notEqual(at(img, 30, 18), INK.join(), 'Enclosed speck became metal.');
  assert.equal(at(img, 30, 23), INK.join(), 'The groove stays.');
  assert.notEqual(at(img, 35, 27), GRIME.join(), 'Grime became clean metal.');
  const tops = [14, 20, 23, 30, 40].map(x => { let y = 0; while (y < CH && at(img, x, y).split(',')[3] === '0') y++; return y; });
  assert(tops.every(t => t === tops[0]), 'Outline top edge is even after clean-up: ' + tops);
}
// Broad averaging: Puff fills wide dents but keeps bumps and corners; Even out wobble calms a wobbly edge but keeps
// grooves; Clean up to style flattens noisy tones and merges speckle; none of them touch untouched art.
{
  const T = window.ModularWeaponBridgeFill, PW = 140, PH = 120, cls = T.makeClassifier();
  const mk = () => new Uint8ClampedArray(PW * PH * 4);
  const px = (a, x, y, c) => a.set(c, (y * PW + x) * 4);
  const kindAt = (a, x, y) => cls(a, (y * PW + x) * 4);
  // A 2-tone block with a 4px outline: metal x 24..115, y 30..89 (left half shaded, right half unshaded).
  const block = noise => { const a = mk(); let seed = 11; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let y = 26; y < 94; y++) for (let x = 20; x < 120; x++) {
      const edge = x < 24 || x > 115 || y < 30 || y > 89;
      const base = x < 70 ? SHADE : LIT, n = noise ? Math.round((rnd() - 0.5) * 6) : 0;
      px(a, x, y, edge ? INK : [base[0] + n, base[1] + n, base[2] + n, 255]);
    } return a; };
  const leftMetal = (a, y) => { for (let x = 0; x < PW; x++) if (kindAt(a, x, y) === 2) return x; return -1; };
  // Puff: a 16px-wide, 3px-deep dent in the top edge fills (the brush scales with radius × strength); a bump stays.
  // (A dent deeper than the outline is treated as interior detail, like a groove, and left alone.)
  const dented = block(false);
  for (let y = 30; y < 33; y++) for (let x = 60; x < 76; x++) px(dented, x, y, INK);
  const puff = T.toolStepper(dented, PW, PH, { tool: 'puff', r: 24, strength: 0.8, points: [] });
  puff.step({ x: 50, y: 33 }, { x: 86, y: 33 }); const puffed = puff.finish();
  assert(puffed.changed >= 40, 'A 16px-wide dent filled: ' + puffed.changed);
  for (let x = 60; x < 76; x++) assert.equal(kindAt(dented, x, 31), 2, 'Dent filled with metal at x=' + x);
  for (let x = 60; x < 76; x++) assert.equal(kindAt(dented, x, 29), 1, 'Outline runs straight across at x=' + x);
  // A groove deep inside the metal (well beyond a dent's reach from empty space) is never filled by Puff.
  const grooved = block(false);
  for (let y = 56; y < 62; y++) for (let x = 40; x < 100; x++) px(grooved, x, y, INK);
  const groovePuff = T.toolStepper(grooved, PW, PH, { tool: 'puff', r: 24, strength: 1, points: [] });
  groovePuff.step({ x: 50, y: 59 }, { x: 90, y: 59 }); groovePuff.finish();
  for (let x = 45; x < 95; x += 7) assert.equal(kindAt(grooved, x, 58), 1, 'Puff leaves the groove at x=' + x);
  // Even a groove that opens onto the outline (so it is close to the outside across the metal) stays: only black that
  // reaches open space within the outline plus dent depth is filled, and a groove's black reaches it along its length.
  const openGroove = block(false);
  for (let y = 30; y < 90; y++) for (let x = 66; x < 74; x++) px(openGroove, x, y, INK);
  const openPuff = T.toolStepper(openGroove, PW, PH, { tool: 'puff', r: 24, strength: 1, points: [] });
  openPuff.step({ x: 70, y: 60 }, { x: 70, y: 75 }); openPuff.finish();
  for (let y = 54; y < 68; y += 4) assert.equal(kindAt(openGroove, 70, y), 1, 'Puff leaves the open-ended groove at y=' + y); // The middle, beyond the mouths' reach.
  const bumpy = block(false);
  for (let y = 26; y < 30; y++) for (let x = 60; x < 70; x++) px(bumpy, x, y - 4, INK); // a bump of outline above the edge
  const bumpBefore = Array.from(bumpy), bumpPuff = T.toolStepper(bumpy, PW, PH, { tool: 'puff', r: 24, strength: 0.8, points: [] });
  bumpPuff.step({ x: 50, y: 40 }, { x: 86, y: 40 }); bumpPuff.finish();
  assert.equal(kindAt(bumpy, 24, 30), kindAt(Uint8ClampedArray.from(bumpBefore), 24, 30), 'Puff leaves a straight edge and corner as they were.');
  // Even out wobble: a sinusoidal left edge (kept inside the worked region) is calmed; a groove inside survives.
  const wavy = mk(), xl = y => Math.round(34 + 5 * Math.sin(y / 9) + 3 * Math.sin(y / 23)), xr = y => Math.round(110 + 5 * Math.sin(y / 11 + 1));
  for (let y = 20; y < 100; y++) for (let x = xl(y) - 5; x <= xr(y) + 5; x++) px(wavy, x, y, x < xl(y) || x > xr(y) ? INK : SHADE);
  for (let y = 40; y < 80; y++) for (let x = 70; x < 76; x++) px(wavy, x, y, INK); // A 6px groove (interior detail).
  const spread = a => { const v = []; for (let y = 40; y < 80; y++) v.push(leftMetal(a, y)); const m = v.reduce((u, t) => u + t, 0) / v.length; return Math.sqrt(v.reduce((u, t) => u + (t - m) ** 2, 0) / v.length); };
  const region = new Uint8Array(PW * PH); for (let y = 30; y < 90; y++) for (let x = 20; x < 125; x++) region[y * PW + x] = 1;
  const evened = Uint8ClampedArray.from(wavy), evenResult = T.evenOutline(evened, PW, PH, Uint8Array.from(region), { amount: 0.9 });
  assert(spread(evened) < spread(wavy) * 0.75, 'Edge wobble calmed: ' + spread(wavy).toFixed(2) + ' → ' + spread(evened).toFixed(2));
  assert(evenResult.wobble && evenResult.wobble.after < evenResult.wobble.before, 'The measured wobble fell: ' + JSON.stringify(evenResult.wobble));
  assert.equal(kindAt(evened, 72, 60), 1, 'The groove is still black.');
  const gentle = Uint8ClampedArray.from(wavy); T.evenOutline(gentle, PW, PH, Uint8Array.from(region), { amount: 0.2 });
  assert(spread(gentle) >= spread(evened), 'A lower smoothing setting leaves more wobble.');
  // Clean up to style: noisy tones become exactly two flat colors; speckle patches merge; a big patch and the groove stay.
  const noisy = block(true), speck = new Uint8ClampedArray(noisy);
  for (const [sx, sy] of [[40, 50], [90, 60], [45, 70]]) {
    const opposite = speck[(sy * PW + sx) * 4] < 80 ? LIT : SHADE; // Read once: the loop below changes the pixel.
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) px(speck, sx + x, sy + y, opposite); // Opposite-tone specks.
  }
  for (let y = 40; y < 52; y++) for (let x = 90; x < 104; x++) px(speck, x, y, SHADE); // A big (168 px) patch inside the lit half: kept.
  const sRegion = new Uint8Array(PW * PH); for (let y = 36; y < 84; y++) for (let x = 36; x < 105; x++) sRegion[y * PW + x] = 1;
  const flat = Uint8ClampedArray.from(speck), sr = T.styleCleanup(flat, PW, PH, sRegion, { amount: 0.6 });
  const colors = new Set(); for (let y = 40; y < 80; y++) for (let x = 40; x < 100; x++) if (kindAt(flat, x, y) === 2) colors.add(get2(flat, x, y));
  function get2(a, x, y) { return Array.from(a.slice((y * PW + x) * 4, (y * PW + x) * 4 + 4)).join(); }
  assert(colors.size <= 3, 'Metal in the worked area is flat (' + colors.size + ' colors): ' + [...colors].join(' | '));
  assert(sr.merged >= 6 && sr.snapped > 1000, 'Specks merged and noise snapped: ' + sr.merged + ' / ' + sr.snapped);
  assert.equal(get2(flat, 45, 50).split(',')[0], get2(flat, 60, 60).split(',')[0], 'The speck became the tone around it.');
  assert.equal(get2(flat, 95, 45), SHADE.join().replace(/^60,90,95/, get2(flat, 95, 45).split(',').slice(0, 3).join()), 'The big patch stays.');
  assert(sr.style.fromUntouched && sr.style.tones.length === 2, 'Style is read from the untouched art.');
  for (let y = 0; y < PH; y++) for (let x = 0; x < 20; x++) assert.equal(get2(flat, x, y), get2(speck, x, y), 'Untouched art is exactly as it was.');
}
// Recipes: steps are selected by box, re-mapped into another box (position, sizes, mirror), and survive the config.
{
  const T = window.ModularWeaponBridgeFill, box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
  const ops = [
    { junction: 'band', x: 50, y: 50, rotation: 10, scale: 1 },
    { r: 10, smudge: true, points: [[40, 40], [60, 60]] },
    { r: 6, tool: 'clean', smoothing: 2, speck: 40, points: [[55, 45]] },
    { r: 8, smudge: true, points: [[300, 300], [310, 300]] }, // Outside the box.
    { shading: true, tolerance: 0.2, pool: 5 } // Whole-weapon: belongs to no box.
  ];
  const inBox = T.opsInBox(ops, box(0, 0, 100, 100));
  assert.equal(inBox.length, 3, 'Only steps inside the box are selected.');
  const half = T.mapOps(inBox, box(0, 0, 100, 100), box(0, 0, 50, 50));
  assert.equal(half[0].x, 25); assert.equal(half[0].y, 25); assert.equal(half[0].scale, 0.5, 'Junction pieces scale with the box.');
  assert.equal(half[1].r, 5, 'Brush radii scale with the box.'); assert.equal(JSON.stringify(half[1].points), '[[20,20],[30,30]]');
  assert.equal(half[2].smoothing, 1); assert.equal(half[2].speck, 10, 'Clean-up sizes scale (speck by area).');
  assert.equal(inBox[0].x, 50, 'The saved recipe is not changed by mapping.');
  const wide = T.mapOps(inBox, box(0, 0, 100, 100), box(100, 0, 300, 100));
  assert.equal(JSON.stringify(wide[1].points), '[[180,40],[220,60]]', 'Each axis scales on its own by default.');
  assert.equal(Math.round(wide[1].r * 100) / 100, Math.round(10 * Math.sqrt(2) * 100) / 100);
  const uniform = T.mapOps(inBox, box(0, 0, 100, 100), box(100, 0, 300, 100), { uniform: true });
  assert(Math.abs(uniform[1].points[1][0] - uniform[1].points[0][0]) < 20 * 1.5 && Math.abs(uniform[1].points[1][0] - uniform[1].points[0][0]) > 20 * 1.3, 'Uniform scale keeps proportions.');
  const mirrored = T.mapOps(inBox, box(0, 0, 100, 100), box(0, 0, 100, 100), { flipX: true });
  assert.equal(JSON.stringify(mirrored[1].points), '[[60,40],[40,60]]'); assert.equal(mirrored[0].rotation, -10);
  assert.equal(JSON.stringify(T.mapBox(box(25, 25, 75, 75), box(0, 0, 100, 100), box(0, 0, 200, 50))), JSON.stringify({ x0: 50, x1: 150, y0: 12.5, y1: 37.5 }));
  // Carrying a box from one mount to another: same offset and size; a quarter turn rotates the offset and swaps w/h.
  const sameDir = T.mapMountBox(box(100, 40, 160, 80), { x: 120, y: 100, ax: 1, ay: 0, len: 40 }, { x: 320, y: 500, ax: -1, ay: 0, len: 40 });
  assert.equal(JSON.stringify(sameDir), JSON.stringify({ x0: 300, x1: 360, y0: 440, y1: 480 }), 'Mount lines have no direction: a flipped line changes nothing.');
  const scaled = T.mapMountBox(box(100, 40, 160, 80), { x: 120, y: 100, ax: 1, ay: 0, len: 40 }, { x: 320, y: 500, ax: 1, ay: 0, len: 80 });
  assert.equal(JSON.stringify(scaled), JSON.stringify({ x0: 280, x1: 400, y0: 380, y1: 460 }), 'A longer mount line scales the box and its offset.');
  const turned = T.mapMountBox(box(100, 40, 160, 80), { x: 120, y: 100, ax: 1, ay: 0, len: 40 }, { x: 0, y: 0, ax: 0, ay: 1, len: 40 });
  assert.equal(Math.round(turned.x1 - turned.x0), 40); assert.equal(Math.round(turned.y1 - turned.y0), 60, 'A quarter turn swaps width and height.');
  // Config: recipes and recipe boxes are validated, expanded in place, and never nest.
  const win = { console }, ctx2 = vm.createContext({ window: win, JSON, Object, Array, Number, Math, String, Map, WeakMap, Promise, Error });
  for (const path of ['docs/config/modular-weapons.js', 'docs/js/modular-weapon-bridge-fill.js', 'docs/js/modular-weapons.js']) vm.runInContext(fs.readFileSync(path, 'utf8'), ctx2, { filename: path });
  const api = win.ModularWeapons, cfg = JSON.parse(JSON.stringify(api.getConfig()));
  const shaftKey = Object.keys(cfg.shafts)[0], headKey = Object.keys(cfg.heads)[0];
  cfg.recipes = { 'top end': { box: box(0, 0, 100, 100), ops: [] }, collar: { box: box(0, 0, 100, 100), label: 'Collar', ops: [
    { junction: 'band', x: 50, y: 50, rotation: 0, scale: 1 }, { recipe: 'collar', box: box(0, 0, 9, 9) }, { r: 8, smudge: true, points: [[40, 40], [60, 60]] } ],
    anchor: { rank: 1, count: 2, mount: { x: 50, y: 50, ax: 1, ay: 0, len: 40 } } }, '../x': { box: box(0, 0, 9, 9), ops: [{ r: 3, points: [[1, 1]] }] } };
  cfg.shafts[shaftKey].overrides[headKey] = { bridges: { strokes: [{ recipe: 'collar', box: box(0, 0, 200, 50), uniform: true }, { recipe: 'collar', box: box(0, 0, 2, 2) }, { recipe: 'bad name!', box: box(0, 0, 50, 50) }] } };
  const next = api.replace(cfg);
  assert.equal(Object.keys(next.recipes).join(), 'collar', 'Invalid recipe names and empty recipes are dropped.');
  assert.equal(next.recipes.collar.ops.length, 2, 'A recipe cannot contain recipe steps.');
  assert.equal(next.recipes.collar.anchor.rank, 1); assert.equal(next.recipes.collar.anchor.mount.len, 40, 'The mount anchor is kept.');
  const placed = next.shafts[shaftKey].overrides[headKey].bridges.strokes;
  assert.equal(placed.length, 1, 'Tiny or badly named recipe boxes are dropped.'); assert.equal(placed[0].uniform, true);
  const expanded = api.expandOps(placed);
  assert.equal(expanded.length, 2, 'The recipe box expands into its steps.');
  assert(Math.abs(expanded[0].x - 100) < 1e-9 && expanded[0].junction === 'band', 'The collar lands in the middle of the box.');
  const kept = api.replace(JSON.parse(JSON.stringify(next))); assert.equal(Object.keys(kept.recipes).join(), 'collar', 'Recipes survive a round trip.');
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
  // Junction pieces are kept with validated placement; unsafe names are dropped; order with strokes is preserved.
  cfg.shafts[shaftKey].overrides[headKey] = { bridges: { strokes: [
    { r: 8, points: [[1, 2], [3, 4]] },
    { junction: 'sphere', x: 120, y: 340, rotation: 400, scale: 99, behind: true },
    { junction: '../evil', x: 0, y: 0 } ] } };
  const ops = api.replace(cfg).shafts[shaftKey].overrides[headKey].bridges.strokes;
  assert.equal(ops.length, 2, 'Unsafe junction name dropped.');
  assert.equal(JSON.stringify(ops[1]), '{"junction":"sphere","x":120,"y":340,"rotation":360,"scale":8,"behind":true}');
  assert.equal(api.junctionPath('band'), 'assets/toolsprites/modular_pieces/weaponjunction_band.png');
  for (const name of api.JUNCTIONS) assert(fs.existsSync('docs/' + api.junctionPath(name)), 'Bundled junction piece exists: ' + name);
  const scriptAt = name => editorHtml.indexOf('src="' + name);
  assert(scriptAt('junction-picker.js') > 0 && scriptAt('junction-picker.js') < scriptAt('editor.js') &&
    scriptAt('junction-picker.js') < scriptAt('sprite-cutter.js'), 'Junction picker loads before its users.');
  cfg.shafts[shaftKey].overrides[headKey] = { bridges: { strokes: [
    { tool: 'plow', r: 9, points: [[1, 2], [5, 2]], seed: 4 }, { tool: 'revert', r: 6, strength: 3, points: [[1, 1]] },
    { shading: true, tolerance: 0.9, pool: 7 }, { tool: 'erase-everything', r: 3, points: [[0, 0]] }, { revertPoint: true },
    { clean: true, smoothing: 99, speck: 50 }, { tool: 'clean', r: 10, points: [[3, 3]], smoothing: 3, speck: 20 },
    { even: true, amount: 7 }, { style: true, amount: 0.4, pool: -5 } ] } };
  const toolOps = api.replace(cfg).shafts[shaftKey].overrides[headKey].bridges.strokes;
  assert.equal(toolOps[0].tool, 'plow'); assert.equal(toolOps[1].strength, 1, 'Strength clamped.');
  assert.equal(JSON.stringify(toolOps[2]), '{"shading":true,"tolerance":0.5,"pool":7}');
  assert.equal(toolOps.length, 8, 'Unknown tools are dropped, never replayed as something else.');
  assert.equal(JSON.stringify(toolOps[4]), '{"clean":true,"smoothing":12,"speck":50}', 'Whole-weapon clean-up kept, clamped.');
  assert(toolOps[5].tool === 'clean' && toolOps[5].smoothing === 3 && toolOps[5].speck === 20, 'Clean brush strokes kept.');
  assert.equal(JSON.stringify(toolOps[6]), '{"even":true,"amount":1}', 'Even-out op kept, amount clamped.');
  assert.equal(JSON.stringify(toolOps[7]), '{"style":true,"amount":0.4,"pool":0}', 'Style op kept, pool clamped.');
  assert.equal(JSON.stringify(toolOps[3]), '{"revertPoint":true}', 'Revert points are kept in order.');
  cfg.shafts[shaftKey].overrides[headKey] = { bridges: null };
  assert.equal(api.replace(cfg).shafts[shaftKey].overrides[headKey].bridges, null, 'Explicit removal is kept.');
}
console.log('modular weapon pair bridges OK');
