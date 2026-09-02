#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const config = JSON.parse(fs.readFileSync('docs/config/town-mine.json', 'utf8'));
const generatedSeeds = [];
const floor = [];
for (let row = 1; row <= 9; row++) for (let col = 1; col <= 9; col++) floor.push([col, row]);
const context = {
  console,
  Date,
  Math,
  setTimeout,
  fetch: async () => ({ ok: true, json: async () => config }),
  window: {
    WildernessMapGenerator: { makeRng: () => () => 0.41 },
    CavernGenerator: {
      generateCavernFloor(seed) {
        generatedSeeds.push(seed);
        return { cols: 11, rows: 11, floor, exitTiles: [[4, 9], [5, 9], [6, 9]], exitCol: 5, exitRow: 8, mesh: {} };
      },
    },
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/town-mine.js', 'utf8'), context);

(async () => {
  const mine = context.window.TownMine;
  const first = await mine.synthesizeFloorMapData(mine.mapIdForFloor(1));
  const floorTwoA = await mine.synthesizeFloorMapData(mine.mapIdForFloor(2));
  const floorTwoB = await mine.synthesizeFloorMapData(mine.mapIdForFloor(2));
  assert.strictEqual(first.exits.length, 1, 'Floor 1 should retain its return ladder');
  assert.ok(first.mineReturnLadder, 'Floor 1 should render the ladder mesh');
  assert.strictEqual(floorTwoA.exits.length, 0, 'Ordinary deeper floors should not have an upward exit');
  assert.strictEqual(floorTwoA.descentRock, undefined, 'No rock should be preselected as the descent');
  assert.ok(floorTwoA.oreRocks.every(rock => !rock.hiddenDescent), 'Rocks should use runtime descent rolls');
  assert.notStrictEqual(generatedSeeds[1], generatedSeeds[2], 'Each visit should use a fresh generation seed');
  assert.ok(floorTwoB, 'A repeat visit should synthesize a complete replacement floor');

  mine.restore({ deepestFloor: 10, unlockedShortcutTiers: [1], townValue: 1 });
  const shortcutFloor = await mine.synthesizeFloorMapData(mine.mapIdForFloor(11));
  assert.strictEqual(shortcutFloor.exits.length, 0, 'A shortcut destination should not provide a return exit');
  assert.strictEqual(shortcutFloor.mineReturnLadder, null, 'Shortcut destinations should rely on the utility-menu escape');
  const finalFloor = await mine.synthesizeFloorMapData(mine.mapIdForFloor(100));
  assert.strictEqual(finalFloor.mineCanDescend, false, 'Floor 100 should not roll another descent');

  const perkContext = { window: { SkillSystem: { MAX_LEVEL: 20, level: () => 20 } }, document: { getElementById: () => null }, console };
  vm.createContext(perkContext);
  vm.runInContext(fs.readFileSync('docs/js/perk-system.js', 'utf8'), perkContext);
  const miningPerks = perkContext.window.PerkSystem.TREES.mining;
  assert.ok(miningPerks.some(perk => perk.id === 'weakRockSense'));
  assert.ok(miningPerks.some(perk => perk.id === 'collapsingBlows'));
  console.log('Town mine descent/regeneration checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
