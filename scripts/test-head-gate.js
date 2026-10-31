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
for (const name of ['smoothstep01', 'headScaleGateAtPixel', 'headScaleWeightAt', 'defaultHeadGateFor', 'headGateBounds']) vm.runInContext(extract(avatarSource, name), context);


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
vm.runInContext("const LEGACY_HEAD_GATE_SPECIES = new Set(['mashtzarr', 'mammakhbuur']);", context);
for (const species of ['mashtzarr', 'mammakhbuur', 'Mashtzarr', 'mammakhbuur']) assert.equal(context.defaultHeadGateFor(species), 'legacy', species);
for (const species of ['harlyao-skeleton', 'mao-ao', 'engh-sho', 'ghoul', 'maskbound-guardian', 'porakaneki', null, undefined]) assert.equal(context.defaultHeadGateFor(species), 'tight', String(species));
assert.ok(context.headGateBounds(bounds, undefined, 'harlyao-skeleton').tightGate, 'unset + ordinary species = tight');
assert.equal(context.headGateBounds(bounds, undefined, 'mashtzarr'), bounds, 'unset + Mashtzarr = the original wide gate');
assert.equal(context.headGateBounds(bounds, 'legacy', 'harlyao-skeleton'), bounds, 'an explicit legacy wins');
assert.ok(context.headGateBounds(bounds, 'tight', 'mashtzarr').tightGate, 'an explicit tight wins');
assert.equal(context.headGateBounds(null, 'tight', 'x'), null);

// Rule: enum only, migrated from the first checkbox, copied onto the rolled roster.
const win = {};
vm.runInNewContext(fs.readFileSync('docs/js/combat/enemy-loadout-rules.js', 'utf8'), {
  window: win, console, URL, document: { currentScript: { src: 'https://game.test/docs/js/combat/enemy-loadout-rules.js' }, baseURI: 'https://game.test/docs/' },
  fetch: async () => ({ ok: true, json: async () => ({ schema: 'hobunji_enemy_loadouts.v1', rules: {} }) }),
});
const rules = win.EnemyLoadoutRules;
assert.throws(() => rules.set({ schema: rules.schema, rules: { 'lich:hronal:azgarlu': { headGate: 'wide' } } }), /headGate/);
rules.set({ schema: rules.schema, rules: { 'lich:hronal:azgarlu': { headGate: 'tight' }, 'lich:tothal:nanahi': { tightHeadGate: true }, 'lich:kanthic:imlao': { headGate: 'mask' } } });
assert.equal(rules.snapshot().rules['lich:kanthic:imlao']?.headGate, undefined, 'the removed skull-mask value is dropped');
assert.equal(rules.applyRoster('lich:hronal:azgarlu', { appearance: {} }, Math.random).headGate, 'tight');
assert.equal(rules.snapshot().rules['lich:tothal:nanahi'].headGate, 'tight', 'the first checkbox migrates');
assert.equal(rules.applyRoster('bandit:grunt', { appearance: {} }, Math.random).headGate, undefined, 'unruled enemies keep the global default');

// Wired into the hostile builder and the shared single-plane (player/NPC) builder, both species-aware.
const bandit = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
assert.match(bandit, /const headGate = roster\.headGate;/);
assert.equal((bandit.match(/headCanvas, headGate, speciesId: roster\.appearance\?\.speciesId \}\)/g) || []).length, 2, 'front and rear neck skins');
assert.match(bandit, /headGateBounds\?\.\(headPixels\?\.boundsPx, headGate, roster\.appearance\?\.speciesId\)/);
assert.match(avatarSource, /headGateBounds\(detectedHead\.boundsPx, config\.headGate, config\.speciesId\)/, 'player/NPC skinned assembly uses the species default');
assert.match(avatarSource, /speciesId, headGate: options\.headGate,/, 'buildSinglePlaneAvatarModel passes its species through');
assert.doesNotMatch(avatarSource, /buildHeadMaskWeights|headMask\.weightAtPixel/, 'the skull-mask experiment is gone');
console.log('Head gate: species defaults, tight box, rule migration and builder wiring verified');
