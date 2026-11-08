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
sandbox.window = sandbox; // Production LOS helpers read optional world-volume globals through window.
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

const c = { id: 'omgurku-shooter', x: 0, y: 0, def: {}, health: 20 }, opponent = { id: 'porakaneki-target', x: 128, y: 0, health: 20 }; // Two combatants on separated four-tile shelves.
assert.equal(H.ledgesBlockMeleeApproach(c, opponent), false, 'clear same-level travel may transition to melee');
sandbox.deps.worldSurfaceY = x => x > 32 && x < 96 ? -2 : 1;
assert.equal(H.ledgesBlockMeleeApproach(c, opponent), true, 'intervening low ravine keeps ranged combat active across isolated shelves');
sandbox.deps.worldSurfaceY = x => x > 64 ? 2 : 1;
assert.equal(H.ledgesBlockMeleeApproach(c, opponent), true, 'different ledge elevations prevent a false melee transition');
sandbox.deps.worldSurfaceY = x => x > 32 && x < 96 ? 3 : 1;
assert.equal(H.ledgesBlockMeleeApproach(c, opponent), true, 'intervening raised terrain also blocks direct melee');
sandbox.deps.worldSurfaceY = () => 1;
let navigationChecks = 0; // Verifies the real creature navigation seam receives its required origin tile and actor identity.
sandbox.deps.creatureCanEnterTile = (_def, x, _y, fromX, fromY, actor, walkingPath) => {
  assert.ok(Number.isFinite(fromX) && Number.isFinite(fromY), 'cliff movement gate needs the previous tile');
  assert.equal(actor, c, 'the live actor carries its own cliff-climb and areaGrid state');
  assert.equal(walkingPath, true, 'pathfinding must test climbable vs impassable faces');
  navigationChecks++;
  return x < 64;
};
assert.equal(H.ledgesBlockMeleeApproach(c, opponent), true, 'an impassable crossing preserves ranged mode even with clear sight');
assert.ok(navigationChecks > 0, 'ledge detection actually calls the creature path gate');

vm.runInContext(`
  const BANDIT_LOS_TERRAIN_STEP_TILES = 0.75;
  function banditLosSegment(c, target) {
    return { start: { x: c.x / deps.TILE, y: 0.5, z: c.y / deps.TILE }, end: { x: target.x / deps.TILE, y: 0.5, z: target.y / deps.TILE } };
  }
  function shaftCoverT() { return null; }
  function sceneGeometrySightBlock() { return null; }
  function dynamicSupportHitT() { return null; }
  function actorHitbox(actor) { return { actor }; }
  function segmentHitboxInterval(_start, _end, hitbox) { return hitbox?.actor ? { enter: 0.4 } : null; }
  ${productionBlock('computeBanditLos', 'banditLosStatus')}
  globalThis.helpers.computeBanditLos = computeBanditLos;
`, sandbox);
sandbox.deps.getCurrentArea = () => 'forest';
sandbox.deps.worldSurfaceY = () => 0;
const rayRadii = []; // NPC sight/raycast uses the same pixel-accurate radius as real projectiles.
sandbox.deps.canOccupyAt = (_x, _y, radius) => { rayRadii.push(radius); return true; };
sandbox.deps.hostileObjects = [c, opponent]; // Both tribes are hostileObjects, but the target is not an ally blocking its own shot.
const clearOpponent = H.computeBanditLos(c, opponent, def);
assert.equal(clearOpponent.clear, true, 'the actual rival tribe target cannot block its own ranged sightline');
assert.ok(rayRadii.length > 0 && rayRadii.every(radius => Math.abs(radius - 0.05 * sandbox.deps.TILE) < 1e-9), 'NPC LOS occupancy checks use the opaque PNG radius, not the old full-plane radius');
const ally = { id: 'omgurku-ally', health: 20 }; // A third actor really should obstruct the thrown spear.
sandbox.deps.hostileObjects.push(ally);
assert.equal(H.computeBanditLos(c, opponent, def).kind, 'ally', 'a different actor continues to block a friendly-fire shot');
const game = fs.readFileSync(path.join(__dirname, '../docs/game.js'), 'utf8'); // The production initialization must actually inject the movement callback tested above.
const rangeInit = game.slice(game.indexOf('window.RangedWeapons?.init({'), game.indexOf('window.Mounts?.init({'));
assert.match(rangeInit, /creatureCanEnterTile,/, 'live ranged NPCs receive the same cliff-step gate as moving bandits');
assert.match(code, /const radiusWorld = projectileCollisionRadiusWorld\(p\);/, 'projectile terrain uses the same collision radius');
assert.match(code, /const projectileRadius = projectileCollisionRadiusWorld\(p\);/, 'actor and cover hits use the same collision radius');
console.log('Opaque projectile collision, real cliff navigation, tribe LOS and NPC radius parity passed.');
