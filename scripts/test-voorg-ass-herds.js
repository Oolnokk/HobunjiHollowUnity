#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.HOBUNJI_TEST_ROOT || process.cwd(); // Used by CI and local runs to resolve the checked-out branch.
const wildlifeSource = fs.readFileSync(path.join(ROOT, 'docs/js/wildlife-spawn.js'), 'utf8');
const gameSource = fs.readFileSync(path.join(ROOT, 'docs/game.js'), 'utf8');

assert.match(gameSource, /roamingHerdSpecies:\s*\['voorg-ass'\]/, 'Northern Cliffs config authors Voorg-Ass as roaming-herd wildlife');
assert.match(gameSource, /roamingHerdCount:\s*2/, 'Northern Cliffs config authors two roaming herd slots');
assert.match(gameSource, /c\.herdKey\s*&&\s*herdNight[\s\S]*?_animalSleeping\s*=\s*true/, 'game AI beds open-air herd members down at night');
assert.match(gameSource, /carriedBabyItemKey[\s\S]*?inventory\[carriedBabyKey\]/, 'Herd-Mother babies are recovered only through corpse looting');
assert.match(gameSource, /!c\._animalSleeping[\s\S]*?c\.state !== 'return'/, 'sleeping herd members do not keep tracking the player with awake look-at behavior');

class Group {
  constructor() {
    this.children = [];
    this.userData = {};
    this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
    this.rotation = { y: 0 };
    this.scale = { x: 1, y: 1, z: 1, set: (x, y, z) => { this.scale.x = x; this.scale.y = y; this.scale.z = z; } };
  }
  add(...children) { this.children.push(...children); for (const child of children) if (child) child.parent = this; }
}
const plane = () => ({ clone: plane, material: { map: null } });

const logs = [];
const hostiles = new Set();
const zoneId = 'map_northern_cliffs';
const zoneLayout = {
  cols: 80,
  rows: 50,
  dens: [],
  foliagePatches: [
    { id: 'north-a', centroid: { x: 18, y: 20 }, tiles: Array.from({ length: 16 }, (_, i) => ({ x: 15 + (i % 4), y: 18 + Math.floor(i / 4) })) },
    { id: 'north-b', centroid: { x: 58, y: 27 }, tiles: Array.from({ length: 16 }, (_, i) => ({ x: 55 + (i % 4), y: 25 + Math.floor(i / 4) })) },
  ],
  tiles: [],
};
// Deliberately starts WITHOUT Voorg-Ass defs. This mirrors the real parser-time
// failure that originally produced configured herd slots but zero live animals:
// CreatureGenetics' deferred DOMContentLoaded wrapper had not populated the
// live CREATURE_DB yet when WildlifeSpawn.init ran.
const creatureDb = {
  drenkirra: {
    label: 'Drenkirra',
    hostile: false,
    defaultSizeClass: 'medium',
    modelWidth: 1.5,
    spriteAspect: 600 / 1375,
    maxHealth: 100,
    maxStamina: 100,
    sprites: { idle: 'drenkirra_idle.png', run: ['drenkirra_run1.png', 'drenkirra_run2.png'] },
  },
};

let rngState = 0x51a77; // Deterministic but non-constant so herd size/formation paths get realistic variation.
function rnd() {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
}

const windowStub = {
  THREE: { Group },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: {
    creatures: {
      'voorg-ass': {
        anchors: { saddle: { position: { x: -0.0017, y: 0.1229, z: 0.0438 } } },
      },
    },
  },
  CreatureGenetics: {
    makeDefaultGenotype() { return { sizeClass: 'medium', base: { color: '#777', copies: 2, inheritance: 'dominant' }, belly: { enabled: true } }; },
    creatureSizeScale(kind, sizeClass) {
      assert.equal(kind, 'voorg-ass');
      return sizeClass === 'small' ? { x: 0.27, y: 0.27 } : { x: 0.97, y: 0.97 };
    },
  },
  CreatureGeneticsRender: { SPECIES: {} },
  WildernessMapGenerator: {
    makeRng(seed) {
      let h = 2166136261;
      for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
      return () => ((h = (Math.imul(h, 1664525) + 1013904223) >>> 0) / 0x100000000);
    },
  },
  BanditCamps: { ensureCurrentZoneCamps() {} },
  ClimbSystem: { debugBranchesFor() { return []; } },
  __farmLog(message, channel) { logs.push({ message, channel }); },
};

function makeCreatureEntity(creatureKey, x, y, opts) {
  if (!creatureDb[creatureKey]) return null; // Matches real game.js: unknown CREATURE_DB species cannot spawn.
  const group = new Group();
  const frontPlane = plane();
  const backPlane = plane();
  group.add(frontPlane, backPlane);
  return {
    id: creatureKey + '_' + (hostiles.size + 1),
    creatureKey,
    def: creatureDb[creatureKey],
    health: 100,
    maxHealth: 100,
    x, y,
    areaId: zoneId,
    avatarRef: { group, frontPlane, backPlane },
    ...opts,
  };
}

