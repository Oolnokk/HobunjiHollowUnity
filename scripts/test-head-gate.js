// Executes the shipped head-scale weight functions to check the opt-in tight gate, plus the rule validation that carries it.
// Run with: node scripts/test-head-gate.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const avatarSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing ${name}`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  return source.slice(start, end);
}
const context = vm.createContext({});
for (const name of ['smoothstep01', 'buildHeadMaskWeights', 'headScaleGateAtPixel', 'headScaleWeightAt', 'defaultHeadGateFor', 'headGateBounds']) vm.runInContext(extract(avatarSource, name), context);


const bounds = { left: 46, right: 154, top: 51, bottom: 148 };
const tight = { ...bounds, tightGate: true };
const farPixelX = 20, nearPixelX = 100; // Hood/shoulder outside the skull's width vs a skull pixel.
assert.equal(context.headScaleGateAtPixel(nearPixelX, bounds), 1);
assert.equal(context.headScaleGateAtPixel(nearPixelX, tight), 1, 'the skull itself keeps head scale');
assert.ok(context.headScaleGateAtPixel(farPixelX, bounds) > 0.5, 'default gate swallows a wide hood');
assert.equal(context.headScaleGateAtPixel(farPixelX, tight), 0, 'tight gate hands the wide hood to the body');

// Below the skull the default fade is long; the tight one ends head scaling close to the chin.
const model = 0.9, neckY = -0.1, belowChin = neckY - model * 0.1;
assert.ok(context.headScaleWeightAt(belowChin, neckY, model, nearPixelX, bounds, 0) > 0.1, 'default gate still head-weights below the chin');
assert.equal(context.headScaleWeightAt(belowChin, neckY, model, nearPixelX, tight, 0), 0, 'tight gate stops just below the skull');
assert.equal(context.headScaleWeightAt(neckY + 0.2, neckY, model, nearPixelX, tight, 0), 1, 'skull height stays fully head-weighted');

// Species default: tight for everyone, legacy for Mashtzarr and Mammakhbuur; an explicit mode always wins.
vm.runInContext("const LEGACY_HEAD_GATE_SPECIES = new Set(['mashtzarr', 'mammakhbuur', 'maskbound-guardian']); const LEGACY_HEAD_GATE_COSMETICS = [/binding_mask/i];", context);
for (const species of ['mashtzarr', 'mammakhbuur', 'Mashtzarr', 'maskbound-guardian', 'MASKBOUND_GUARDIAN']) assert.equal(context.defaultHeadGateFor(species), 'legacy', species);
for (const species of ['harlyao-skeleton', 'mao-ao', 'engh-sho', 'ghoul', 'porakaneki', null, undefined]) assert.equal(context.defaultHeadGateFor(species), 'tight', String(species));
assert.ok(context.headGateBounds(bounds, undefined, 'harlyao-skeleton').tightGate, 'unset + ordinary species = tight');
assert.equal(context.headGateBounds(bounds, undefined, 'mashtzarr'), bounds, 'unset + Mashtzarr = the original wide gate');
assert.equal(context.headGateBounds(bounds, 'legacy', 'harlyao-skeleton'), bounds, 'an explicit legacy wins');
assert.ok(context.headGateBounds(bounds, 'tight', 'mashtzarr').tightGate, 'an explicit tight wins');
assert.equal(context.headGateBounds(null, 'tight', 'x'), null);
// Clothing can override the species rule: a Hachutu binding mask forces legacy on any wearer; other pieces do not.
assert.equal(context.defaultHeadGateFor('harlyao-skeleton', ['hachutu_binding_mask_ii']), 'legacy', 'the oversized binding mask forces the wide gate');
assert.equal(context.defaultHeadGateFor('harlyao-skeleton', ['tangedcirclet', 'ragged_hood']), 'tight', 'ordinary headwear keeps the species default');
assert.equal(context.defaultHeadGateFor('mashtzarr', ['tangedcirclet']), 'legacy');
assert.equal(context.headGateBounds(bounds, undefined, 'ghoul', null, false, ['hachutu_binding_mask_ii']), bounds, 'headGateBounds honors the clothing override');
assert.ok(context.headGateBounds(bounds, 'tight', 'ghoul', null, false, ['hachutu_binding_mask_ii']).tightGate, 'an explicit rule still beats the clothing override');

