'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('docs/game.js', 'utf8'); // Extracts the runtime helper without booting WebGL.
const start = source.indexOf('      function npcInteractionAimDistance('); // Runtime function boundaries.
const end = source.indexOf('      function updateNpcWalkers(', start); // Excludes unrelated game initialization.
const context = vm.createContext({}); // Isolated execution of the real helper.
vm.runInContext(source.slice(start, end), context);
const npc = (x, z, y = 0) => ({ root: { position: { x, y, z }, visible: true }, avatarGroup: { position: { y: 0.5 }, userData: { portraitModelHeight: 1, portraitModelWidth: 0.6 } } }); // Minimal rendered walker fixture.
const ray = { origin: { x: 0, y: 0.8, z: 0 }, direction: { x: 0, y: 0, z: 1 } }; // Forward reticle.
assert(Number.isFinite(context.npcInteractionAimDistance(npc(0, 2), ray)));
assert(Number.isFinite(context.npcInteractionAimDistance(npc(0.7, 2), ray)), 'forgiving near miss');
assert.strictEqual(context.npcInteractionAimDistance(npc(1.5, 2), ray), Infinity, 'off to the side');
assert.strictEqual(context.npcInteractionAimDistance(npc(0, -2), ray), Infinity, 'behind camera');
assert.strictEqual(context.npcInteractionAimDistance(npc(0, 2, 4), ray), Infinity, 'different elevation');
assert.strictEqual(context.npcInteractionAimDistance(npc(0, 2), null), Infinity, 'blocked interactions');
assert(context.npcInteractionAimDistance(npc(0, 2), ray) < context.npcInteractionAimDistance(npc(0, 3), ray));
console.log('NPC reticle interaction bounds passed');
