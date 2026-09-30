'use strict';
const assert = require('node:assert/strict'); // Exercises real effect calculations and persistence isolation.
const fs = require('node:fs'); // Loads production progression.
const vm = require('node:vm'); // Supplies a deterministic weapon and saved build.
let spent = 0; // A preview must never call the mote-spending boundary.
const window = { Combat: { deps: { toolMasteryLevel: () => 5, weaponDamageTypeForTool: () => 'sharp', spendMotesOfProwess: () => { spent++; return true; } } }, __hobunjiPlayerProfile: { abilityProgression: { axe: { swingCombo: { 1: 0, 2: 0, 3: 0 } } } } }; // Existing choices should survive every comparison.
vm.runInNewContext(fs.readFileSync('docs/js/combat/combat-progression.js', 'utf8'), { window, document: { addEventListener() {} }, localStorage: { getItem: () => null } });
const api = window.CombatProgression; // Production preview API consumed by training.
const savedEffects = JSON.stringify(api.getEffects('axe', 'swingCombo')); // Baseline includes three permanently selected ranks.
const savedChoice = api.getChosenOption('axe', 'swingCombo', 2); // Permanent option must stay unchanged during the preview.
const handle = api.beginPreview('axe', 'swingCombo', 2, 1); // Compare Extended Reach against the saved Deeper Cut.
assert.ok(handle);
assert.equal(api.getEffects('axe', 'swingCombo').stats.rangeMul, 0.12);
assert.equal(api.getEffects('axe', 'swingCombo').afflictions.bleedingHealth, 0.5, 'earlier rank is retained; replaced and later rows do not stack into the trial');
assert.equal(api.getChosenOption('axe', 'swingCombo', 2), savedChoice);
assert.equal(api.choose('axe', 'swingCombo', 2, 1), false);
assert.equal(spent, 0);
assert.equal(api.beginPreview('axe', 'swingCombo', 6, 0), null);
api.endPreview({});
assert.equal(api.getEffects('axe', 'swingCombo').stats.rangeMul, 0.12, 'only the owning handle can clear this preview');
api.endPreview(handle);
assert.equal(JSON.stringify(api.getEffects('axe', 'swingCombo')), savedEffects);
console.log('Mastery preview: actual effects, earlier-row baseline, persistence isolation, validity and owned cleanup passed.');