// Opt-in mask gate: the opaque pixels of a head-only render (head plus equipped head cosmetics) drive head scale, with a thin smooth edge.
const size = 100;
const pixels = new Uint8ClampedArray(size * size * 4);
for (let y = 30; y < 70; y++) for (let x = 20; x < 80; x++) pixels[(y * size + x) * 4 + 3] = 255; // A skull plus a wide hood.
const canvas = { width: size, height: size, getContext: () => ({ getImageData: () => ({ data: pixels }) }) };
const mask = context.buildHeadMaskWeights(canvas);
assert.equal(mask.weightAtPixel(50, 50), 1, 'head interior is head-weighted');
assert.equal(mask.weightAtPixel(25, 50), 1, 'an equipped hood counts as head');
assert.equal(mask.weightAtPixel(5, 50), 0, 'torso outside the head render is body-weighted');
assert.equal(mask.weightAtPixel(50, 95), 0, 'a vest below the head render is body-weighted');
const rim = [84, 85, 86, 88, 92].map(x => mask.weightAtPixel(x, 50));
assert.ok(rim.every((w, i) => i === 0 || w <= rim[i - 1]) && rim.at(-1) === 0, 'the edge fades monotonically to the body');
assert.equal(context.buildHeadMaskWeights(canvas, true).weightAtPixel(100 - 50, 50), 1, 'the rear mesh samples the mirrored mask');
const maskBounds = context.headGateBounds(bounds, 'mask', 'harlyao-skeleton', canvas, false);
assert.equal(context.headScaleWeightAt(0, 0, 1, 50, maskBounds, 0), mask.weightAtPixel(50, 50), 'mask bounds drive headScaleWeightAt');
assert.ok(context.headGateBounds(bounds, 'mask', 'harlyao-skeleton', { width: 0 }).tightGate, 'an unreadable mask render falls back to the tight box');
assert.ok(!context.headGateBounds(bounds, undefined, 'harlyao-skeleton', canvas).headMask, 'the mask is never a default');

// Rule: enum only, migrated from the first checkbox, copied onto the rolled roster.
const win = {};
vm.runInNewContext(fs.readFileSync('docs/js/combat/enemy-loadout-rules.js', 'utf8'), {
  window: win, console, URL, document: { currentScript: { src: 'https://game.test/docs/js/combat/enemy-loadout-rules.js' }, baseURI: 'https://game.test/docs/' },
  fetch: async () => ({ ok: true, json: async () => ({ schema: 'hobunji_enemy_loadouts.v1', rules: {} }) }),
});
const rules = win.EnemyLoadoutRules;
assert.throws(() => rules.set({ schema: rules.schema, rules: { 'lich:hronal:azgarlu': { headGate: 'wide' } } }), /headGate/);
rules.set({ schema: rules.schema, rules: { 'lich:hronal:azgarlu': { headGate: 'tight' }, 'lich:tothal:nanahi': { tightHeadGate: true }, 'lich:kanthic:imlao': { headGate: 'mask' } } });
assert.equal(rules.snapshot().rules['lich:kanthic:imlao'].headGate, 'mask', 'the opt-in mask gate is a valid rule value');
assert.equal(rules.applyRoster('lich:hronal:azgarlu', { appearance: {} }, Math.random).headGate, 'tight');
assert.equal(rules.snapshot().rules['lich:tothal:nanahi'].headGate, 'tight', 'the first checkbox migrates');
assert.equal(rules.applyRoster('bandit:grunt', { appearance: {} }, Math.random).headGate, undefined, 'unruled enemies keep the global default');

// Wired into the hostile builder and the shared single-plane (player/NPC) builder, both species-aware.
const bandit = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
assert.match(bandit, /const headGate = roster\.headGate;/);
assert.equal((bandit.match(/headCanvas, headGate, headMaskCanvas, speciesId: roster\.appearance\?\.speciesId,[^}]*cosmeticIds: roster\.equippedCosmetics \}\)/g) || []).length, 2, 'front and rear neck skins');
assert.match(bandit, /headGateBounds\?\.\(headPixels\?\.boundsPx, headGate, roster\.appearance\?\.speciesId, headMaskCanvas, false, roster\.equippedCosmetics\)/);
assert.match(bandit, /headCosmeticsOnly: true/, 'the mask render is requested only for the mask gate');
assert.match(fs.readFileSync('docs/js/portrait-utils.js', 'utf8'), /headCosmeticsOnly = renderOptions\?\.headCosmeticsOnly === true/, 'the portrait renderer supports a head + cosmetics-only render');
assert.match(avatarSource, /headGateBounds\(detectedHead\.boundsPx, config\.headGate, config\.speciesId, null, false, config\.cosmeticIds\)/, 'player/NPC skinned assembly uses the species and clothing default');
assert.match(avatarSource, /speciesId, headGate: options\.headGate,/, 'buildSinglePlaneAvatarModel passes its species through');
console.log('Head gate: species defaults, tight box, rule migration and builder wiring verified');
