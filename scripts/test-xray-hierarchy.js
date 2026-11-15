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
assert.strictEqual(X.get('layers.manualOrder'), 'off');
assert.strictEqual(X.get('background.gearDepth'), 'ignore');
assert.strictEqual(X.get('airborne.rebuildDepth'), 'on');
assert.strictEqual(X.get('weapon.followHandLayer'), 'on', 'weapons inherit their gripping hand priority by default');
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

// Manual rank editing, strict validation, clipboard persistence and reset.
const shippedOrder = X.DEFAULT_DRAW_ORDER.slice();
assert.strictEqual(X.describeLayers().length, 18, 'all visual categories (including material types, hands, feet and weapons) are exposed');
assert.strictEqual(X.setDrawOrder(['actor.hands']), false, 'cannot remove layers');
assert.strictEqual(X.setDrawOrder([...shippedOrder.slice(1), shippedOrder[1]]), false, 'cannot duplicate layers');
assert.strictEqual(X.moveLayer('actor.hands', '__end'), true, 'can move between category groups');
assert.strictEqual(X.layerRank('actor.hands'), shippedOrder.length - 1);
assert.ok(Array.isArray(JSON.parse(store['hobunji.xrayHierarchy.v1']).__drawOrder), 'manual order survives reload storage');
const orderExport = X.exportDiff();
X.reset();
assert.deepStrictEqual(X.describeLayers().map(layer => layer.id), shippedOrder, 'reset restores all layer ranks');
assert.strictEqual(X.importDiff(orderExport).ok, true, 'layer ranks round-trip through exported config');
assert.strictEqual(X.layerRank('actor.hands'), shippedOrder.length - 1);
X.reset();

// Dev Companion panel: hierarchy rows, dropdowns, nested action paths and export text.
assert.strictEqual(panels.length, 1);
const panel = panels[0];
assert.strictEqual(panel.when(), true);
const view = panel.render();
const dropdowns = view.actions.filter(a => a.options);
assert.ok(dropdowns.length >= X.keys().length, 'all rules and the layer pickers have dropdowns');
assert.ok(view.actions.some(action => action.id === 'move-before' && action.path.length === 2), 'manual reorder picker is inside a nested branch');
assert.ok(view.rows.some(r => /Hands behind front plane/.test(r[0]) && r[1] === '1'), 'live renderer counters are shown');
assert.deepStrictEqual(panel.onAction('set', { key: 'pants.sortWithActor', value: 'off' }), { ok: true });
assert.strictEqual(X.get('pants.sortWithActor'), 'off');
assert.match(panel.render().summary, /1 change/);
const exportResult = panel.onAction('export', {});
assert.ok(exportResult.text.includes('pants.sortWithActor') && exportResult.title);
panel.onAction('reset', {});
assert.strictEqual(X.get('pants.sortWithActor'), 'on');
assert.deepStrictEqual(panel.onAction('shift', { delta: 1 }), { ok: true }, 'nudge changes the live hierarchy');
assert.strictEqual(X.get('layers.manualOrder'), 'on', 'moving a layer automatically enables the color sorter');
panel.onAction('reset', {});

// The renderer's own fallback table (used only if this module is absent) must not drift from the shipped defaults.
const fallbackSource = /const XRAY_RULE_FALLBACK = (\{[^}]*\});/.exec(render);
assert.ok(fallbackSource, 'renderer declares XRAY_RULE_FALLBACK');
const fallback = new Function('return ' + fallbackSource[1])();
for (const key of X.keys()) assert.strictEqual(fallback[key], X.RULES[key].default, `fallback default for ${key} matches the config`);
assert.strictEqual(Object.keys(fallback).length, X.keys().length, 'fallback lists exactly the configured rules');

// Renderer wiring: every rule is read where its behaviour lives.
for (const key of X.keys()) assert.ok(render.includes(`'${key}'`), `renderer reads rule ${key}`);
assert.ok(/updateFrontPlaneHands\(held, scene, camera\)/.test(render), 'hand rule runs each base world frame');
assert.ok(/handsBehindFrontPlane: lastHandsBehindFrontPlane/.test(render), 'snapshot exposes the hand counter');
assert.ok(/withPortraitDrawOrder\(renderer, overlayDrawOrder, \(\) => rawRender\.call\(renderer, scene, camera\)\)/.test(render),
  'actual gear/hand/foot overlay color draws inherit actor depth and manual layer sorting');
