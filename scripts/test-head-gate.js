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
for (const name of ['smoothstep01', 'buildHeadMaskWeights', 'headScaleGateAtPixel', 'headScaleWeightAt', 'headGateBounds']) vm.runInContext(extract(avatarSource, name), context);
vm.runInContext("const DEFAULT_HEAD_GATE = 'mask';", context);

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

// Skull mask: a literal opaque-pixel mask (here a 100x100 canvas with a 40x40 skull) drives the weights, with a thin smooth edge.
const size = 100;
const pixels = new Uint8ClampedArray(size * size * 4);
for (let y = 30; y < 70; y++) for (let x = 30; x < 70; x++) pixels[(y * size + x) * 4 + 3] = 255;
const canvas = { width: size, height: size, getContext: () => ({ getImageData: () => ({ data: pixels }) }) };
const mask = context.buildHeadMaskWeights(canvas);
assert.equal(mask.weightAtPixel(50, 50), 1, 'skull interior is head-weighted');
assert.equal(mask.weightAtPixel(5, 50), 0, 'a hood far outside the skull is body-weighted');
assert.equal(mask.weightAtPixel(50, 95), 0, 'a vest below the skull is body-weighted');
assert.ok(mask.weightAtPixel(30, 50) > 0.9, 'the skull outline keeps full head scale');
const rim = [74, 75, 76, 77, 80, 85].map(x => mask.weightAtPixel(x, 50));
assert.ok(rim.every((w, i) => i === 0 || w <= rim[i - 1]) && rim.at(-1) === 0, 'the edge fades monotonically to the body');
const mirrored = context.buildHeadMaskWeights(canvas, true);
assert.equal(mirrored.weightAtPixel(100 - 50, 50), 1, 'the rear mesh samples the mirrored mask');
const maskBounds = context.headGateBounds(bounds, 'mask', canvas, false);
assert.equal(context.headScaleWeightAt(0, 0, 1, 50, maskBounds, 0), mask.weightAtPixel(50, 50), 'mask bounds drive headScaleWeightAt');
assert.equal(context.headGateBounds(bounds, 'legacy', canvas, false), bounds, 'legacy keeps the original gate');
assert.ok(context.headGateBounds(bounds, undefined, canvas, false).headMask, 'unset uses the global mask default');
assert.ok(context.headGateBounds(bounds, 'tight', canvas, false).tightGate);
assert.ok(context.headGateBounds(bounds, 'mask', { width: 0 }, false).tightGate, 'an unreadable head canvas falls back to the tight box');

// Rule: enum only, migrated from the first checkbox, copied onto the rolled roster.
const win = {};
vm.runInNewContext(fs.readFileSync('docs/js/combat/enemy-loadout-rules.js', 'utf8'), {
  window: win, console, URL, document: { currentScript: { src: 'https://game.test/docs/js/combat/enemy-loadout-rules.js' }, baseURI: 'https://game.test/docs/' },
  fetch: async () => ({ ok: true, json: async () => ({ schema: 'hobunji_enemy_loadouts.v1', rules: {} }) }),
});
const rules = win.EnemyLoadoutRules;
assert.throws(() => rules.set({ schema: rules.schema, rules: { 'lich:hronal:azgarlu': { headGate: 'wide' } } }), /headGate/);
rules.set({ schema: rules.schema, rules: { 'lich:hronal:azgarlu': { headGate: 'tight' }, 'lich:tothal:nanahi': { tightHeadGate: true } } });
assert.equal(rules.applyRoster('lich:hronal:azgarlu', { appearance: {} }, Math.random).headGate, 'tight');
assert.equal(rules.snapshot().rules['lich:tothal:nanahi'].headGate, 'tight', 'the first checkbox migrates');
assert.equal(rules.applyRoster('bandit:grunt', { appearance: {} }, Math.random).headGate, undefined, 'unruled enemies keep the global default');

// The hostile avatar builder is wired: global default, both neck skins and the recorded rig bounds all use the chosen gate.
const bandit = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
assert.match(avatarSource, /DEFAULT_HEAD_GATE = 'mask'/, 'the rig owns the global default');
assert.match(bandit, /const headGate = roster\.headGate;/);
assert.equal((bandit.match(/headCanvas, headGate \}\)/g) || []).length, 2, 'front and rear neck skins');
assert.match(bandit, /headGateBounds\?\.\(headPixels\?\.boundsPx, headGate, headCanvas, false\)/);
console.log('Head gate: skull mask, tight box, rule migration and builder wiring verified');
