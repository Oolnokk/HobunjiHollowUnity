#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Assertions report exact import regressions.
const fs = require('node:fs'); // Loads committed creature and runtime sources.
const path = require('node:path'); // Resolves creature sprite paths under docs/.

const readSource = file => fs.readFileSync(file, 'utf8'); // Keeps tests independent of browser storage.
const extractFrozenJson = (source, name) => {
  const marker = `const ${name} = Object.freeze(`; // Finds the committed JSON literal inside the renderer.
  const start = source.indexOf(marker);
  assert(start >= 0, `${name} must exist in the source`);
  const from = start + marker.length;
  const end = source.indexOf(');', from);
  assert(end > from, `${name} must close its Object.freeze expression`);
  return JSON.parse(source.slice(from, end));
};

const bestiary = JSON.parse(readSource('docs/config/creatures/hobunji-creature-bestiary.json')); // Creature schema source.
const nelks = bestiary.creatures.filter(creature => creature.id === 'nelk'); // Must contain one Nelk.
assert.equal(nelks.length, 1, 'bestiary must register exactly one Nelk');
const nelk = nelks[0]; // Reference export used for head-rig synchronization checks.
const active = extractFrozenJson(readSource('docs/js/creature-genetics-render.js'), 'ANIMAL_HEAD_RIGS'); // Game-loaded renderer rigs.
const authored = extractFrozenJson(readSource('docs/js/animal-head-rig-authored.js'), 'EXPORTED_HEAD_RIGS'); // Painter-export fallback table.
const index = readSource('docs/index.html'); // Confirms the active renderer is loaded by the game.

assert.equal(nelk.label, 'Nelk');
assert.equal(nelk.hostile, false);
assert.equal(nelk.diet, 'herbivore');
assert.equal(nelk.modelWidth, 0.89);
assert.equal(nelk.spriteAspect, 0.65625);
assert.deepEqual(nelk.attacks, ['pounce']);
assert.equal(nelk.attackTag, 'blunt');
assert.deepEqual(nelk.headRig.pivot, { x: 0.3137449623414376, y: 0.4315545387068126 });
assert.equal(nelk.headRig.coordinateSpace, 'sprite-normalized-top-left');
assert.equal(nelk.headRig.enabled, true);
assert.equal(nelk.headRig.minDeg, -30);
assert.equal(nelk.headRig.maxDeg, 30);
assert.equal(nelk.headRig.restDeg, 0);
assert.equal(nelk.headRig.turnSpeedDeg, 120);
assert.equal(nelk.headRig.meshResolution, 48);

for (const sprite of [nelk.sprites.idle, ...nelk.sprites.run]) {
  assert(fs.existsSync(path.join('docs', sprite)), `Nelk sprite missing: ${sprite}`);
}
for (const [mapName, expectedRuns, firstCount] of [
  ['weightMap', 185, 160],
  ['compressibilityMap', 370, 4289],
  ['stretchabilityMap', 359, 3753],
]) {
  const map = nelk.headRig[mapName]; // Each compressed paint channel shares the same dimensions.
  assert.equal(map.width, 128);
  assert.equal(map.height, 84);
  assert.equal(map.encoding, 'rle-u9');
  assert.equal(map.unsetValue, 256);
  assert.equal(map.data.length, expectedRuns * 2, `${mapName} run count`);
  assert.equal(map.data[0], firstCount, `${mapName} must begin with the exported paint`);
  let decodedPixels = 0; // Verifies the entire RLE stream covers exactly the authored image.
  for (let i = 0; i < map.data.length; i += 2) {
    const [count, value] = [map.data[i], map.data[i + 1]]; // One run's decoded width and paint value.
    assert(Number.isSafeInteger(count) && count > 0, `${mapName}: invalid count at ${i}`);
    assert(Number.isSafeInteger(value) && value >= 0 && value <= 256,
      `${mapName}: invalid value at ${i + 1}`);
    decodedPixels += count;
  }
  assert.equal(decodedPixels, 128 * 84, `${mapName} must decode without gaps or overflow`);
}

assert.deepEqual(active.nelk, nelk.headRig, 'actual game renderer must use the authored Nelk rig');
assert.deepEqual(authored.nelk, nelk.headRig, 'painter-export table must match the bestiary');
assert.match(index, /js\/creature-genetics-render\.js\?v=[A-Za-z0-9_-]+/,
  'the published game must load the refreshed renderer rather than a cached version');
assert(index.indexOf('js/creature-genetics-render.js') < index.indexOf('game.js?v='),
  'creature rig must be registered before game startup');
console.log('Nelk head rig: creature, assets, active renderer, painter export, and RLE maps verified.');
