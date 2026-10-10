#!/usr/bin/env node
'use strict';

// Pants Rig Author belt tools: whole-spline transforms and the upward shrinkwrap, plus the
// enlarge-as-floating-window wiring. The module runs in a stub DOM so the maths is exercised
// without a browser.

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/tools/pants-rig-author/belt-transform-tools.js', 'utf8');
const appLoader = fs.readFileSync('docs/tools/pants-rig-author/app.js', 'utf8');
const appBase = fs.readFileSync('docs/tools/pants-rig-author/app-base.js', 'utf8');
const enlarge = fs.readFileSync('docs/tools/pants-rig-author/workspace-enlarge.js', 'utf8');
const host = fs.readFileSync('docs/js/procedural-pants-rig-author.js', 'utf8');

// ---- wiring --------------------------------------------------------------
assert(appLoader.includes("loadScript('belt-transform-tools.js'"), 'author does not load the belt tools');
assert(appBase.includes('character: ensureCharacter') && appBase.includes('snapshotForUndo,') && appBase.includes('persist: persistDraft'), 'author debug api must expose character/persist/snapshotForUndo for the belt tools');
assert(enlarge.includes("type: 'hobunji-pants-rig-enlarge', enlarged, title"), 'enlarge message must carry the workspace title to the host');
assert(enlarge.includes('.canvasCard:not(.pantsEnlarged){visibility:hidden'), 'only the enlarged workspace may stay visible');
assert(host.includes("EXPANDED_Z_INDEX = '200'") && host.includes('root.style.zIndex = EXPANDED_Z_INDEX'), 'enlarged Pants window must lift the modal layer above the HUD, NPC drawer and docks');
assert(host.includes('delete root.dataset.pantsPreviousZ'), 'modal layer z-index must be restored when the window closes');
assert(source.includes('.canvasCard.pantsEnlarged .pantsBeltTools{display:flex}'), 'belt toolbar should only show in the enlarged window');

// ---- behaviour in a stub DOM ---------------------------------------------
const W = 20, H = 20;
const alpha = new Uint8ClampedArray(W * H * 4);
const paint = (x0, x1, y0, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) alpha[(y * W + x) * 4 + 3] = 255; };
paint(5, 14, 0, 11); // Torso: opaque rows 0..11, columns 5..14.
paint(8, 9, 14, 15); // A stray opaque blob lower down in columns 8-9, to prove the nearest hit from below wins.

const spline = [0.30, 0.40, 0.50, 0.60, 0.80].map(x => ({ x, y: 0.95 })); // Row 18 everywhere; last node is outside the torso.
const calls = { snapshots: [], persists: 0, rerenders: 0, notifies: [] };
const debug = {
  character: () => ({ portraitBeltSpline: spline }),
  state: () => ({ portraitImageRect: { x: 0, y: 0, width: 200, height: 200 } }),
  persist: () => { calls.persists++; },
  rerender: () => { calls.rerenders++; },
  snapshotForUndo: label => { calls.snapshots.push(label); },
  notifyHostChanged: reason => { calls.notifies.push(reason); },
};
const element = () => ({ style: {}, appendChild() {}, setAttribute() {}, querySelector: () => null, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} } });
const sandbox = {
  console, performance,
  setTimeout, clearTimeout, setInterval, clearInterval,
  window: { __pantsRigAuthorDebug: debug },
  document: {
    readyState: 'complete',
    head: element(),
    createElement: element,
    getElementById: id => (id === 'portraitSource'
      ? { width: W, height: H, getContext: () => ({ getImageData: () => ({ data: alpha }) }) }
      : null),
    querySelector: () => null,
    addEventListener() {},
  },
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const tools = sandbox.window.PantsRigBeltTools;
assert(tools, 'PantsRigBeltTools was not published');

const ys = () => spline.map(p => p.y);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// Shrinkwrap: nodes 0..3 are in columns 6, 8, 10, 12 -> torso bottom edge (row 11). Node 4 (column 16) has
// no opaque pixel above it and follows its nearest neighbour. Column 8 has the stray blob at rows 14-15, which is
// closer than the torso, so that node lands on the blob (first opaque pixel going up from row 18).
tools.shrinkwrapUp();
const expectedRow = [11, 15, 11, 11, 11];
spline.forEach((p, index) => assert(near(p.y, (expectedRow[index] + 0.5) / H), `node ${index} landed on row ${p.y * H - 0.5}, expected ${expectedRow[index]}`));
assert.deepStrictEqual(calls.snapshots, ['shrinkwrap belt'], 'shrinkwrap must create exactly one undo step');
assert(calls.persists >= 1 && calls.rerenders >= 1 && calls.notifies.includes('belt-transform'), 'shrinkwrap must persist, redraw and notify the host');

// A node already inside the body slides to the lower edge of its opaque run (row 11), not further.
spline.forEach(p => { p.x = 0.50; p.y = 0.15; });
tools.shrinkwrapUp();
assert(spline.every(p => near(p.y, 11.5 / H)), 'nodes inside the torso must settle on its lower edge');

// No opaque pixel anywhere in the columns: the belt is left alone.
spline.forEach((p, index) => { p.x = 0.85 + index * 0.01; p.y = 0.9; });
const before = JSON.stringify(spline);
tools.shrinkwrapUp();
assert.strictEqual(JSON.stringify(spline), before, 'belt must not move when no opaque pixel exists above it');

// Transforms keep the shape rigid and inside [0,1].
const reset = () => spline.forEach((p, index) => { p.x = 0.3 + index * 0.1; p.y = 0.5 + (index === 2 ? -0.02 : 0); });
reset();
tools.setStep(2); // Coarse: move 0.04, scale 0.08, rotate 6 degrees.
const span = () => spline[4].x - spline[0].x;
tools.run('right');
assert(near(spline[0].x, 0.34) && near(spline[4].x, 0.74), 'move right is not a rigid translate');
reset(); tools.run('wider');
assert(near(span(), 0.4 * 1.08), 'width scale should stretch x about the centroid only');
assert(near(spline[2].y, 0.48), 'width scale must not change y');
reset(); tools.run('grow');
assert(near(span(), 0.4 * 1.08), 'uniform scale grows x');
reset(); tools.run('rotateRight');
assert(spline[4].y > spline[0].y, 'clockwise rotation lowers the right end on screen');
const lengthBefore = Math.hypot(0.4 * 200, 0);
const lengthAfter = Math.hypot((spline[4].x - spline[0].x) * 200, (spline[4].y - spline[0].y) * 200);
assert(near(lengthAfter, lengthBefore, 1e-6), 'rotation must preserve the belt length');
spline.forEach(p => { p.x = 0.97; p.y = 0.5; });
tools.run('right');
assert(spline.every(p => p.x <= 1 && p.x >= 0), 'translation must stay clamped inside the image');
spline.forEach((p, index) => { p.x = 0.9 + index * 0.025; p.y = 0.5; });
const rigidBefore = spline[4].x - spline[0].x;
tools.run('right'); tools.run('right'); tools.run('right');
assert(near(spline[4].x - spline[0].x, rigidBefore), 'translating against an edge must not squash the shape');

console.log('Pants belt transform tools: PASS');
