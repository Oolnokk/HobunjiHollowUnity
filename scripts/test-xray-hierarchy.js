'use strict';
// Central x-ray hierarchy: the config module (defaults, live set/get, diff, export/import, dev-companion panel)
// and the renderer wiring that consumes it, including the executed "hand behind its front plane" test.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'docs');
const cfgSource = fs.readFileSync(path.join(root, 'js', 'xray-hierarchy.js'), 'utf8');
const render = fs.readFileSync(path.join(root, 'js', 'held-object-render-order.js'), 'utf8');

const store = {};
const panels = [];
const win = {
  DevCompanion: { registerPanel: spec => { panels.push(spec); return true; } },
  HeldObjectRenderOrder: { snapshot: () => ({ rankedPortraitActors: 2, frontPortraitMasks: 1, handsBehindFrontPlane: 1 }) },
  __hobunjiGameStarted: true,
};
global.window = win;
global.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
new Function(cfgSource)();
const X = win.XrayHierarchy;
assert.ok(X && X.version === 1, 'module registers window.XrayHierarchy');

// Defaults, validation, live change, listeners.
assert.strictEqual(X.get('hand.frontPlaneMask'), 'behind');
assert.strictEqual(X.get('actors.order'), 'all');
let heard = null;
X.onChange((k, v, prev) => { heard = [k, v, prev]; });
assert.strictEqual(X.set('hand.frontPlaneMask', 'bogus'), false, 'rejects values outside the rule options');
assert.strictEqual(X.set('no.such.rule', 'on'), false, 'rejects unknown rules');
assert.strictEqual(X.set('hand.frontPlaneMask', 'off'), true);
assert.deepStrictEqual(heard, ['hand.frontPlaneMask', 'off', 'behind'], 'listeners hear live changes');
assert.strictEqual(X.get('hand.frontPlaneMask'), 'off');

// Diff / export / import round trip, persistence of changes only.
assert.deepStrictEqual(X.diff(), { 'hand.frontPlaneMask': { from: 'behind', to: 'off' } });
const exported = JSON.parse(X.exportDiff());
assert.deepStrictEqual(exported.xrayHierarchy.changes, X.diff());
assert.strictEqual(exported.xrayHierarchy.effective['actors.order'], 'all', 'export lists the full effective hierarchy');
assert.deepStrictEqual(JSON.parse(store['hobunji.xrayHierarchy.v1']), { 'hand.frontPlaneMask': 'off' }, 'only changed rules persist');
X.reset();
assert.deepStrictEqual(X.diff(), {}, 'reset returns every rule to default');
assert.strictEqual(store['hobunji.xrayHierarchy.v1'], undefined);
assert.strictEqual(X.importDiff(JSON.stringify(exported)).applied > 0, true, 'an exported diff can be re-imported');
assert.strictEqual(X.get('hand.frontPlaneMask'), 'off');
X.reset();

// Dev Companion panel: hierarchy rows, one dropdown per rule, export returns text for the clipboard.
assert.strictEqual(panels.length, 1);
const panel = panels[0];
assert.strictEqual(panel.when(), true);
const view = panel.render();
const dropdowns = view.actions.filter(a => a.options);
assert.strictEqual(dropdowns.length, X.keys().length, 'every rule has a dropdown');
assert.ok(view.rows.some(r => /Hands behind front plane/.test(r[0]) && r[1] === '1'), 'live renderer counters are shown');
assert.deepStrictEqual(panel.onAction('set', { key: 'pants.sortWithActor', value: 'off' }), { ok: true });
assert.strictEqual(X.get('pants.sortWithActor'), 'off');
assert.match(panel.render().summary, /1 change/);
const exportResult = panel.onAction('export', {});
assert.ok(exportResult.text.includes('pants.sortWithActor') && exportResult.title);
panel.onAction('reset', {});
assert.strictEqual(X.get('pants.sortWithActor'), 'on');

