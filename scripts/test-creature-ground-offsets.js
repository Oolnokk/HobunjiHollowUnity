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
  drenkirra: { large: 0.45, medium: 0.40, small: 0.17 },
  grehlr: { large: 0.625, medium: 0.325, small: 0.13 },
  'gar-wolf': { large: 0.525, medium: 0.35, small: 0.11 },
  'dabinggi-hound': { large: 0.70, medium: 0.35, small: 0.09 },
  uumkaoii: { large: 0.75, medium: 0.25, small: 0.05 },
}; // Exact values from hobunji.attachment-rig-profiles.v10 exported 2026-11-22.
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
    skeeri: { defaultSizeClass: 'small', modelWidth: 0.65 },
    'skeeri-small': { defaultSizeClass: 'small', modelWidth: 0.65 },
    'skeeri-medium': { defaultSizeClass: 'medium', modelWidth: 1.15 },
    'skeeri-large': { defaultSizeClass: 'large', modelWidth: 2.2 },
  },
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
});
assert.equal(context.CreatureGenetics.creatureGroundOffset('drenkirra', 'large'), 0.45, 'explicit size class resolves as the authored floor-to-origin lift');
assert.equal(context.CreatureGenetics.creatureGroundOffset('grehlr', null), 0.325, 'default size class resolves as the authored floor-to-origin lift');
assert.equal(context.CreatureGenetics.creatureGroundOffset('gar-wolf-alpha', { sizeClass: 'small' }), 0.11, 'variant inherits base species floor-to-origin lift');
assert.equal(context.CreatureGenetics.creatureGroundOffset('unknown-kind', 'medium'), null, 'unknown species requests automatic fallback');

vm.runInContext(fs.readFileSync('docs/js/creature-ground-anchor.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/pingdort-registration.js', 'utf8'), context);
const pingdort = context.PingdortRegistration.PRESENTATION; // The native field model also supplies the rig tool's preview proportions.
const perchedBottomRatio = 413 / 494; // Last opaque row of the authored perched sprite, expressed as its lower edge.
for (const width of [pingdort.modelWidth, context.SCRATCHBONES_CONFIG.game.livestock.animalWidths.pingdort]) {
  const height = width * pingdort.spriteAspect; // Field and farm use slightly different native widths.
  for (const sizeClass of ['small', 'medium', 'large']) {
    const scaleY = context.CreatureGenetics.creatureSizeScale('pingdort', sizeClass).y; // The world scales both the sprite and its local correction.
    const lift = context.CreatureGenetics.creatureGroundOffset('pingdort', sizeClass); // Absolute world distance from support to the actor origin.
    const offset = context.CreatureGroundAnchor.planeOffset(height, perchedBottomRatio, lift / scaleY);
    const footY = lift + (offset + (.5 - perchedBottomRatio) * height) * scaleY;
    assert(Math.abs(footY) < 1e-9, `Pingdort ${width}/${sizeClass} lands on the support surface`);
  }
}

const skeeriWidths = { small: 0.65, medium: 1.15, large: 2.2 }; // Real ruined Skeeri native model widths used for class-proportional floor lift.
const expectedSkeeriOffset = { small: 0.07, medium: 0.07 * (1.15 / 0.65), large: 0.07 * (2.2 / 0.65) }; // Shared Pingdort Small floor Y scales to Skeeri native widths.
const mediumSkeeriOffsets = { small: 0.1, medium: 0.26, large: 0.375 }; // Independently authored Medium Skeeri size-class floor lifts.
const pingdortGrip = context.HOBUNJI_ATTACHMENT_RIG_PROFILES.creatures.pingdort.anchors.shoulderGrip.position; // Checks the live copied grip rather than a second hardcoded constant.
for (const kind of ['skeeri', 'skeeri-small', 'skeeri-medium', 'skeeri-large']) {
  const profile = context.HOBUNJI_ATTACHMENT_RIG_PROFILES.creatures[kind]; // Every domestic/ruin registry entry must reach the new rig source.
  assert.deepEqual({ ...profile.anchors.shoulderGrip.position }, { ...pingdortGrip }, kind + ' runtime should copy Pingdort shoulder grip');
  for (const sizeClass of ['small', 'medium', 'large']) {
    assert.equal(context.CreatureGenetics.creatureGroundOffset(kind, sizeClass), (kind === 'skeeri-medium' ? mediumSkeeriOffsets : expectedSkeeriOffset)[sizeClass], kind + ' '+ sizeClass + ' runtime floor offset matches authored species rig');
  }
  const defaultClass = kind === 'skeeri' ? 'small' : kind.slice('skeeri-'.length); // Distinguishes native fixed-size ruin variants from the domestic species.
  assert.equal(context.CreatureGenetics.creatureGroundOffset(kind, null), (kind === 'skeeri-medium' ? mediumSkeeriOffsets : expectedSkeeriOffset)[defaultClass], kind + ' defaults to its authored native floor lift');
  const defaultSize = context.CreatureGenetics.creatureSizeScale(kind, defaultClass); // Uses the real genetics renderer's profile lookup, not just the master table.
  assert.equal(defaultSize.x, 1, kind + ' native fixed class retains 1x width');
  assert.equal(defaultSize.y, 1, kind + ' native fixed class retains 1x height');
}
for (const sizeClass of ['small', 'medium', 'large']) {
  const scale = context.CreatureGenetics.creatureSizeScale('skeeri', sizeClass); // Domestic Skeeri use one Small native sprite with genetic size multipliers.
  const ratio = skeeriWidths[sizeClass] / skeeriWidths.small; // Class scaling must match ground Y to avoid hover on the farm or in a stable.
  assert.equal(scale.x, ratio, sizeClass + ' domestic Skeeri width tracks its class');
  assert.equal(scale.y, ratio, sizeClass + ' domestic Skeeri height tracks its class');
}

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