assert.ok(/const supplementDepth = !group\.regions\.length && canLockColorMask && !rebuildAirborne/.test(render),
  'airborne ordinary gear cannot reuse a sky-masked base depth buffer');
assert.ok(/backgroundHidden = backgroundMeshes\.length && !supplementDepth \? hideObjects\(backgroundMeshes\)/.test(render),
  'only the selective depth rebuild excludes backdrops, not the original scene or final depth restore');
assert.ok(/isPresentationBackdrop\(object\).*backgroundDepthRegistry\.add\(object\)/.test(render),
  'sky and horizon meshes are registered without a new scene traversal per gear draw');
assert.ok(/backgroundDepthMeshesExcluded/.test(render) && /airborneDepthRebuilds/.test(render),
  'mobile Dev Companion diagnostics expose both airborne fixes');

// Execute the renderer classification and live render-list sorting (without a GL context).
const backdropStart = render.indexOf('  function isPresentationBackdrop(');
const backdropEnd = render.indexOf('\n  // Central x-ray rules', backdropStart);
const isBackdrop = new Function(render.slice(backdropStart, backdropEnd) + '; return isPresentationBackdrop;')();
assert.strictEqual(isBackdrop({ isMesh: true, name: 'hobunji_cloud_depth_mask_0', material: { userData: { skyLayerDepthNdc: 0.999 } } }), true,
  'far-plane cloud mask is recognized as a visual backdrop');
assert.strictEqual(isBackdrop({ isMesh: true, userData: { backgroundScenery: true } }), true,
  'authored background scenery is not a physical foreground occluder');
assert.strictEqual(isBackdrop({ isMesh: true, userData: {}, material: { userData: {} } }), false,
  'ordinary solid walls stay real occluders');
const layerStart = render.indexOf('  function visualLayerFor(');
const layerEnd = render.indexOf('\n  function nearbyPortraitOrder(', layerStart);
const visualSort = new Function('window', 'xrayRule', 'isPresentationBackdrop', 'surfaceKindForObject', 'comparePortraitDraws', 'heldPriorityLayer',
  render.slice(layerStart, layerEnd) + '; return { visualLayerFor, withVisualSort };')(
  win, key => X.get(key), isBackdrop, () => 'solid', (a, b, ranks, extras) =>
    (ranks.get(b.object)?.depth ?? extras?.get(b.object)?.depth ?? b.z)
      - (ranks.get(a.object)?.depth ?? extras?.get(a.object)?.depth ?? a.z),
  () => X.get('weapon.followHandLayer') === 'off' ? 'item.weapons' : 'actor.hands');