// Renderer wiring: every rule is read where its behaviour lives.
for (const key of X.keys()) assert.ok(render.includes(`'${key}'`), `renderer reads rule ${key}`);
assert.ok(/updateFrontPlaneHands\(held, scene, camera\)/.test(render), 'hand rule runs each base world frame');
assert.ok(/handsBehindFrontPlane: lastHandsBehindFrontPlane/.test(render), 'snapshot exposes the hand counter');

// Execute the production "hand behind its front plane" math with a tiny matrix stand-in.
const start = render.indexOf('const HAND_BEHIND_PLANE_EPS');
const fnStart = render.indexOf('function handBehindFrontPlane(');
const fnEnd = render.indexOf('\n  }\n', fnStart) + 4;
class V3 {
  constructor() { this.x = 0; this.y = 0; this.z = 0; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  setFromMatrixPosition(m) { return this.set(m.elements[12], m.elements[13], m.elements[14]); }
  applyMatrix4(m) { return this.set(this.x - m.t[0], this.y - m.t[1], this.z - m.t[2]); } // Plane at m.t, no rotation.
}
class M4 { constructor() { this.t = [0, 0, 0]; } copy(m) { this.t = m.pos.slice(); return this; } invert() { return this; }
  multiplyMatrices(inverse, world) { this.t = [inverse.t[0] - world.pos[0], inverse.t[1] - world.pos[1], inverse.t[2] - world.pos[2]]; return this; } } // V3.applyMatrix4 subtracts t, so store the negated hand offset.
const handToPlaneStub = new M4();
const handBehind = new Function('THREE', 'handPlaneInverse', 'handPlaneLocal', 'handPlaneCamera', 'handToPlane', 'handCorner', 'handProbe',
  render.slice(start, render.indexOf('\n', start)) + '\n' + render.slice(render.indexOf('const HAND_PART_BEHIND_EPS'), render.indexOf('\n', render.indexOf('const HAND_PART_BEHIND_EPS'))) + '\n' + render.slice(fnStart, fnEnd) + '\nreturn handBehindFrontPlane;')(
  {}, new M4(), new V3(), new V3(), handToPlaneStub, new V3(), { cameraZ: NaN, handMinZ: NaN, handMaxZ: NaN, hands: 0 });
const plane = { matrixWorld: { pos: [0, 0, 0], elements: [] } };
const mat = (x, y, z) => { const e = new Array(16).fill(0); e[12] = x; e[13] = y; e[14] = z; return { elements: e, pos: [x, y, z] }; };
plane.matrixWorld = mat(0, 0, 0);
const cameraFront = { matrixWorld: mat(0, 0, 5) };
assert.strictEqual(handBehind({ matrixWorld: mat(0, 0, -0.05) }, plane, cameraFront), true, 'hand behind the plane, camera in front: hidden');
assert.strictEqual(handBehind({ matrixWorld: mat(0, 0, 0.08) }, plane, cameraFront), false, 'hand in front of the plane stays visible');
assert.strictEqual(handBehind({ matrixWorld: mat(0, 0, -0.05) }, plane, { matrixWorld: mat(0, 0, -5) }), false, 'camera behind the card: front art is not on screen, nothing to hide under');
// A gripping hand straddles the card: its centre is in front but a part (and its outline) reaches behind.
const box = (zmin, zmax) => ({ boundingBox: { min: { x: -0.05, y: -0.05, z: zmin }, max: { x: 0.05, y: 0.05, z: zmax } } });
assert.strictEqual(handBehind({ matrixWorld: mat(0, 0, 0.04), geometry: box(-0.12, 0.12) }, plane, cameraFront), true, 'straddling hand with a part behind the plane is masked');
assert.strictEqual(handBehind({ matrixWorld: mat(0, 0, 0.2), geometry: box(-0.05, 0.05) }, plane, cameraFront), false, 'hand wholly in front stays visible');
assert.strictEqual(handBehind({ matrixWorld: mat(0, 0, 0.04), geometry: box(-0.01, 0.12) }, plane, cameraFront), false, 'a sliver within tolerance does not hide the hand');
console.log('xray hierarchy: ok');
