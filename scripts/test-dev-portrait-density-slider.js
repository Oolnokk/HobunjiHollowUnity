#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const portraitSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
const uiSource = fs.readFileSync('docs/js/performance-debug.js', 'utf8');
const devSource = fs.readFileSync('docs/js/input-default-reset-ui.js', 'utf8');
const begin = portraitSource.indexOf('  // Mesh budgets:');
const end = portraitSource.indexOf('  function buildSkinnedPlaneGeometry(', begin);
assert(begin >= 0 && end > begin, 'production portrait budget and density authority can be extracted');

const builds = []; // The fake builder below records the exact requested grid without bringing in renderer dependencies.
function geometry(segmentsX, segmentsY, frontOnly = false) {
  const count = segmentsX * segmentsY * 6 * (frontOnly ? 1 : 2);
  return {
    userData: { segmentsX, segmentsY },
    groups: [{ start: 0, count: segmentsX * segmentsY * 6, materialIndex: 0 }],
    getAttribute(name) { return name === 'position' ? { count } : null; },
    setDrawRange(start, count) { this.drawRange = { start, count }; },
    dispose() { this.disposed = true; },
  };
}
function buildSkinnedPlaneGeometry(THREE, width, height, neckLocal, options) {
  builds.push({ THREE, width, height, neckLocal, options });
  return geometry(options.segmentsX, options.segmentsY, options.frontOnly);
}
class TestWeakRef { constructor(value) { this.value = value; } deref() { return this.value; } }
const events = [];
const windowStub = {
  localStorage: { getItem: () => null, setItem: () => {} },
  dispatchEvent(event) { events.push(event.type); },
};
const { meshBudget, registerSkinnedPortrait } = vm.runInNewContext(
  '(() => { ' + portraitSource.slice(begin, end) + ' return { meshBudget, registerSkinnedPortrait }; })()',
  { window: windowStub, WeakRef: TestWeakRef, Event: class { constructor(type) { this.type = type; } }, buildSkinnedPlaneGeometry },
  { filename: 'png-plane-avatar.js:mesh-budget' },
);

assert.equal(meshBudget.defaultPortraitDensityPercent, 40, 'the production baseline is shared with Dev Mode teardown');
assert.equal(meshBudget.portraitDensityPercent(), 40, 'new game sessions start with the measured 40% subdivision density');
assert.deepEqual([meshBudget.portraitGrid('full').segmentsX, meshBudget.portraitGrid('full').segmentsY], [11, 14], 'player subdivisions use 40% on both axes');
assert.deepEqual([meshBudget.portraitGrid('npc').segmentsX, meshBudget.portraitGrid('npc').segmentsY], [8, 10], 'NPC subdivisions use 40% on both axes');
assert.deepEqual([meshBudget.portraitGrid('npc', true).segmentsX, meshBudget.portraitGrid('npc', true).segmentsY], [14, 18], 'enemy mask topology uses the same default');
assert.deepEqual([meshBudget.animalGrid(48, 128/75).segmentsX, meshBudget.animalGrid(48, 128/75).segmentsY], [12, 7], 'painted animal head meshes use the same 40% per-axis default');
assert.deepEqual([meshBudget.animalGrid(48, 75/128).segmentsX, meshBudget.animalGrid(48, 75/128).segmentsY], [7, 12], 'tall animal UV maps keep their authored aspect');
assert.deepEqual([meshBudget.animalGrid(12, 12).segmentsX, meshBudget.animalGrid(12, 12).segmentsY], [5, 4], 'minimum preserves a usable skin grid even for narrow painted rigs');
assert.deepEqual([meshBudget.animalGrid(48, NaN).segmentsX, meshBudget.animalGrid(48, NaN).segmentsY], [12, 12], 'invalid authored aspect cannot poison GPU geometry');
assert.equal(meshBudget.resolve('npc').pantsSegments, 32, 'portrait density leaves pants budget intact');
assert.equal(meshBudget.resolve('npc').animalSegments, 30, 'portrait density leaves animal budget intact');

