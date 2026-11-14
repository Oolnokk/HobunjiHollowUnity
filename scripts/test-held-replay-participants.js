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

const node = (name, parent = null, userData = {}) => { const n = { name, parent, userData, isMesh: true }; return n; };
const scene = { isScene: true, parent: null, userData: {} };
const player = node('player_root', scene);
const playerHand = node('hand', node('arm', player));
const playerFootRig = node('player_feet_rig', scene); // Composer-owned external root.
const playerFoot = node('foot', playerFootRig);
const npc = node('npc_walker_takua', scene);
const npcHand = node('hand', node('arm', npc));
const npcFoot = node('foot', npc);
const orphanBlade = node('blade', node('loose_group', scene)); // No resolvable owner: keeps the old fail-safe x-ray.

const window = { PlayerBodyTransformComposer: { getPlayerMesh: () => player, getVisualRoots: () => [playerFootRig], getPlayerLegHandle: () => null } };
const api = new Function('window', 'performance', code + '\nreturn { isReplayParticipant, splitReplayParticipants, setPolicy: v => { replayParticipantPolicy = v; }, skips: () => nonParticipantReplaySkips };')(window, { now: () => 0 });

const parts = [playerHand, playerFoot, npcHand, npcFoot, orphanBlade];
const others = [];
const kept = api.splitReplayParticipants(parts, scene, others);
assert.deepEqual(kept, [playerHand, playerFoot, orphanBlade], 'player parts (incl. composer-owned rigs) and ownerless parts keep the x-ray');
assert.deepEqual(others, [npcHand, npcFoot], 'NPC hands and feet fall back to ordinary depth');
assert.equal(api.skips(), 2, 'skips are counted for diagnostics');

api.setPolicy('all');
const othersAll = [];
assert.deepEqual(api.splitReplayParticipants(parts, scene, othersAll), parts, "'all' restores the previous participant set");
assert.equal(othersAll.length, 0);

// The split runs inside collectVisible, so the replay entry points need no new names.
assert.match(source, /const held = collectVisible\(heldRegistry, scene, replayOthers\);/);
assert.match(source, /const feet = collectVisible\(waterOccludedRegistry, scene, replayOthers\);/);
assert.match(source, /const othersHidden = replayOthers\.length \? hideObjects\(replayOthers\) : null;/, 'non-participants are hidden from the replays that draw the held-overlay layer');
console.log('ok - only the player\'s hands, feet and held items take part in the ground x-ray replays by default');