const drawn = (data, name) => ({ object: { userData: data, name: name || '' }, material: { id: 3 }, groupOrder: 0, renderOrder: 0, z: 0, id: 1 });
const handItem = drawn({ hobunjiProceduralHand: true });
const weaponItem = drawn({ hobunjiHeldObjectPlane: true });
const footItem = drawn({ hobunjiProceduralFoot: true });
assert.strictEqual(visualSort.visualLayerFor(handItem), 'actor.hands');
assert.strictEqual(visualSort.visualLayerFor(weaponItem), 'actor.hands', 'held weapon takes its gripping hand layer by default');
X.set('weapon.followHandLayer', 'off');
assert.strictEqual(visualSort.visualLayerFor(weaponItem), 'item.weapons', 'explicit unlink permits independent weapon rank');
assert.strictEqual(visualSort.visualLayerFor(footItem), 'actor.feet');
const rendererMock = { setTransparentSort(fn) { this.transparent = fn; }, setOpaqueSort(fn) { this.opaque = fn; } };
X.set('layers.manualOrder', 'on');
X.moveLayer('actor.hands', '__end');
visualSort.withVisualSort(rendererMock, null, () => {
  assert.ok(rendererMock.transparent(weaponItem, handItem) < 0, 'gear drawn before moved hand layer');
  assert.ok(rendererMock.opaque(weaponItem, handItem) < 0, 'manual sort also handles opaque parts');
});
assert.strictEqual(rendererMock.transparent, null, 'transparent renderer state restored after a sort');
assert.strictEqual(rendererMock.opaque, null, 'opaque renderer state restored after a sort');
const farOwner = { id: 100 }, nearOwner = { id: 101 };
const actorOrder = { ranks: new Map([
  [weaponItem.object, { owner: farOwner, depth: 0.8 }],
  [handItem.object, { owner: nearOwner, depth: 0.2 }],
]), extras: new Map() };
X.moveLayer('item.weapons', '__end'); // Edit would otherwise draw the farther weapon last.
visualSort.withVisualSort(rendererMock, actorOrder, () => {
  assert.ok(rendererMock.transparent(weaponItem, handItem) < 0,
    'near NPC portrait still covers far NPC weapon despite the weapon manual priority');
});
assert.strictEqual(rendererMock.transparent, null, 'actor-aware visual sort transaction restores renderer state');
const overlayRankStart = render.indexOf('  function rankedHeldOverlayOrder(');
const overlayRankEnd = render.indexOf('\n  function assignPortraitStencilOwners(', overlayRankStart);
assert.ok(overlayRankStart >= 0 && overlayRankEnd > overlayRankStart, 'held overlay owner-rank adapter is present');
const rankedHeld = new Function('xrayRule', 'portraitStencilOwner',
  render.slice(overlayRankStart, overlayRankEnd) + '; return rankedHeldOverlayOrder;')(
  key => X.get(key), mesh => mesh.owner);
const farEquipment = { owner: farOwner }, nearEquipment = { owner: nearOwner };
const baseActorSort = { ranks: actorOrder.ranks, extras: new Map() };
const heldSort = rankedHeld(baseActorSort, [farEquipment, nearEquipment], {});
assert.strictEqual(heldSort.extras.get(farEquipment).owner, farOwner,
  'the far actor weapon inherits its own portrait depth rank');
assert.strictEqual(heldSort.extras.get(nearEquipment).owner, nearOwner,
  'the near actor hands inherit the near portrait depth rank');
assert.strictEqual(rankedHeld(null, [farEquipment], {}), null, 'single actor worlds keep the original simple sort');
visualSort.withVisualSort(rendererMock, heldSort, () => {
  const farDraw = { ...weaponItem, object: farEquipment }, nearDraw = { ...handItem, object: nearEquipment };
  assert.ok(rendererMock.transparent(farDraw, nearDraw) < 0,
    'in the isolated held overlay the nearer actor still covers the farther actor');
});
X.reset();

// The stencil owner rule must use manually chosen front-plane priorities, not
// rely on WebGL draw-pass order (hands and their tools are in the held pass).
const maskBegin = render.indexOf('  function manualBehindFront(');
const maskEnd = render.indexOf('\n  // Hands:', maskBegin);
const maskScope = new Function('window', 'xrayRule', 'maskedHands',
  render.slice(maskBegin, maskEnd) + '; return { manualBehindFront, heldPriorityLayer, isPortraitMaskedGear };')(
    win, key => X.get(key), new Set([handItem.object]));
X.set('layers.manualOrder', 'on');
assert.strictEqual(maskScope.isPortraitMaskedGear({ userData: { hobunjiHeldObjectPlane: true } }), true,
  'weapon remains behind front portrait while the hand is behind');
X.moveLayer('actor.hands', '__end');
assert.strictEqual(maskScope.isPortraitMaskedGear({ userData: { hobunjiHeldObjectPlane: true } }), false,
  'moving the hand in front also brings its held weapon forward through the portrait mask');
X.set('weapon.followHandLayer', 'off');
assert.strictEqual(maskScope.isPortraitMaskedGear({ userData: { hobunjiHeldObjectPlane: true } }), true,
  'unlinked weapon retains its independent front-art mask');
X.reset();

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
