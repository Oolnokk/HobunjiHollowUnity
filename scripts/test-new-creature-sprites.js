#!/usr/bin/env node
'use strict';

// Regression for the reusable four-way creature-eye mode, Nelk tail/cape overlay,
// Uumkao'ii shell migration, and intentionally normal mounted Nazgraku frames.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = file => fs.readFileSync(file, 'utf8');

const present = new Set([...fs.readdirSync('docs/assets/creaturesprites'),
  ...fs.readdirSync('docs/assets/creaturesprites/patterns')]); // Verifies authored sprite names without browser DevTools.
const required = [
  "uumkao'ii_idle.png", "uumkao'ii_run1.png", "uumkao'ii_run2.png",
  'uum_shell_idle.png', 'uum_shell_run1.png', 'uum_shell_run2.png',
  'nelk_eye-A.png', 'nelk_eye-B.png', 'nelk_eye-C.png', 'nelk_eye-D.png',
  'nelk_brushtail-caped_idle.png', 'nelk_brushtail-caped_run1.png', 'nelk_brushtail-caped_run2.png',
  'nazgraku_idle.png', 'nazgraku_run1.png', 'nazgraku_run2.png',
]; // Run all required PNG existence checks in the same test.
for (const name of required) assert(present.has(name), 'Missing uploaded creature PNG: ' + name);

const context = {
  document: { currentScript: null, readyState: 'complete' },
  window: {
    SCRATCHBONES_CONFIG: { game: { animalBlink: { minIntervalMs: 10, maxIntervalMs: 10, durationMs: 2 },
      creatureGenetics: { palettes: { default: [
        { id: 'light', name: 'Light', hex: '#aabbcc', weight: 1 },
        { id: 'dark', name: 'Dark', hex: '#445566', weight: 1 },
      ] } }, livestock: {}, wildlife: {} } },
    addEventListener() {},
    __farmLog() {},
  },
  localStorage: { getItem: () => null },
  performance: { now: () => 0 },
  Math: Object.create(Math),
};
context.Math.random = () => 0; // Deterministic next-eye direction for each simulated blink.
vm.createContext(context);
vm.runInContext(read('docs/js/creature-genetics-render.js'), context, { filename: 'creature-genetics-render.js' });
vm.runInContext(read('docs/js/creature-genetics.js'), context, { filename: 'creature-genetics.js' });
vm.runInContext(read('docs/js/creature-blink.js'), context, { filename: 'creature-blink.js' });

const render = context.window.CreatureGeneticsRender;
const genetics = context.window.CreatureGenetics;
const blink = context.window.CreatureBlink;
assert.equal(render.SPECIES.nelk.eyes.mode, 'cycle');
assert.equal(render.SPECIES.uumkaoii.patterns.join(','), 'shell');
assert.equal(render.SPECIES.uumkaoii.base.run1, "assets/creaturesprites/uumkao'ii_run1.png");
assert.equal(render.SPECIES.nazgraku.base.run2, 'assets/creaturesprites/nazgraku_run2.png');
assert.equal(render.eyeStateKey('C'), 'eye-C');
assert.equal(render.eyeStateKey(true), 'b');
assert.equal(render.eyeStateKey(false), 'o');
assert.equal(render.eyeStatesForKind('nelk').join(','), 'A,B,C,D');

const patterns = { brushtail: { enabled: true, copies: 2, color: '#445566' },
  cape: { enabled: true, copies: 1, color: '#aabbcc' } };
assert.equal(render.patternUrl('nelk', 'brushtail', 'run2', patterns),
  'assets/creaturesprites/nelk_brushtail-caped_run2.png');
assert.equal(render.patternUrl('nelk', 'cape', 'run2', patterns),
  'assets/creaturesprites/nelk_cape_run2.png');
assert.equal(render.patternUrl('nelk', 'brushtail', 'run2', { ...patterns, cape: { ...patterns.cape, enabled: false } }),
  'assets/creaturesprites/nelk_brushtail_run2.png');

