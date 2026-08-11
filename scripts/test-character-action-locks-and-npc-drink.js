#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const lockSource = read('docs/js/character-action-locks.js');
const interaction = read('docs/js/npc-drink-interaction.js');
const npcCharacterState = read('docs/js/npc-character-state.js');
const game = read('docs/game.js');
const bridge = read('docs/js/alcohol-gameplay-bridge.js');
const probe = read('docs/js/pixel-probe.js');
const index = read('docs/index.html');

let now = 100;
const context = { window: {}, performance: { now: () => now } };
vm.runInNewContext(lockSource, context);
const locks = context.window.CharacterActionLocks;

const first = locks.acquire({
  owner: 'test-interaction-a', participants: ['player', 'npc:kzubug'], channels: ['movement', 'tools'],
});
const second = locks.acquire({
  owner: 'test-interaction-b', participants: [{ id: 'player', channels: ['movement'] }],
});
assert.equal(locks.isLocked('player', 'movement'), true);
assert.equal(locks.isLocked('player', 'tools'), true);
assert.equal(locks.isLocked('npc:kzubug', 'tools'), true);
first.release();
assert.equal(locks.isLocked('player', 'movement'), true,
  'an overlapping movement lock survives release of a different token');
assert.equal(locks.isLocked('player', 'tools'), false,
  'a channel unlocks once its final covering token releases');
second.release();
assert.equal(locks.isLocked('player', 'movement'), false);

const expiring = locks.acquire({ owner: 'timeout', participants: ['player'], channels: ['actions'], timeoutMs: 50 });
assert(expiring);
now = 151;
assert.equal(locks.isLocked('player', 'actions'), false, 'expired locks fail safe instead of stranding input');

assert(index.indexOf('js/character-action-locks.js') < index.indexOf('game.js?v='),
  'the shared action lock registry loads before the game integration');
assert(index.indexOf('js/npc-drink-interaction.js') < index.indexOf('game.js?v='),
  'the NPC drink state machine loads before its game adapters');
assert(index.indexOf('js/npc-character-state.js') < index.indexOf('game.js?v='),
  'the NPC action/impairment adapter loads before game integration');
assert.match(interaction, /function play[\s\S]*?owner: 'npc-drink-interaction'/,
  'NPC drink playback acquires the reusable interaction lock');
assert.match(interaction, /phase: 'handoff'[\s\S]*?lerpVectors[\s\S]*?slerpQuaternions/,
  'the bottle position, scale, and orientation interpolate toward the NPC hand');
assert.match(interaction, /walker\.root\.add\(interaction\.holder\)[\s\S]*?poseAt/,
  'the transferred bottle re-parents to the NPC and reuses authored drink poses');
assert.match(interaction, /progress >= \(Number\(animation\.strikeFrac\)/,
  'the swig effect lands at the authored drink strike rather than before handoff');
assert.match(game, /NpcDrinkInteraction\?\.init[\s\S]*?getPlayerDrinkSourceTransform[\s\S]*?cancelPlayerToolAnimation/,
  'game.js exposes only dependency adapters needed for its private player state');
assert.match(game, /NpcDrinkInteraction\?\.update\?\.\(dt\)/,
  'the game loop advances the decoupled interaction module through its public API');
assert.doesNotMatch(game, /activeNpcDrinkInteractions|phase: 'handoff'|slerpQuaternions|finishNpcDrinkInteraction/,
  'the interaction state machine no longer lives in game.js');
assert.match(game, /CharacterActionLocks\?\.isLocked\?\.\(PLAYER_ACTION_LOCK_ID, 'movement'\)[\s\S]*?player\.vx = 0/,
  'the player movement choke point obeys interaction locks');
assert.match(game, /CharacterActionLocks\?\.isLocked\?\.\(PLAYER_ACTION_LOCK_ID, 'tools'\)[\s\S]*?toolHolder\.visible = false/,
  'the player tool renderer obeys interaction locks');
assert.match(npcCharacterState, /CharacterActionLocks[\s\S]*?stationToolMesh\.visible = !toolsLocked/,
  'the NPC state module makes routing and station tools obey the shared lock registry');
assert.match(game, /NpcCharacterState\?\.update\?\.\(this, dt/,
  'the NPC update choke point delegates lock and impairment state handling');
assert.match(bridge, /canPlayNpcDrinkInteraction[\s\S]*?playNpcDrinkInteraction/,
  'accepted swigs validate and start synchronized playback through injected game dependencies');
assert(probe.includes('Character action locks:') && probe.includes('NPC drink interactions:'),
  'Pixel Probe exposes active locks and handoff phase on mobile');

console.log('Reusable character action lock and NPC drink interaction checks passed.');