const skeleton = { id: 'live-rig' }; // Shared with mesh to prove no replacement/rebind happens.
const pose = { x: 4, y: 7, z: 0 }; // Existing in-game transform must survive retessellation unchanged.
class FakeWireframeMaterial {
  constructor(options) { Object.assign(this, options); this.disposed = false; }
  dispose() { this.disposed = true; }
}
const THREE = { id: 'renderer', DoubleSide: 2, MeshBasicMaterial: FakeWireframeMaterial }; // Simulates Three r128's skinnable diagnostic materials without a WebGL context.
const neckLocal = { x: 0, y: 1, z: 0 };
const headBoundsPx = { left: 2, right: 8, top: 3, bottom: 9 };
const originalFront = { map: 'player-front-png' }; // A real original material must survive debug wireframe toggles exactly.
const originalBack = { map: 'player-back-png' };
const playerMaterials = [originalFront, originalBack]; // Two faces of the skinned portrait need two material groups.
const enemyMaterial = { map: 'enemy-front-png' }; // Hostiles use one front-only material.
const player = { isSkinnedMesh: true, geometry: geometry(11, 14), skeleton, position: pose, material: playerMaterials }; // Simulates the actual 40%-density player spawn.
const enemy = { isSkinnedMesh: true, geometry: geometry(14, 18, true), skeleton: { id: 'enemy' }, material: enemyMaterial }; // Simulates a front-only hostile mask at the same baseline.
const previousPlayerGeometry = player.geometry;
const previousEnemyGeometry = enemy.geometry;
registerSkinnedPortrait(player, THREE, 2, 3, neckLocal, { pixelWidth: 120, pixelHeight: 160, headBoundsPx }, 'full');
registerSkinnedPortrait(enemy, THREE, 1, 1, neckLocal, { pixelWidth: 80, pixelHeight: 80, frontOnly: true, headBoundsPx }, 'npc', true);
assert.equal(meshBudget.portraitDensityDebug().tracked, 2);

assert.equal(meshBudget.setPortraitDensityPercent(50), true, 'slider applies a new percentage');
assert.deepEqual([meshBudget.animalGrid(48, 128/75).segmentsX, meshBudget.animalGrid(48, 128/75).segmentsY], [15, 9], 'animal head grid tracks developer slider without mutating the saved rig resolution');
assert.equal(player.geometry.userData.segmentsX, 14, 'full portrait X dimensions scale');
assert.equal(player.geometry.userData.segmentsY, 18, 'full portrait Y dimensions scale');
assert.equal(player.geometry.getAttribute('position').count / 3, 1008, 'two-sided player portrait has quarter as many triangles');
assert.equal(enemy.geometry.userData.segmentsX, 17, 'head-mask special budget scales');
assert.equal(enemy.geometry.userData.segmentsY, 22);
assert.equal(enemy.geometry.getAttribute('position').count / 3, 748, 'enemy front-only grid has 17x22x2 triangles');
assert.deepEqual(enemy.geometry.drawRange, { start: 0, count: 17 * 22 * 6 }, 'front-only draw range updates');
assert.equal(builds[0].options.headBoundsPx, headBoundsPx, 'same original head-scale weight gate reused');
assert.equal(player.skeleton, skeleton, 'live player skeleton is not replaced');
assert.equal(player.position, pose, 'live player position/pose is not reset');
assert.equal(previousPlayerGeometry.disposed, true, 'retired player GPU geometry disposed');
assert.equal(previousEnemyGeometry.disposed, true, 'retired enemy GPU geometry disposed');
assert.equal(meshBudget.portraitDensityDebug().lastRebuilt, 2);
assert.equal(meshBudget.setPortraitDensityPercent(50), false, 'identical slider value does not rebuild');
assert.equal(builds.length, 2);
assert.equal(meshBudget.setPortraitDensityPercent(NaN), false, 'bad input is ignored');
assert.equal(meshBudget.setPortraitDensityPercent(0), true, 'out-of-range value clamps');
assert.equal(meshBudget.portraitDensityPercent(), 20);
assert.equal(meshBudget.portraitGrid('npc').segmentsX, 4, 'minimum still permits a valid weighted grid');
assert.equal(meshBudget.portraitGrid('npc').segmentsY, 6);
assert.equal(meshBudget.setPortraitDensityPercent(100), true, 'original resolution restored without recreating actors');
assert.deepEqual([meshBudget.animalGrid(48, 128/75).segmentsX, meshBudget.animalGrid(48, 128/75).segmentsY], [30, 18], '100% remains available for high-detail animal authoring');
assert.equal(player.geometry.userData.segmentsX, 28);
assert.equal(player.geometry.userData.segmentsY, 36);
assert.equal(meshBudget.portraitDensityDebug().triangles, 4032 + 2992, 'diagnostics count actual current geometry');
assert.equal(events.filter(event => event === 'hobunji:portrait-density-changed').length, 3);