const creature = {};
assert.equal(blink.getVisualState(creature, 'nelk', 0), 'A');
assert.equal(blink.getVisualState(creature, 'nelk', 9), 'A');
assert.equal(blink.getVisualState(creature, 'nelk', 10), 'B');
assert.equal(blink.getVisualState(creature, 'nelk', 11), 'B');
assert.equal(blink.getVisualState(creature, 'nelk', 22), 'C');
assert.equal(blink.getVisualState(creature, 'nelk', 34), 'D');
assert.equal(typeof blink.getVisualState({}, 'gar-wolf', 0), 'boolean',
  'ordinary open/shut blinking must remain a boolean');

genetics.init({ CREATURE_DB: { uumkaoii: { defaultSizeClass: 'large' },
  nelk: { defaultSizeClass: 'medium' }, nazgraku: { defaultSizeClass: 'large' } },
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)) });
const fresh = genetics.makeDefaultGenotype('uumkaoii');
assert(fresh.base?.color);
assert(fresh.shell?.color);
assert.equal(fresh.shell.enabled, true);
assert.equal(fresh.shell.copies, 2);
assert.equal('fur' in fresh, false);
assert.equal('plates' in fresh, false);
const former = { fur: { color: '#aabbcc', copies: 2 }, plates: { color: '#445566', copies: 2 } };
assert.equal(genetics.normalizeLegacyGenotype('uumkaoii', former).shell.color, '#445566');
assert.equal(genetics.genotypeTraits('uumkaoii', former).patterns.length, 1);
assert.equal(genetics.crossOffspring(former, former, 'uumkaoii', 0).shell.enabled, true);
assert.equal(genetics.makeDefaultGenotype('nelk').base != null, true);
assert.equal(genetics.makeDefaultGenotype('nazgraku').base != null, true);

// The game's normal portrait URLs are retained for Nazgraku riding, not the
// separate mounted sprite files that lack whiskers.
const game = read('docs/game.js');
assert(game.includes("sprites: { idle: 'assets/creaturesprites/nazgraku_idle.png'"),
  'Nazgraku mounted source must stay on the regular whiskered portrait');
assert(game.includes("typeof blinkShut === 'string' ? ':eye-'"),
  'wild creature readiness keys include four-way eye pose');
assert(game.includes('window.CreatureGeneticsRender.eyeStatesForKind(kind)'),
  'cutscene preloader enumerates every supported eye state');

// The bestiary/editor and synchronous renderer must share the same authored Nazgraku rig.
const nazgrakuRig = JSON.parse(read('docs/config/creatures/hobunji-creature-bestiary.json'))
  .creatures.find(creature => creature.id === 'nazgraku')?.headRig; // Authored head rig shared by gameplay and editor.
assert(nazgrakuRig?.enabled, 'Nazgraku must have its authored head rig enabled');
assert.deepEqual(JSON.parse(JSON.stringify(render.ANIMAL_HEAD_RIGS.nazgraku)), nazgrakuRig,
  'Nazgraku runtime head rig must match its bestiary authoring data');
assert.equal(nazgrakuRig.pivot.x, 0.421875);
assert.equal(nazgrakuRig.pivot.y, 0.42592592592592593);
for (const channel of ['weightMap', 'compressibilityMap', 'stretchabilityMap']) {
  const grid = nazgrakuRig[channel]; // Checks each author-painted channel covers its declared grid.
  assert.equal(grid.encoding, 'rle-u9');
  assert.equal(grid.data.length % 2, 0, channel + ': runs must have paired count/value entries');
  assert.equal(grid.data.filter((_, index) => !(index % 2)).reduce((sum, count) => sum + count, 0),
    grid.width * grid.height, channel + ': RLE data must fill the complete grid');
  assert(grid.data.every((value, index) => Number.isInteger(value) && value >= 0
    && (index % 2 === 0 ? value > 0 : value <= 256)), channel + ': invalid RLE values');
}

console.log('creature new sprite integration: all regression checks passed');
