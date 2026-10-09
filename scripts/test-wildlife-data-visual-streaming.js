'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const game = fs.readFileSync('docs/game.js', 'utf8');
let builds = 0, releases = 0, now = 0;
class Group {
  constructor() { this.children = []; this.visible = true; this.position = { set() {} }; this.scale = { set() {} }; }
}
const context = {
  THREE: { Group }, TILE: 32, currentArea: 'cliffs', scene: { remove() {} },
  performance: { now: () => now }, Math,
  CREATURE_DB: { herd: { modelWidth: 2, sprites: { idle: 'herd.png' }, maxHealth: 40, maxStamina: 50 } },
  window: {
    SCRATCHBONES_CONFIG: { game: { wildlifeStreaming: { wakeRadiusTiles: 14, releaseRadiusTiles: 18, releaseDelaySeconds: 2, promotionsPerFrame: 1 } } },
    GridTileAccessors: { getActiveScene: () => ({ add() {} }), getActiveGrid: () => [[]], getActiveCols: () => 80, getActiveRows: () => 80 },
    FormatUtils: { clamp: (v, min, max) => Math.max(min, Math.min(max, v)) },
    EntityDistanceLod: { isFar: (hidden, distance, wake, release) => hidden ? distance > wake : distance >= release },
    CreatureGenetics: { creatureSizeScale: () => ({ x: 1, y: 1 }), creatureGroundOffset: () => null, applyCreatureBillboardScale() {}, SPECIES_ALIAS: {} },
    CreatureGeneticsRender: { SPECIES: {} },
    PNGPlaneAvatar: { buildAnimalPlaneAvatarModel() { builds++; const group = new Group(); group.children = [{ position: {}, material: {} }, { position: {}, material: {} }]; return { group, dispose() { releases++; } }; } },
  },
  makeCharacterGroundShadow: () => new Group(), creatureGroundShadowRadii: () => ({ radiusX: 1, radiusZ: 1 }),
  tileSurfaceYInArea: () => 0, characterGroundShadowSurfaceOffset: () => 0, _markPngPlane() {},
  resolveCreatureGroundAnchorRatio: (_url, fn) => fn(1), creaturePlaneGroundOffset: () => 0,
  disposeCreaturePresentation: c => c.avatarRef.dispose(), localStorage: { getItem: () => null, setItem() {} },
};
const start = game.indexOf('      function makeCreatureEntity('), end = game.indexOf('      function despawnCreature(', start);
vm.runInNewContext(game.slice(start, end) + '\nthis.make = makeCreatureEntity; this.promote = createCreatureVisuals; this.retire = releaseCreatureVisuals;', context);
vm.runInNewContext(fs.readFileSync('docs/js/wildlife-visual-lod.js', 'utf8'), context);
const lod = context.window.WildlifeVisualLod;
lod.init({ createVisuals: context.promote, releaseVisuals: context.retire });
const animals = Array.from({ length: 24 }, (_, i) => context.make('herd', 100 + i, 100, { streamVisuals: true, genotype: { original: i } }));
assert.equal(builds, 0, 'entering the zone tracks 24 adults without allocating 24 full rigs');
const original = animals[0], genes = original.genotype, id = original.id;
original.health = 19;
lod.beginFrame();
assert.equal(lod.update(original, 10), false);
assert.equal(lod.update(animals[1], 10), true, 'the second calm promotion waits for the next frame');
assert.equal(builds, 1);
lod.beginFrame();
assert.equal(lod.update(animals[1], 10), false);
assert.equal(lod.update(original, 16), false, 'release hysteresis keeps a live actor stable beyond its wake radius');
assert.equal(lod.update(original, 20), true);
now = 2100;
lod.update(original, 20);
assert.equal(original._wildlifeVisualsReleased, true);
assert.equal(releases, 1);
assert.equal(original.health, 19);
assert.equal(original.genotype, genes);
assert.equal(original.id, id, 'retirement never rerolls identity or population data');
lod.beginFrame(); lod.update(original, 10);
assert.equal(original._wildlifeVisualsReleased, false);
assert.equal(builds, 3);
const fighter = animals[2]; fighter.state = 'chase';
assert.equal(lod.update(fighter, 60), false, 'active combat wakes immediately even after the frame promotion budget is spent');
assert.equal(lod.setWakeRadius(32), true);
assert.equal(lod.wakeRadius(), 32);
assert.equal(lod.releaseRadius(), 36);
assert.equal(lod.setWakeRadius(NaN), false);
assert.equal(lod.setWakeRadius(0), false);
context.retire(animals[1]);
assert.equal(animals[1]._wildlifeVisualsReleased, true, 'area exit can retire live visuals without removing the logical animal');
console.log('Data-only herd entry, bounded promotions, hysteresis, retained identity, and immediate combat wake passed.');
