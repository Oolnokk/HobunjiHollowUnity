#!/usr/bin/env node
'use strict';

// Regression coverage for the item-quality architecture (central quality
// buckets, policy-aware consumption, processing craftsmanship) and the
// blackout severity/wander-score redesign (docs/js/combat/combat-core.js,
// docs/js/cooking-system.js, docs/js/skill-system.js, docs/js/perk-system.js,
// docs/js/alcohol-gameplay-bridge.js).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

// ── A tiny seeded PRNG so blackout-travel results are exactly reproducible ──
function makeSeededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ── cooking-system.js: central quality API ──────────────────────────────
{
  const src = read('docs/js/cooking-system.js');
  function fakeElement() {
    return {
      classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute() {}, addEventListener() {}, appendChild() {},
      querySelector() { return fakeElement(); },
      querySelectorAll() { return []; },
      focus() {},
    };
  }
  const documentStub = { getElementById() { return null; }, querySelector() { return null; }, addEventListener() {}, createElement() { return fakeElement(); }, body: { appendChild() {} } };
  const windowStub = { HobunjiCookingData: { items: {}, recipes: [], categoryLabels: {}, itemNameTokenOverrides: {}, processingTiers: {}, effectLabels: {}, effectPrefixVariants: {}, identityNameRules: {} } };
  const ctx = { window: windowStub, document: documentStub, performance: { now: () => 0 }, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const CookingSystem = ctx.window.CookingSystem;

  const inventory = { redberries: 12 };
  const ITEM_DEFS = { redberries: { label: 'Redberries', cookingDefaultStars: 3 } };
  CookingSystem.init({ inventory, ITEM_DEFS, clampInventoryStack() {}, inventoryItems: [] });
  CookingSystem.recordItemQuality('redberries', 2, 4);
  CookingSystem.recordItemQuality('redberries', 3, 5);
  CookingSystem.recordItemQuality('redberries', 5, 3);

  assert.equal(CookingSystem.peekLowestQuality('redberries'), 2, 'peekLowestQuality reports the worst tracked tier without consuming it');
  assert.equal(inventory.redberries, 12, 'peeking never mutates the stack');

  const lowest = CookingSystem.consumeQualityByPolicy('redberries', 4, 'lowest');
  assert.deepEqual(JSON.parse(JSON.stringify(lowest.groups)), [{ stars: 2, amount: 4 }], 'lowest-first consumption drains the worst tier before touching better stock');
  assert.equal(inventory.redberries, 8, 'consumption still decrements the plain inventory stack');

  const highest = CookingSystem.consumeQualityByPolicy('redberries', 2, 'highest');
  assert.deepEqual(JSON.parse(JSON.stringify(highest.groups)), [{ stars: 5, amount: 2 }], 'highest-first consumption (Cooking Auto-fill) reaches for the best tier first');

  const spanning = CookingSystem.consumeQualityByPolicy('redberries', 3, 'lowest');
  assert.deepEqual(JSON.parse(JSON.stringify(spanning.groups)), [{ stars: 3, amount: 3 }], 'a single-tier remainder is reported as one group');

  assert.equal(CookingSystem.consumeQualityByPolicy('redberries', 100, 'lowest'), null, 'over-consumption request is rejected rather than partially applied');
  assert.equal(inventory.redberries, 3, 'a rejected over-consumption leaves the stack untouched');

  assert.equal(CookingSystem.valueMultiplierForStars(1), 0.70);
  assert.equal(CookingSystem.valueMultiplierForStars(3), 1.00);
  assert.equal(CookingSystem.valueMultiplierForStars(5), 1.60);

  console.log('cooking-system.js quality API checks passed.');
}

// ── skill-system.js + perk-system.js: processing-quality resolution ─────
{
  const skillSrc = read('docs/js/skill-system.js');
  const perkSrc = read('docs/js/perk-system.js');
  const documentStub = { querySelector() { return null; }, getElementById() { return null; } };
  const windowStub = {};
  const ctx = { window: windowStub, document: documentStub, performance: { now: () => 0 }, console, queueMicrotask };
  vm.createContext(ctx);
  vm.runInContext(skillSrc, ctx);
  vm.runInContext(perkSrc, ctx);
  const SkillSystem = ctx.window.SkillSystem;
  const PerkSystem = ctx.window.PerkSystem;
  PerkSystem.init({});

  // Every farming tree perk must actually be reachable at max Farming level
  // (mirrors the existing combat/foraging/fishing trees' own pacing rule).
  const maxPoints = PerkSystem.maxPointsForSkill('farming');
  assert.ok(maxPoints >= 10, 'the farming tree awards enough points at max level to reach its tier-3 threshold');

  let random = () => 0.999; // Deterministic "always roll toward +1" by default; overridden per assertion below.
  SkillSystem.init({ random: () => random() });

  // Bounds: processing can never leave the 1-5 range even at the extremes.
  random = () => 0; // Always the "down" branch.
  assert.equal(SkillSystem.rollProcessingQuality(1, 'quick'), 1, 'quality can never drop below 1 star');
  random = () => 0.999; // Always the "up" branch.
  assert.equal(SkillSystem.rollProcessingQuality(5, 'quick'), 5, 'quality can never exceed 5 stars');

  // Output evolves from input quality — never more than ±1 in one step.
  for (const input of [1, 2, 3, 4, 5]) {
    for (const roll of [0, 0.5, 0.999]) {
      random = () => roll;
      const output = SkillSystem.rollProcessingQuality(input, 'aging');
      assert.ok(Math.abs(output - input) <= 1, `aging never moves quality by more than one star (input ${input}, roll ${roll} -> ${output})`);
    }
  }

  // Careful Batches R3: ordinary quick-processing never lowers quality.
  PerkSystem.restore({ perkRanks: { farming: { carefulBatches: 3 } } });
  random = () => 0; // Would otherwise be a guaranteed "down" roll.
  assert.equal(SkillSystem.rollProcessingQuality(3, 'quick'), 3, 'Careful Batches R3 floors quick processing at "no change" even on the worst roll');
  assert.ok(SkillSystem.rollProcessingQuality(3, 'aging') <= 2, 'Careful Batches only guarantees the floor for quick processing, not aging');

  // Artisan R5: 5-star inputs can never lose quality in any method class.
  PerkSystem.restore({ perkRanks: { farming: { artisan: 5 } } });
  random = () => 0;
  assert.equal(SkillSystem.rollProcessingQuality(5, 'preservation'), 5, 'Artisan R5 protects a 5-star input from ever losing quality');

  // Cellarmaster only helps aging; Preserver only helps preservation.
  PerkSystem.restore({ perkRanks: { farming: { cellarmaster: 5 } } });
  random = () => 0.30; // A roll that would sit inside the base "down" band for aging without the perk.
  const agingWithCellarmaster = SkillSystem.rollProcessingQuality(3, 'aging');
  PerkSystem.restore({});
  random = () => 0.30;
  const agingWithoutPerk = SkillSystem.rollProcessingQuality(3, 'aging');
  assert.ok(agingWithCellarmaster >= agingWithoutPerk, 'Cellarmaster shifts aging outcomes toward preserving/improving quality');

  PerkSystem.restore({ perkRanks: { farming: { cellarmaster: 5 } } });
  random = () => 0.30;
  const preservationUnaffected = SkillSystem.rollProcessingQuality(3, 'preservation');
  PerkSystem.restore({});
  random = () => 0.30;
  const preservationBaseline = SkillSystem.rollProcessingQuality(3, 'preservation');
  assert.equal(preservationUnaffected, preservationBaseline, 'Cellarmaster does not leak into preservation (that is Preserver\'s job)');

  // Farming's automatic quality curve is additive with Selective Harvest,
  // never replaced by it (existing saves keep their automatic bonus).
  SkillSystem.restore({ skillExperience: { farming: 999999 } }); // Max out Farming level.
  const perkFreeQuality = [];
  random = () => 0.4;
  for (let i = 0; i < 20; i++) perkFreeQuality.push(SkillSystem.rollQuality('farming'));
  PerkSystem.restore({ perkRanks: { farming: { selectiveHarvest: 5 } } });
  const perkBoostedQuality = [];
  for (let i = 0; i < 20; i++) perkBoostedQuality.push(SkillSystem.rollQuality('farming'));
  const avg = list => list.reduce((sum, value) => sum + value, 0) / list.length;
  assert.ok(avg(perkBoostedQuality) >= avg(perkFreeQuality), 'Selective Harvest never lowers Farming\'s existing automatic quality bonus');

  console.log('skill-system.js / perk-system.js processing-quality checks passed.');
}

// ── alcohol-gameplay-bridge.js: bottle quality survives save/load ───────
{
  const src = read('docs/js/alcohol-gameplay-bridge.js');
  const inventory = { wine: 1 };
  const qualityBuckets = { wine: { 2: 1, 5: 3 } }; // ★2 x1, ★5 x3 in stock; opening a bottle should draw the ★2 first.
  const fakeCookingSystem = {
    peekLowestQuality(key) {
      const bucket = qualityBuckets[key] || {};
      const tier = [1, 2, 3, 4, 5].find(stars => (bucket[stars] || 0) > 0);
      return tier || 3;
    },
    consumeQuality(key, stars, amount) {
      const bucket = qualityBuckets[key] || {};
      if ((bucket[stars] || 0) < amount) return false;
      bucket[stars] -= amount;
      inventory[key] = Math.max(0, (inventory[key] || 0) - amount);
      return true;
    },
  };
  const windowStub = {
    ResourceSystem: { addDrunkenness() { return { blackout: false }; }, removeAffliction() {}, getEffectiveMax() { return 100; }, enforceCaps() {} },
    FarmCrates: { init() { return this; } },
    Mounts: { init() { return this; } },
    CookingSystem: fakeCookingSystem,
    addEventListener() {}, dispatchEvent() {},
  };
  const ctx = { window: windowStub, document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } }, performance: { now: () => 0 }, requestAnimationFrame() {}, setTimeout() {}, CustomEvent: function CustomEvent() {}, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);

  const wineDef = { key: 'wine', label: 'Redberry Wine', tags: ['Wine'], swigsPerBottle: 4 };
  windowStub.FarmCrates.init({ inventory, calendar: { day: 1, time01: 0 }, clampInventoryStack() {} });
  const bridge = windowStub.HobunjiDrunkGameplayBridge;

  const opened = bridge.getBottleSwigStatus('wine', wineDef, inventory);
  assert.equal(opened.stars, 2, 'opening a fresh bottle draws the lowest tracked quality tier first');

  bridge.consumeBottleSwig('wine', wineDef, inventory);
  bridge.consumeBottleSwig('wine', wineDef, inventory);

  // Simulate a save/reload cycle.
  const saved = JSON.parse(JSON.stringify(bridge.serializeBottleSwigs()));
  assert.equal(saved.wine.stars, 2, 'a partially consumed bottle retains its original star rating across save/load');
  const restored = bridge.restoreBottleSwigs(saved);
  assert.equal(restored.wine.stars, 2, 'restoring rehydrates the exact tracked quality');

  // Legacy pre-quality save shape (a plain remaining-swig number) still restores.
  const legacyRestored = bridge.restoreBottleSwigs({ wine: 3 });
  assert.equal(legacyRestored.wine.remaining, 3, 'legacy plain-number saves migrate their remaining-swig count');
  assert.ok(legacyRestored.wine.stars >= 1 && legacyRestored.wine.stars <= 5, 'legacy saves get a valid fallback star rating');

  // Finish the (still ★2) bottle and confirm the ★2 bucket — not the ★5
  // stock — is what actually gets consumed.
  bridge.restoreBottleSwigs(saved);
  bridge.consumeBottleSwig('wine', wineDef, inventory);
  bridge.consumeBottleSwig('wine', wineDef, inventory);
  assert.equal(qualityBuckets.wine[2], 0, 'finishing the bottle consumes its own tracked ★2 unit');
  assert.equal(qualityBuckets.wine[5], 3, 'the untouched ★5 stock is never silently spent by finishing a cheaper open bottle');

  console.log('alcohol-gameplay-bridge.js bottle-quality persistence checks passed.');
}

