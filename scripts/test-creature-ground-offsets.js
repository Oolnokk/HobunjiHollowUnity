#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Verifies the authored v10 ground offsets and every runtime path that must preserve them.
const fs = require('node:fs'); // Reads the canonical browser sources used by the game.
const vm = require('node:vm'); // Evaluates the shared rig/genetics data without launching a browser.

const context = { console, addEventListener() {} }; // Minimal browser-like global required by attachment/genetics modules.
context.window = context;
context.globalThis = context;
context.SCRATCHBONES_CONFIG = { game: { creatureGenetics: { palettes: { default: [{ id: 'test', name: 'Test', hex: '#888888', weight: 1 }] } } } };
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/config/attachment-rig-profiles.js', 'utf8'), context);

const expected = {
  drenkirra: { large: 0.79, medium: 0.40, small: 0.17 },
  grehlr: { large: 0.50, medium: 0.26, small: 0.10 },
  'gar-wolf': { large: 0.50, medium: 0.33, small: 0.11 },
  'dabinggi-hound': { large: 0.50, medium: 0.27, small: 0.09 },
  uumkaoii: { large: 0.69, medium: 0.48, small: 0.09 },
}; // Exact values from hobunji.attachment-rig-profiles.v10 exported 2026-08-30.
for (const [kind, offsets] of Object.entries(expected)) {
  assert.deepEqual({ ...context.HOBUNJI_ATTACHMENT_RIG_PROFILES.creatures[kind].groundOffsets }, offsets, `${kind} ground offsets match authored v10 data`);
}

vm.runInContext(fs.readFileSync('docs/js/creature-genetics.js', 'utf8'), context);
context.CreatureGenetics.init({
  CREATURE_DB: {
    drenkirra: { defaultSizeClass: 'large' },
    grehlr: { defaultSizeClass: 'medium' },
    'gar-wolf': { defaultSizeClass: 'medium' },
    'gar-wolf-alpha': { defaultSizeClass: 'large' },
    'dabinggi-hound': { defaultSizeClass: 'medium' },
    uumkaoii: { defaultSizeClass: 'medium' },
  },
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
});
assert.equal(context.CreatureGenetics.creatureGroundOffset('drenkirra', 'large'), 0.79, 'explicit size class resolves as the authored floor-to-origin lift');
assert.equal(context.CreatureGenetics.creatureGroundOffset('grehlr', null), 0.26, 'default size class resolves as the authored floor-to-origin lift');
assert.equal(context.CreatureGenetics.creatureGroundOffset('gar-wolf-alpha', { sizeClass: 'small' }), 0.11, 'variant inherits base species floor-to-origin lift');
assert.equal(context.CreatureGenetics.creatureGroundOffset('unknown-kind', 'medium'), null, 'unknown species requests automatic fallback');

const game = fs.readFileSync('docs/game.js', 'utf8');
assert.match(game, /const groundLift = Number\.isFinite\(authoredGroundOffset\) \? authoredGroundOffset : halfH/, 'wild creatures replace half-height with authored lift when available');
assert.match(game, /ty = surfY \+ \(c\.groundLift \?\? c\.halfHeight\) \* scaleY \+ meleeLeapY/, 'terrain-follow uses exactly one floor-to-origin baseline');
assert.match(game, /\(mountRideEntity\.groundLift \?\? mountRideEntity\.halfHeight\) \+ saddleY/, 'mount rider seat lift uses the carrier floor-to-origin baseline once');
assert.match(game, /surfY \+ \(c\.groundLift \?\? c\.halfHeight\)/, 'cutscene creature placement uses the replacement baseline');

assert.match(game, /resolveCreatureGroundAnchorRatio\(def\.sprites\.idle/, 'wild creatures retain existing child-plane opacity grounding');

const farm = fs.readFileSync('docs/js/farm-animals.js', 'utf8');
assert.match(farm, /creatureGroundOffset\('uumkaoii', genotype\)/, 'uumkaoii livestock resolves the authored offset');
assert.match(farm, /creatureGroundOffset\(kind, genotype\)/, 'pattern livestock resolves the authored offset');
assert.equal((farm.match(/\(this\.groundLift \?\? this\.halfHeight\)/g) || []).length, 2, 'both farm-animal update loops use one replacement baseline');

const mount = fs.readFileSync('docs/js/mount-system.js', 'utf8');
assert.match(mount, /surfY \+ \(m\.groundLift \?\? m\.halfHeight\) \* \(m\.scaleY \?\? 1\)/, 'mount area relocation uses the replacement baseline');
assert.match(mount, /Number\(m\.groundLift \?\? m\.halfHeight\)/, 'settled rider pin subtracts the same carrier baseline exactly once');

console.log('authored creature ground offset checks passed');