// Doorstep visitors have independently posed skeletons but borrow their source NPC geometry.
const visitor = { isSkinnedMesh: true, geometry: player.geometry, skeleton: { id: 'visitor-pose' }, material: playerMaterials };
const oldShared = player.geometry;
assert.equal(meshBudget.trackSkinnedClone(player, visitor), true, 'a visitor using the real source geometry is registered');
assert.equal(meshBudget.trackSkinnedClone(player, visitor), true, 're-registering a visitor cannot create duplicate weak references');
assert.equal(meshBudget.portraitDensityDebug().tracked, 3);
assert.equal(meshBudget.trackSkinnedClone(enemy, { isSkinnedMesh: true, geometry: player.geometry }), false, 'unrelated geometry is not misregistered');
assert.equal(meshBudget.setPortraitDensityPercent(75), true, 'slider can update shared live geometry');
assert.notStrictEqual(player.geometry, oldShared);
assert.strictEqual(visitor.geometry, player.geometry, 'the visitor and source now share exactly one new geometry');
assert.equal(oldShared.disposed, true, 'the shared old buffer is disposed after both users have swapped');
assert.strictEqual(visitor.skeleton.id, 'visitor-pose', 'visitor skeleton is unchanged');
assert.equal(meshBudget.portraitDensityDebug().lastRebuilt, 3, 'three meshes were updated');
assert.equal(builds.length, 8, 'the shared geometry was rebuilt once, not once per clone');
assert.equal(meshBudget.unregisterSkinnedPortrait(visitor), true, 'removing the visitor unregisters its shared rig');
assert.equal(meshBudget.unregisterSkinnedPortrait(visitor), false, 'unregistering twice is harmless');
assert.equal(meshBudget.portraitDensityDebug().tracked, 2);
assert.equal(meshBudget.setPortraitDensityPercent(100), true);
assert.equal(meshBudget.portraitDensityDebug().lastRebuilt, 2, 'only remaining living rig owners update');
assert.equal(meshBudget.setPlayerMode('npc'), true, 'the existing player mesh cap remains independently adjustable');
assert.equal(meshBudget.portraitDensityDebug().player.segmentsX, 20, 'developer readout reflects the actual player NPC cap');
assert.equal(meshBudget.portraitDensityDebug().player.segmentsY, 26);
assert.equal(meshBudget.setPlayerMode('full'), true);
assert.equal(meshBudget.portraitDensityDebug().player.segmentsX, 28);

// Source geometry, custom editor geometry, and visitor copies all share one reversible wireframe authority.
assert.equal(meshBudget.setPortraitWireframeEnabled(true), true);
assert.equal(meshBudget.wireframeEnabled(), true);
assert.notStrictEqual(player.material, playerMaterials, 'debug material replaces the texture without mutating source material');
assert.equal(player.material.length, 2, 'two-sided portraits retain material groups');
assert.equal(player.material[0].wireframe, true);
assert.equal(player.material[0].skinning, true, 'Three r128 enables bone skinning on wireframe');
assert.equal(player.material[0].map, undefined, 'transparent PNG pixels do not hide mesh cells');
assert.equal(enemy.material.wireframe, true, 'hostile front-only material is also wireframe');
const debugMaterial = player.material[0]; // The toggler owns and later frees its replacement GPU shader material.
const wireVisitor = { isSkinnedMesh: true, geometry: player.geometry, skeleton: { id: 'visitor' }, material: player.material };
assert.equal(meshBudget.trackSkinnedClone(player, wireVisitor), true, 'cloning while wireframe is on registers a new material owner');
assert.notStrictEqual(wireVisitor.material, player.material, 'cloned visitor gets its own disposable wireframe material');
assert.equal(meshBudget.setPortraitWireframeEnabled(false), true);
assert.strictEqual(player.material, playerMaterials, 'source two-sided PNG materials are restored byte-for-byte');
assert.strictEqual(enemy.material, enemyMaterial, 'hostile original PNG material is restored');
assert.strictEqual(wireVisitor.material, playerMaterials, 'visitor source PNG materials are restored after cloning during wireframe');
assert.equal(debugMaterial.disposed, true, 'temporary wireframe materials are released');
assert.equal(meshBudget.setPortraitWireframeEnabled(false), false, 'repeated off is a no-op');
assert.equal(meshBudget.unregisterSkinnedPortrait(wireVisitor), true);