const deps = {
  CREATURE_DB: creatureDb,
  EXTERIOR_ZONES: {
    [zoneId]: {
      packSpecies: ['grehlr'],
      herbivoreSpecies: [],
      roamingHerdSpecies: ['voorg-ass'],
      roamingHerdCount: 2,
      cols: 80,
      rows: 50,
    },
  },
  DEN_MOTHER_DEFS: { grehlr: { creatureKey: 'grehlr-den-mother', nestItemKey: 'grehlrBaby' } },
  TILE: 32,
  TileType: { RIVER: 'river', STREAM: 'stream' },
  zoneLayouts: new Map([[zoneId, zoneLayout]]),
  hostileObjects: hostiles,
  denNests: new Map(),
  buildingScenes: new Map(),
  rnd,
  makeCreatureEntity,
  getCurrentArea: () => zoneId,
  getCutscenePreviewActive: () => false,
  _isZoneArea: id => id === zoneId,
  buildZoneScene: () => true,
  showToast() {},
};

const context = vm.createContext({ window: windowStub, console, Math, Map, Set, performance: { now: () => 0 } });
vm.runInContext(wildlifeSource, context, { filename: 'wildlife-spawn.js' });
windowStub.WildlifeSpawn.init(deps);
assert.equal(creatureDb['voorg-ass']?.label, 'Voorg-Ass', 'WildlifeSpawn.init synchronously installs the missing live Voorg-Ass creature def');
assert.equal(creatureDb['voorg-ass']?.defaultSizeClass, 'large');
assert.equal(creatureDb['voorg-ass-herd-mother']?.label, 'Herd-Mother', 'WildlifeSpawn.init synchronously installs the missing Herd-Mother variant');
assert.equal(creatureDb['voorg-ass-herd-mother']?.defaultSizeClass, 'large');
assert(windowStub.CreatureGeneticsRender.SPECIES['voorg-ass'], 'WildlifeSpawn.init makes Voorg-Ass genotype rendering available before DOMContentLoaded');
assert.deepEqual(deps.EXTERIOR_ZONES[zoneId].roamingHerdSpecies, ['voorg-ass']);
assert.equal(deps.EXTERIOR_ZONES[zoneId].roamingHerdCount, 2);
windowStub.WildlifeSpawn.updateHostileSpawning(3);

const living = [...hostiles].filter(c => c.health > 0);
assert(living.length >= 16 && living.length <= 24, 'two large herds spawn 8-12 adults each');
const herdKeys = new Set(living.map(c => c.herdKey));
assert.equal(herdKeys.size, 2, 'Northern Cliffs maintain two independently keyed herds');

for (const herdKey of herdKeys) {
  const herd = living.filter(c => c.herdKey === herdKey);
  assert(herd.length >= 8 && herd.length <= 12, 'each roaming herd has 8-12 adults');
  assert(herd.every(c => c.genotype?.sizeClass === 'large'), 'every wild herd adult is forced to Large size');
  assert(herd.every(c => c.wanderRadiusPx === 32 * 7), 'herd members receive the broad open-air wander radius');
  const mothers = herd.filter(c => c.isHerdMother);
  assert.equal(mothers.length, 1, 'each herd has exactly one Herd-Mother');
  const mother = mothers[0];
  assert.equal(mother.creatureKey, 'voorg-ass-herd-mother');
  assert.equal(mother.herdMotherLabel, 'Herd-Mother');
  assert.equal(mother.carriedBabyItemKey, 'voorgAssBaby');
  assert(mother.carriedBabyCount >= 2 && mother.carriedBabyCount <= 4, 'Herd-Mother carries 2-4 babies');
  assert.equal(mother._carriedBabyVisuals.length, mother.carriedBabyCount, 'every carried baby has a saddle-cluster visual');
  assert(mother._carriedBabyVisuals.every(group => group.parent === mother.avatarRef.group), 'baby visuals are parented to the mother rather than spawned as takeable world objects');
}

const census = windowStub.WildlifeSpawn.roamingHerdCensus(zoneId);
assert.equal(census.configuredHerds, 2);
assert.equal(census.herds.length, 2);
assert(census.herds.every(h => h.mothers === 1 && h.carriedBabies >= 2), 'mobile/debug census exposes Herd-Mothers and carried babies');

const firstKey = [...herdKeys][0];
const firstHerd = [...hostiles].filter(c => c.herdKey === firstKey);
hostiles.delete(firstHerd[0]);
windowStub.WildlifeSpawn.updateHostileSpawning(3);
assert.equal([...hostiles].filter(c => c.herdKey === firstKey).length, firstHerd.length - 1, 'a partially depleted herd does not refill immediately');

for (const c of [...hostiles]) if (c.herdKey === firstKey) hostiles.delete(c);
windowStub.WildlifeSpawn.updateHostileSpawning(3);
assert.equal([...hostiles].filter(c => c.herdKey === firstKey).length, 0, 'a wiped herd waits for the next-day respawn gate');
windowStub.WildlifeSpawn.clearPendingDenRespawn();
windowStub.WildlifeSpawn.updateHostileSpawning(3);
assert([...hostiles].filter(c => c.herdKey === firstKey).length >= 8, 'next-day wildlife reset allows the wiped herd slot to repopulate');

assert(logs.some(entry => /\[voorg-ass\] spawned roaming herd/.test(entry.message)), 'mobile-visible wildlife log reports roaming-herd spawn details');

console.log('PASS Voorg-Ass large roaming herds, Herd-Mother carriers, corpse-only young, and herd respawn behavior');
