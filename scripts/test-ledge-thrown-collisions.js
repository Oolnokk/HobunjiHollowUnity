#!/usr/bin/env node
'use strict';

// Regression for silhouette-tight thrown sweeps and ranged stand-ground combat across ledges.
// Extract only the relevant production helpers so tests don't require a WebGL/browser scene.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../docs/js/combat/ranged-weapons.js'), 'utf8'); // The production projectile solver is the authority under test.

function productionBlock(begin, end) {
  const start = code.indexOf('  function ' + begin + '(');
  const stop = code.indexOf('  function ' + end + '(', start);
  assert.ok(start !== -1 && stop > start, begin + ' must remain a testable function');
  return code.slice(start, stop);
}
const imageWidth = 10; // Test sprite contains 80% transparent padding, like a thin spear painted on a wide PNG plane.
const imageHeight = 8; // Used to build the exact alpha data instead of guessing at a rectangular canvas boundary.
const pixels = new Uint8ClampedArray(imageWidth * imageHeight * 4); // Alpha-only painted narrow vertical spear in the test PNG.
for (let y = 0; y < imageHeight; y++) for (const x of [4, 5]) pixels[(y * imageWidth + x) * 4 + 3] = 255;
const sandbox = {
  deps: { TILE: 32, worldSurfaceY: () => 1, creatureCanEnterTile: () => true },
  document: { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }),
  }) },
}; // Isolated native-browser canvas and tile-movement dependencies used by the production functions.
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`
  const opaqueSpriteBoundsCache = new WeakMap();
  const thrownRadiusByDefinition = new WeakMap();
  ${productionBlock('opaqueSpriteBounds', 'createProjectileMesh')}
  ${productionBlock('ledgesBlockMeleeApproach', 'updateBanditAI')}
  globalThis.helpers = { opaqueSpriteBounds, opaqueProjectileRadiusWorld, projectileCollisionRadiusWorld, projectileAimRadiusWorld, ledgesBlockMeleeApproach, thrownRadiusByDefinition };
`, sandbox);
const H = sandbox.helpers; // Direct reference to tested production functions.

const image = { width: imageWidth, height: imageHeight }; // Image dimensions include transparent padding.
const bounds = H.opaqueSpriteBounds(image);
assert.equal(bounds.minX, 4);
assert.equal(bounds.maxX, 5);
assert.equal(bounds.widthFraction, 0.2, 'only opaque x-pixels count toward collision width');
assert.equal(H.opaqueSpriteBounds(image), bounds, 'each decoded image gets just one alpha scan');

const def = { rangedType: 'thrown', projectileRadiusPx: 8 }; // Original default radius would falsely strike the cliff.
const plane = { geometry: { parameters: { width: 0.5 } }, scale: { x: 1 }, userData: { opaqueBounds: bounds } }; // Native live held projectile plane.
const projectile = { def, mesh: { userData: { projectilePlane: plane } }, visual: { scale: { x: 1 } } };
assert.ok(Math.abs(H.projectileCollisionRadiusWorld(projectile) - 0.05) < 1e-9, 'world collision radius follows the thin opaque spear rather than its full plane');
assert.equal(H.projectileAimRadiusWorld(def), 0.25, 'before sprite decode, aim uses the safe authored projectile radius');
H.thrownRadiusByDefinition.set(def, H.projectileCollisionRadiusWorld(projectile));
assert.ok(Math.abs(H.projectileAimRadiusWorld(def) - 0.05) < 1e-9, 'after decode, reticle and NPC LOS use the same opaque radius');
assert.equal(H.opaqueProjectileRadiusWorld({ rangedType: 'crossbow', projectileRadiusPx: 8 }, plane), 0.25, 'ordinary non-thrown shots retain the authored radius');

const c = { x: 0, y: 0, def: {} }, opponent = { x: 128, y: 0 }; // Two combatants on separated four-tile shelves.
assert.equal(H.ledgesBlockMeleeApproach(c, opponent), false, 'clear same-level travel may transition to melee');
sandbox.deps.worldSurfaceY = x => x > 32 && x < 96 ? -2 : 1;
assert.equal(H.ledgesBlockMeleeApproach(c, opponent), true, 'intervening low ravine keeps ranged combat active across isolated shelves');
sandbox.deps.worldSurfaceY = x => x > 64 ? 2 : 1;
assert.equal(H.ledgesBlockMeleeApproach(c, opponent), true, 'different ledge elevations prevent a false melee transition');
sandbox.deps.worldSurfaceY = () => 1;
sandbox.deps.creatureCanEnterTile = (_def, x) => x < 64;
assert.equal(H.ledgesBlockMeleeApproach(c, opponent), true, 'an impassable crossing preserves ranged mode even with clear sight');
assert.match(code, /const radiusWorld = projectileCollisionRadiusWorld\(p\);/, 'projectile terrain uses the same collision radius');
assert.match(code, /const projectileRadius = projectileCollisionRadiusWorld\(p\);/, 'actor and cover hits use the same collision radius');
console.log('Opaque sprite collision, LOS predictor, and ledge-melee fallbacks passed.');
