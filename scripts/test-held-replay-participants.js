#!/usr/bin/env node
'use strict';

// The hand/foot ground x-ray replays used to include every visible NPC's
// hands and feet; in town that made most draw calls per frame. By default
// only the player's own parts (and parts with no resolvable owner) take part.
// This runs the module's real ownership + split code against a fake scene.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'docs/js/held-object-render-order.js'), 'utf8');
const slice = (startMarker, endMarker) => {
  const a = source.indexOf(startMarker), b = source.indexOf(endMarker, a);
  assert.ok(a > 0 && b > a, 'found ' + startMarker);
  return source.slice(a, b);
};
const code = [
  slice('  function isDescendantOf(', '  function worldYOf('),
  slice('  function actorRootForXrayMesh(', '  function actorXrayScope('),
].join('\n');

const node = (name, parent = null, userData = {}) => ({ name, parent, userData, isMesh: true, matrixWorld: { elements: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] }, traverse(fn) { fn(this); } });
const at = (mesh, x, z) => { mesh.matrixWorld.elements[12] = x; mesh.matrixWorld.elements[14] = z; return mesh; };
const scene = { isScene: true, parent: null, userData: {} };
const player = node('player_root', scene);
const hand = (parent) => node('hand', parent, { hobunjiProceduralHand: true });
const playerHand = hand(node('arm', player));
const playerFootRig = node('player_feet_rig', scene); // Composer-owned external root.
const playerFootNear = at(node('foot', playerFootRig), 2, 0);
const playerFootFar = at(node('foot', playerFootRig), 9, 0);
const playerBlade = node('blade', player);
const tall = node('npc_walker_takua', scene, { speciesId: 'kenkari' });
const tallHand = hand(node('arm', tall)), tallFoot = at(node('foot', tall), 1, 0), tallSpear = node('spear', tall);
const shorty = node('porakaneki_hunter', scene, { hobunjiXrayActorRoot: true, speciesId: 'porakaneki' });
const shortHand = hand(node('arm', shorty)), shortFootNear = at(node('foot', shorty), 3, 0), shortFootFar = at(node('foot', shorty), 20, 0), shortClub = node('club', shorty);
const orphanHand = hand(node('loose_group', scene)); // No resolvable owner: keeps the old fail-safe x-ray.

const window = { PlayerBodyTransformComposer: { getPlayerMesh: () => player, getVisualRoots: () => [playerFootRig], getPlayerLegHandle: () => null } };
const api = new Function('window', 'performance', code + `
  replayCameraPosition = { x: 0, y: 0, z: 0 };
  return { split: (m, s, o, foot) => splitReplayParticipants(m, s, o, foot), setPolicy: v => { replayParticipantPolicy = v; }, skips: () => nonParticipantReplaySkips };`)(window, { now: () => 0 });

const heldOthers = [];
const held = api.split([playerHand, playerBlade, tallHand, tallSpear, shortHand, shortClub, orphanHand], scene, heldOthers, false);
assert.deepEqual(held, [playerHand, playerBlade, tallSpear, shortHand, shortClub, orphanHand], 'every weapon keeps the x-ray; hands only for the player and short species');
assert.deepEqual(heldOthers, [tallHand], 'a tall species\' hands draw with ordinary depth');
const feetOthers = [];
const feet = api.split([playerFootNear, playerFootFar, tallFoot, shortFootNear, shortFootFar], scene, feetOthers, true);
assert.deepEqual(feet, [playerFootNear, shortFootNear], 'feet x-ray only for the player and short species, and only near the camera');
assert.deepEqual(feetOthers, [playerFootFar, tallFoot, shortFootFar]);

api.setPolicy('all');
const othersAll = [];
assert.deepEqual(api.split([tallHand, tallFoot], scene, othersAll, true), [tallHand, tallFoot], "'all' restores the previous participant set");
assert.equal(othersAll.length, 0);

// The split runs inside collectVisible, so the replay entry points need no new names.
assert.match(source, /const held = collectVisible\(heldRegistry, scene, replayOthers\);/);
assert.match(source, /const feet = collectVisible\(waterOccludedRegistry, scene, replayOthers\);/);
assert.match(source, /const othersHidden = replayOthers\.length \? suppressDraws\(replayOthers, HELD_OVERLAY_MASK\) : null;/, 'non-participants are hidden from the replays that draw the held-overlay layer');
assert.match(source, /const shortXraySpecies = new Set\(\['porakaneki'\]\);/, 'Porakaneki are on the short-species list by default');
console.log('ok - weapons x-ray for everyone; hands for the player and short species; feet for those, near the camera only');