// The Animation Author uses a distinct two-bone skin builder, registered as an external geometry factory.
const editorCalls = []; // Records exact subdivisions and original authored pose during live editor updates.
const authorCallbacks = []; // Verifies the tool can re-bake lazy hat skins and hide them while wireframe is enabled.
const authorMaterial = [{ map: 'front' }, { map: 'back' }];
const author = { isSkinnedMesh: true, geometry: geometry(28, 36), skeleton: { id: 'author-rig' }, position: { x: 9 }, material: authorMaterial };
assert.equal(meshBudget.registerExternalSkinnedPortrait(author, {
  THREE, width: 2, height: 3, neckLocal, mode: 'full',
  buildGeometry(grid) {
    editorCalls.push(grid);
    return geometry(grid.segmentsX, grid.segmentsY);
  },
  afterGeometryChange(nextGeometry) { authorCallbacks.push(nextGeometry.userData.segmentsX); },
  onWireframeChanged(enabled) { authorCallbacks.push(enabled); },
}), true);
assert.equal(meshBudget.setPortraitDensityPercent(50), true);
assert.equal(author.geometry.userData.segmentsX, 14, 'the author uses its custom builder at the shared 50% resolution');
assert.equal(editorCalls.length, 1);
assert.equal(authorCallbacks.includes(14), true, 'the author receives a hook to update lazy hat skins');
assert.equal(author.skeleton.id, 'author-rig', 'custom author pose skeleton survives geometry replacement');
assert.equal(author.position.x, 9);
assert.equal(meshBudget.setPortraitWireframeEnabled(true), true);
assert.equal(author.material[0].wireframe, true);
assert.equal(authorCallbacks.includes(true), true, 'the editor can hide its textured hat overlays');
assert.equal(meshBudget.unregisterSkinnedPortrait(author), true);
assert.strictEqual(author.material, authorMaterial, 'unregistering during wireframe restores editor portrait materials');
assert.equal(meshBudget.setPortraitWireframeEnabled(false), true);
assert.equal(meshBudget.setPortraitDensityPercent(100), true);
assert.equal(meshBudget.setPortraitDensityPercent(meshBudget.defaultPortraitDensityPercent), true, 'developer override can return to the production baseline');
assert.deepEqual([meshBudget.animalGrid(48, 128/75).segmentsX, meshBudget.animalGrid(48, 128/75).segmentsY], [12, 7], 'exiting developer mode restores 40% for animal painted skins too');
assert.equal(player.geometry.userData.segmentsX, 11, 'returning to the default retessellates player portraits');
assert.equal(enemy.geometry.userData.segmentsY, 18, 'returning to the default retessellates enemy masks');

assert(uiSource.includes('painted animal head rigs') && uiSource.includes('flying-animal perches'), 'the developer UI describes both animal geometry systems accurately');
assert(uiSource.includes("densitySlider.type = 'range'"), 'dev UI has a real range input');
assert(uiSource.includes("densityRow.setAttribute('data-dev-only', '')"), 'slider is hidden outside developer mode');
assert(uiSource.includes('portraitBudget.setPortraitDensityPercent(Number(densitySlider.value))'), 'the UI uses the production budget authority');
assert(devSource.includes('portraitBudget?.setPortraitDensityPercent?.(portraitBudget.defaultPortraitDensityPercent)'), 'leaving developer mode restores the shared 40% production detail');
assert(devSource.includes('meshBudget?.setPortraitWireframeEnabled?.(false)'), 'developer mode teardown restores textured portraits');
assert(uiSource.includes("settingPortraitMeshWireframe"), 'the in-game wireframe checkbox is visible in developer diagnostics');
assert(uiSource.includes('portraitBudget.setPortraitWireframeEnabled(wireframe.input.checked)'), 'wireframe UI calls the shared real material manager');

console.log('OK: portrait density + wireframe + independent editor and cloned actor material lifecycle validated.');