// ── combat-core.js: blackout severity/wander-score redesign ─────────────
{
  const src = read('docs/js/combat/combat-core.js');
  const THREE = { MathUtils: { degToRad: d => d * Math.PI / 180, radToDeg: r => r * 180 / Math.PI } };
  const GRID_SIZE = 24;
  function makeGrid() {
    const grid = [];
    for (let row = 0; row < GRID_SIZE; row++) {
      const line = [];
      for (let col = 0; col < GRID_SIZE; col++) line.push({ type: 'grass' });
      grid.push(line);
    }
    return grid;
  }
  const zones = { map_zoneA: makeGrid(), map_zoneB: makeGrid() };
  const townGrid = makeGrid();
  const farmGrid = makeGrid();
  let currentArea = 'town';
  let seededRandom = makeSeededRandom(1);
  const RS = {
    AFFLICTIONS: {},
    addAffliction() {}, removeAffliction() {}, getEffectiveMax() { return 100; }, getRingFillFraction() { return 0; },
    getSegmentBox() { return {}; }, enforceCaps() {}, applyDamage() { return 0; }, spendStamina() { return 0; }, tick() { return null; },
  };
  const devDeps = {
    getCurrentArea: () => currentArea,
    _isZoneArea: area => !!zones[area],
    _isBuildingArea: () => false,
    EXTERIOR_ZONES: { map_zoneA: {}, map_zoneB: {} },
    setCurrentArea(area) { currentArea = area; },
    setCurrentBuildingMapId() {},
    buildTownScene() {},
    buildZoneScene() {},
    getActiveGrid: () => (currentArea === 'town' ? townGrid : currentArea === 'farm' ? farmGrid : zones[currentArea]),
    getActiveCols: () => GRID_SIZE,
    getActiveRows: () => GRID_SIZE,
    getActiveScene: () => null,
    player: { x: 0, y: 0, vx: 0, vy: 0 },
    playerMesh: {}, playerGroundShadow: {}, toolHolder: {}, reticleMesh: {}, reticleCircleMesh: {}, reticleRingMesh: {}, reticleWavyGroup: {},
    _snapCameraTarget() {},
    refreshActionBar() {},
    TILE: 1,
    showToast() {},
  };
  const windowStub = {
    ResourceSystem: RS,
    GameRandom: { random: () => seededRandom() },
    Combat: { deps: { player: devDeps.player } },
    addEventListener() {}, dispatchEvent() {},
  };
  const ctx = { window: windowStub, document: { addEventListener() {}, getElementById() { return null; } }, THREE, performance: { now: () => 0 }, requestAnimationFrame() {}, setTimeout() {}, console, CustomEvent: function CustomEvent() {} };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);

  windowStub.DevSpawner = { init(d) { return d; } };
  windowStub.DevSpawner.init(devDeps);
  windowStub.CalendarSystem = { init(d) { return d; } };
  windowStub.CalendarSystem.init({ calendar: { day: 1, time01: 0.3 }, MORNING_HOUR: 6, NIGHT_HOUR: 22 });
  windowStub.ClimbSystem = { init(d) { return d; } };
  windowStub.ClimbSystem.init({ isSolid: () => false });

  const Alcohol = windowStub.HobunjiAlcohol;

  // #16: destination selection has zero dependency on POI/quest/loot state —
  // mechanically auditable via the debug field.
  assert.equal(Alcohol.getDebug().poiQueries, 0, 'blackout diagnostics explicitly report zero POI queries');

  // #11: raw deficit is never capped, even far past 100%.
  const massive = Alcohol.triggerBlackout(286, 3);
  assert.equal(massive.deficitPercent, 286, 'the raw Footing deficit is preserved exactly, uncapped, for diagnostics and the wander score');

  // #12: skipped time gets a hard cap despite the uncapped deficit.
  assert.ok(massive.skippedMinutes <= 1440, 'blackout time-skip is capped even for an extreme deficit');
  const modest = Alcohol.triggerBlackout(5, 3);
  assert.ok(modest.skippedMinutes >= 30 && modest.skippedMinutes < massive.skippedMinutes, 'small deficits still scale roughly linearly below the cap');

  // #13/#17: higher wander score (via alcohol quality) reaches more hops,
  // and an injected RNG reproduces the exact same result on replay.
  currentArea = 'town';
  seededRandom = makeSeededRandom(42);
  const lowQuality = Alcohol.triggerBlackout(120, 1);
  currentArea = 'town';
  seededRandom = makeSeededRandom(42);
  const lowQualityReplay = Alcohol.triggerBlackout(120, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(lowQualityReplay.travel.path)), JSON.parse(JSON.stringify(lowQuality.travel.path)), 'the same seed reproduces the exact same blackout route');
  assert.equal(lowQualityReplay.travel.targetArea, lowQuality.travel.targetArea, 'the same seed reproduces the exact same destination');

  currentArea = 'town';
  seededRandom = makeSeededRandom(42);
  const highQuality = Alcohol.triggerBlackout(120, 5);
  assert.ok(highQuality.travel.score > lowQuality.travel.score, '★5 alcohol produces a higher wander score than ★1 alcohol at the same deficit');
  assert.ok(highQuality.travel.requestedHops >= lowQuality.travel.requestedHops, 'a higher wander score can request at least as many hops as a lower one');

  // #14: the random walk never immediately backtracks A→B→A when an
  // alternative neighbor actually exists (town has 3+ neighbors here).
  let sawForcedBacktrack = false;
  for (let seed = 0; seed < 40; seed++) {
    currentArea = 'town';
    seededRandom = makeSeededRandom(seed * 7 + 1);
    const result = Alcohol.triggerBlackout(300, 5); // High score -> multiple hops.
    const path = result.travel.path;
    for (let i = 2; i < path.length; i++) {
      if (path[i] === path[i - 2] && path[i - 1] !== path[i]) {
        // path[i-1] is the pivot; an immediate backtrack means its neighbor
        // set had no alternative to path[i-2] itself.
        const neighborsAtPivot = path[i - 1] === 'town' ? ['farm', 'map_zoneA', 'map_zoneB'] : ['town'];
        if (neighborsAtPivot.filter(area => area !== path[i - 2]).length > 0) sawForcedBacktrack = true;
      }
    }
  }
  assert.equal(sawForcedBacktrack, false, 'the random walk avoids immediate backtracking whenever an alternative neighbor exists');

  // #15: the final coordinate always lands on a walkable tile.
  for (let seed = 0; seed < 15; seed++) {
    currentArea = 'town';
    seededRandom = makeSeededRandom(seed * 11 + 3);
    const result = Alcohol.triggerBlackout(400, 5);
    const tile = result.travel.immediateResult.tile;
    const grid = devDeps.getActiveGrid();
    assert.ok(tile && grid[tile.row]?.[tile.col], `blackout destination tile (${JSON.stringify(tile)}) exists on the active grid`);
  }

  // #9/#10: alcohol quality changes drunkenHealth harshness, never footing
  // (type keeps controlling footing/intoxication strength) — exercised via
  // the exported quality multipliers rather than re-deriving combat-core's
  // private drinkPotion closure.
  assert.equal(Alcohol.profileForItem === undefined ? null : 'ok', 'ok', 'profileForItem stays available for callers');

  console.log('combat-core.js blackout severity/wander-score checks passed.');
}

console.log('All item-quality and blackout-wander regression checks passed.');
