#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

global.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
global.document = { getElementById: () => null, querySelector: () => null, dispatchEvent: () => {}, addEventListener: () => {} };
global.window = {};

require(path.join(root, 'docs/js/color-fill.js'));
require(path.join(root, 'docs/js/sprite-recolor.js'));
require(path.join(root, 'docs/js/alchemy-system.js'));

const ITEM_DEFS = {};
window.AlchemySystem.init({ ITEM_DEFS, inventory: {} });
const A = window.AlchemySystem;

function average(keys) {
  const colors = keys.map(key => A.REAGENT_DEFS[key].color);
  const channel = shift => Math.round(colors.reduce((sum, color) => sum + (color >> shift & 255), 0) / colors.length);
  return channel(16) << 16 | channel(8) << 8 | channel(0);
}

const oneAfflict = ['bogwortLeaf', 'graniteThistle', 'palehartLichen'];
const oneColors = A.throwingFlaskColors(oneAfflict);
assert.deepEqual(oneColors.afflictKeys, ['bogwortLeaf'], 'one Afflict reagent alone owns the secondary flask color');
assert.deepEqual(oneColors.otherKeys, ['graniteThistle', 'palehartLichen'], 'the original bottle region excludes the Afflict reagent');
assert.equal(oneColors.afflictColor, A.REAGENT_DEFS.bogwortLeaf.color);
assert.equal(oneColors.primaryColor, average(['graniteThistle', 'palehartLichen']));

const twoAfflict = ['bogwortLeaf', 'sporeclusterCap', 'graniteThistle'];
const twoColors = A.throwingFlaskColors(twoAfflict);
assert.equal(twoColors.afflictColor, average(['bogwortLeaf', 'sporeclusterCap']), 'two Afflict reagent colors mix into the secondary region');
assert.equal(twoColors.primaryColor, A.REAGENT_DEFS.graniteThistle.color, 'the lone non-Afflict reagent owns the original region');

const allAfflict = ['bogwortLeaf', 'sporeclusterCap', 'weepingReed'];
const allColors = A.throwingFlaskColors(allAfflict);
assert.equal(allColors.primaryColor, average(allAfflict), 'all-Afflict brews fall back to their shared average for the original region');
assert.equal(allColors.afflictColor, average(allAfflict), 'all-Afflict brews use the same truthful shared average for the secondary region');

const flaskKey = A.ensureRecipeItemDef('venomFlask', 0, oneAfflict);
const flaskDef = ITEM_DEFS[flaskKey];
assert.equal(flaskDef.spriteIcon, 'throwing_flask.png', 'throwable Afflict recipes use the authored throwing flask sprite');
assert.equal(flaskDef.spriteColor, oneColors.primaryColor, 'throwing flask original target stores the non-Afflict mix');
assert.equal(flaskDef.spriteSecondaryColor, oneColors.afflictColor, 'throwing flask secondary target stores the Afflict color');
assert.equal(flaskDef.spriteMode, `dual-keyed:${oneColors.afflictColor.toString(16).padStart(6, '0')}`);
assert.equal(flaskDef.alchemyFlaskColorSource, 'ingredients');

const potionKey = A.ensureRecipeItemDef('healingPotion', 0, oneAfflict);
assert.equal(ITEM_DEFS[potionKey].spriteIcon, 'bottle_potion.png', 'ordinary potions keep the regular bottle sprite');
assert.equal(ITEM_DEFS[potionKey].spriteMode, 'keyed', 'ordinary potions keep the one-color keyed recolor path');

const ColorFill = window.ColorFill;
const pixels = new Uint8ClampedArray([
  0x9E, 0xD7, 0x75, 255,
  0x69, 0x8F, 0x4E, 180,
  0xE6, 0xDD, 0x2C, 255,
  0xC0, 0x9C, 0x09, 180,
  0x44, 0x4B, 0x6F, 203,
]);
const sourceValues = [0, 4, 8, 12].map(index => ColorFill.rgbToHsv(pixels[index], pixels[index + 1], pixels[index + 2]).v);
const primaryTarget = 0x3366CC;
const secondaryTarget = 0xCC3344;
window.SpriteRecolor.recolorImageData(pixels, primaryTarget, 'dual-keyed:cc3344');
const primaryHue = ColorFill.rgbToHsv(0x33, 0x66, 0xCC).h;
const secondaryHue = ColorFill.rgbToHsv(0xCC, 0x33, 0x44).h;
for (const [index, targetHue, sourceValue] of [[0, primaryHue, sourceValues[0]], [4, primaryHue, sourceValues[1]], [8, secondaryHue, sourceValues[2]], [12, secondaryHue, sourceValues[3]]]) {
  const recolored = ColorFill.rgbToHsv(pixels[index], pixels[index + 1], pixels[index + 2]);
  assert.ok(ColorFill.hueDistance(recolored.h, targetHue) < 1, `pixel ${index / 4} must use its assigned target hue`);
  assert.ok(Math.abs(recolored.v - sourceValue) < 0.01, `pixel ${index / 4} must preserve authored light/shade value`);
}
assert.deepEqual(Array.from(pixels.slice(16, 20)), [0x44, 0x4B, 0x6F, 203], 'non-keyed bottle detail remains untouched');

console.log('ok: throwing flask Afflict/non-Afflict colors and dual-key recolor');
