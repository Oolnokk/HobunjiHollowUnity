// Executes the shipped head-scale weight functions to check the opt-in tight gate, plus the rule validation that carries it.
// Run with: node scripts/test-tight-head-gate.js
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
for (const name of ['smoothstep01', 'headScaleGateAtPixel', 'headScaleWeightAt']) vm.runInContext(extract(avatarSource, name), context);

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

// The rule is boolean-only and is copied onto the rolled roster for the avatar builder.
const win = {};
vm.runInNewContext(fs.readFileSync('docs/js/combat/enemy-loadout-rules.js', 'utf8'), {
  window: win, console, URL, document: { currentScript: { src: 'https://game.test/docs/js/combat/enemy-loadout-rules.js' }, baseURI: 'https://game.test/docs/' },
  fetch: async () => ({ ok: true, json: async () => ({ schema: 'hobunji_enemy_loadouts.v1', rules: {} }) }),
});
const rules = win.EnemyLoadoutRules;
assert.throws(() => rules.set({ schema: rules.schema, rules: { 'lich:hronal:azgarlu': { tightHeadGate: 'yes' } } }), /tightHeadGate/);
rules.set({ schema: rules.schema, rules: { 'lich:hronal:azgarlu': { tightHeadGate: true } } });
assert.equal(rules.applyRoster('lich:hronal:azgarlu', { appearance: {} }, Math.random).tightHeadGate, true);
assert.equal(rules.applyRoster('lich:tothal:nanahi', { appearance: {} }, Math.random).tightHeadGate, undefined, 'other enemies are unaffected');

// The hostile avatar builder hands the flag to both neck skins and to the recorded rig bounds.
const bandit = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
assert.equal((bandit.match(/tightHeadGate: roster\.tightHeadGate === true/g) || []).length, 2);
console.log('Tight head gate: weights, rule validation and roster hand-off verified');
