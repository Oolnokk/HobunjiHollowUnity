const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const cfg = JSON.parse(fs.readFileSync('docs/config/porakaneki-camp.json', 'utf8')); // Authoritative distributed-camp/season/LOD tuning.
const smallLocale = JSON.parse(fs.readFileSync('docs/config/locales/locale_porakaneki_camp_small.json', 'utf8')); // Little procedural-only camp footprint.
const chiefLocale = JSON.parse(fs.readFileSync('docs/config/locales/locale_porakaneki_camp_chief.json', 'utf8')); // Large seasonal named-chief camp footprint.
const localeIndex = JSON.parse(fs.readFileSync('docs/config/locales/index.json', 'utf8')); // Guards both camp types' editor/runtime discoverability.
const runtimeSource = fs.readFileSync('docs/js/porakaneki-camps-runtime.js', 'utf8'); // Browser-shaped VM exercises actual network/season/LOD transitions.
const houseLoader = fs.readFileSync('docs/js/house-pieces.js', 'utf8'); // Guards parser-time bootstrap/cache version.
const socialSource = fs.readFileSync('docs/js/npc-social-relationship-bridge-v2.js', 'utf8'); // Named chief retains normal gift/Rapport/dance/liquor path.

const ZONES = [
  'map_northern_cliffs',
  'map_southern_cloud_forest',
  'map_western_slope',
  'map_eastern_mire',
];

assert.equal(cfg.schema, 'hobunji_porakaneki_camp.v3');
assert.deepEqual(cfg.wildernessZones, ZONES);
assert.equal(cfg.smallCamps.minPerZone, 2);
assert.equal(cfg.smallCamps.maxPerZone, 4);
assert.equal(cfg.smallCamps.minResidents, 2);
assert.equal(cfg.smallCamps.maxResidents, 4);
assert.equal(cfg.chiefCamp.generatedResidents, 6);
assert.deepEqual(cfg.chiefCamp.seasonZoneMap, {
  Stormtide: 'map_southern_cloud_forest',
  Deadgrass: 'map_western_slope',
  Longpour: 'map_eastern_mire',
  Coldmuck: 'map_northern_cliffs',
});
assert.equal(cfg.behavior.fullSimulationChunkTiles, 10, 'legacy chunk size remains only for debug/backward compatibility');
assert.equal(cfg.behavior.fullSimulationRadiusTiles, 12);
assert.equal(cfg.behavior.fullSimulationReleaseRadiusTiles, 16);
assert(cfg.behavior.fullSimulationReleaseRadiusTiles > cfg.behavior.fullSimulationRadiusTiles, 'LOD hysteresis must have a wider release radius than enter radius');
assert.equal(cfg.behavior.offChunkTickSeconds, 4);
assert.equal(cfg.reputation.initialFavor, -3);
assert.equal(cfg.reputation.minimumFavor, -5);
assert.equal(cfg.reputation.killPenalty, -1);
assert.deepEqual(smallLocale.placement.allowedZones, ZONES);
assert.equal(smallLocale.placement.maxInstances, 4);
assert.equal(smallLocale.meta.namedNpcs, false);
assert.deepEqual(chiefLocale.placement.allowedZones, ZONES);
assert.equal(chiefLocale.placement.maxInstances, 1);
assert.equal(chiefLocale.meta.namedNpc, 'porakaneki_chief');
assert.equal(chiefLocale.objects.filter(object => object.kind === 'tent').length, 7);
assert.deepEqual(cfg.equipment.weaponShapes, ['fishingspear', 'hatchet', 'dagger'], 'Porakaneki must use the true dagger shape, never daggerSword');
assert(localeIndex.locales.some(entry => entry.id === 'locale_porakaneki_camp_small'));
assert(localeIndex.locales.some(entry => entry.id === 'locale_porakaneki_camp_chief' && entry.singleton === true));
assert(houseLoader.includes('porakaneki-camps-runtime.js?v=20260917dagger1'));
assert(socialSource.includes('canGiftToday'), 'chief gifting must retain the ordinary once-per-day NPC gate');
assert(socialSource.includes('window.NpcRapport'), 'chief must retain the ordinary Rapport bridge');
assert(runtimeSource.includes("activity: 'break'"), 'chief daytime behavior must remain free-time planner driven');
assert(runtimeSource.includes('for (const zoneId of (cfg.wildernessZones || []))'), 'runtime must build camps across every configured wilderness zone');
assert(runtimeSource.includes("entity.state = 'return'"), 'neutral Porakaneki must delegate actual travel/rendering to the shared hostile return/home path');
assert(!runtimeSource.includes('combatDeps.moveCreatureToward?.(entity'), 'Porakaneki planner must not independently move the same live entity the hostile loop is rendering');
assert(runtimeSource.indexOf('updateAllHunters(step, coarseStep);') < runtimeSource.indexOf('updateTerritoryWarnings();'), 'nearby hunters must begin materializing before territory dialogue attempts to choose a speaker');
assert(runtimeSource.includes('allowToastFallback: false'), 'territory warnings must wait for Ambient Dialogue instead of being consumed as a toast');
assert(runtimeSource.includes('combatDeps.hostileObjects.add(entity)'), 'Porakaneki residents must join the same Set-backed hostile registry as arena/bandit/wildlife entities');
assert(runtimeSource.includes('combatDeps.hostileObjects.delete(entity)'), 'retired Porakaneki residents must leave the Set-backed hostile registry');
assert(runtimeSource.includes('combatDeps?.hostileObjects?.has?.(entity)'), 'Porakaneki diagnostics must report Set registration accurately');

let currentArea = 'town'; // Mutated through off-zone, same-zone/nearby, hysteresis, and far-away cases.
let hour = 12; // Calendar hour for awake/sleep checks.
let season = 'Stormtide'; // Mutated to prove large-camp migration without disturbing little camps.
const day = 7;
const relation = { favor: 0, memory: [] }; // Named chief relationship record doubles as tribe-wide Favor.
const hostileObjects = new Set(); // Mirrors the production hostile registry used by arena, bandit-camp, and wildlife spawning.
const rewardLog = [];
const toastLog = [];
const stations = [];
const chief = {
  rec: { id: 'porakaneki_chief', appearance: {}, scheduleHooks: {}, agenda: [{ id: 'placeholder' }] },
  area: 'town',
  root: { position: { x: 5, z: 5 } },
};

function makeLayout() {
  return {
    cols: 96,
    rows: 96,
    tiles: Array.from({ length: 96 * 96 }, (_, i) => ({ c: i % 96, r: Math.floor(i / 96), type: 'grass', elevTier: 0 })),
    buildings: [], dens: [], decor: [], furniture: [], transitions: [], rootTotems: [], localeInstances: [],
    toTownExit: { col: 2, row: 2 },
  };
}
const zoneLayouts = new Map(ZONES.map(zoneId => [zoneId, makeLayout()]));

function fakeStamp(view, localeDef, opts) {
  view.__stampSeq = (view.__stampSeq || 0) + 1;
  const seq = view.__stampSeq;
  const isChief = localeDef.id === 'locale_porakaneki_camp_chief';
  const width = isChief ? 19 : 13, height = isChief ? 17 : 12;
  const x = isChief ? 4 : 24 + ((seq - 2) % 2) * 28;
  const y = isChief ? 4 : 12 + Math.floor((seq - 2) / 2) * 30;
  const id = opts.instanceId;
  for (const object of localeDef.objects) {
    view.objects.push({
      id: `${id}_${object.id}`,
      type: object.kind === 'tent' ? 'tent' : object.kind,
      key: object.key,
      x: x + object.col,
      y: y + object.row,
      w: object.w,
      h: object.h,
      temporaryLocaleInstanceId: id,
      destroyed: false,
    });
  }
  return { id, site: { x, y, w: width, h: height }, removedObjectSnapshots: [], tileSnapshot: {} };
}

function avatarGroup() {
  const position = {
    x: 0, y: 0, z: 0,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; },
  };
  return { visible: true, position, parent: { remove() {} } };
}
const banditCombat = {
  init(deps) { this.deps = deps; return 'bandit-init'; },
  async loadGangConfig() { return { baseline: true }; },
  async makeEntity(_base, _rank, _tier, x, y, opts) {
    return {
      id: `generated_${opts.extra.porakanekiCampId}_${opts.extra.porakanekiHunterIndex}`,
      x, y, health: 20, maxHealth: 20, halfHeight: 0.5,
      def: { aggroRangePx: 360, moveSpeed: 118 }, state: 'idle', areaId: currentArea,
      avatarRef: { group: avatarGroup(), dispose() {} },
      groundShadow: { visible: true, position: { set() {} }, parent: { remove() {} }, geometry: { dispose() {} }, material: { dispose() {} } },
      _banditToolHolder: { visible: true, parent: { remove() {} } },
      _banditRangedToolHolder: opts.defOverride.rangedWeaponKey ? { visible: false, parent: { remove() {} } } : null,
      ...opts.extra,
    };
  },
};
const npcScheduling = {
  init(deps) { this.deps = deps; return 'schedule-init'; },
  registerNpcStations(list) { stations.push(...list); },
};
const banditCamps = { updateCampBanners() { return 'camp-tick'; } };

const contextWindow = {
  fetch: async url => {
    const value = String(url);
    const payload = value.includes('porakaneki-camp.json') ? cfg : value.includes('chief') ? chiefLocale : smallLocale;
    return { ok: true, status: 200, json: async () => payload };
  },
  BanditCombat: banditCombat,
  NpcScheduling: npcScheduling,
  BanditCamps: banditCamps,
  TemporaryLocales: { stamp: fakeStamp },
  CalendarSystem: {
    getHour: () => hour,
    timeDebugSnapshot: () => ({ rawDay: day }),
    yearNumber: () => 1,
    currentSeason: () => ({ name: season }),
  },
  DialogueContent: { getNpcDlgState: () => relation },
  WorldPopupText: { queueReward: (...args) => rewardLog.push(args) },
  NpcSocialStimuli: { strongestNear: () => null },
  __farmLog() {},
};
contextWindow.window = contextWindow;
let fakeNowMs = 1000;
const context = vm.createContext({ window: contextWindow, fetch: contextWindow.fetch, console, Date, Math, Set, Map, Promise, performance: { now: () => fakeNowMs } });
vm.runInContext(runtimeSource, context, { filename: 'porakaneki-camps-runtime.js' });

const randomValues = [0.91, 0.91, 0.12, 0.4, 0.6, 0.2, 0.8, 0.3, 0.7, 0.1];
let randomIndex = 0;
const activeGrid = Array.from({ length: 96 }, () => Array.from({ length: 96 }, () => ({ type: 'grass' })));
const combatDeps = {
  TILE: 60,
  player: { x: 90 * 60, y: 90 * 60 },
  calendar: { day },
  rnd: () => randomValues[(randomIndex++) % randomValues.length],
  zoneLayouts,
  zoneScenes: new Map(),
  EXTERIOR_ZONES: Object.fromEntries(ZONES.map(zoneId => [zoneId, { cols: 96, rows: 96, entryCol: 2, entryRow: 2 }])),
  WATERWAY_TYPES: new Set(['river', 'stream']),
  TileType: { PATH: 'path', RAMP: 'ramp', WATERFALL: 'waterfall', SHRUB: 'shrub', ROCK: 'rock' },
  HELD_SHAPE_DEFS: { fishingspear: { dmgType: 'sharp' }, hatchet: { dmgType: 'sharp' }, dagger: { dmgType: 'sharp' } },
  craftedToolItemKey: (shape, metal) => `${shape}_${metal}`,
  hostileObjects,
  getCurrentArea: () => currentArea,
  getActiveGrid: () => activeGrid,
  getActiveCols: () => 96,
  getActiveRows: () => 96,
  tileSurfaceYInArea: () => 0,
  characterGroundShadowSurfaceOffset: () => 0.01,
  moveCreatureToward(entity, tx, ty, speed, dt) {
    const dx = tx - entity.x, dy = ty - entity.y, distance = Math.hypot(dx, dy);
    if (!distance) return;
    const step = Math.min(distance, speed * dt);
    entity.x += dx / distance * step;
    entity.y += dy / distance * step;
  },
  showToast(text, positive) { toastLog.push({ text, positive }); },
};
assert.equal(contextWindow.BanditCombat.init(combatDeps), 'bandit-init');
assert.equal(contextWindow.NpcScheduling.init({ npcWalkers: [chief] }), 'schedule-init');

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

function smallCenters(debug) {
  const result = {};
  for (const zoneId of ZONES) result[zoneId] = debug.zones[zoneId].camps.filter(camp => camp.kind === 'small').map(camp => camp.center);
  return result;
}

function hunterDebug(api, zoneId, campId, index) {
  return api.debugSnapshot().zones[zoneId].camps.find(camp => camp.id === campId).hunters[index];
}

(async () => {
  await flush();
  const api = contextWindow.PorakanekiCamps;
  assert.equal(api.version, 3);
  assert.equal(api.__test.isSleepingHour(2), true);
  assert.equal(api.__test.isSleepingHour(12), false);
  assert.equal(api.__test.desiredChiefZone('Stormtide'), 'map_southern_cloud_forest');
  assert.equal(api.__test.desiredChiefZone('Coldmuck'), 'map_northern_cliffs');
  assert.equal(api.__test.weaponRoll(() => 0.99), 'dagger');
  assert.equal(api.__test.weaponRoll(() => 0.99), 'dagger', 'independent random weapon rolls may duplicate');

  assert.equal(api.initializeReputation(), true);
  assert.equal(relation.favor, -3);

  contextWindow.BanditCamps.updateCampBanners(0.21);
  let debug = api.debugSnapshot();
  assert.equal(debug.version, 3);
  assert.equal(debug.fullSimulationRadiusTiles, 12);
  assert.equal(debug.fullSimulationReleaseRadiusTiles, 16);
  assert.equal(Object.keys(debug.zones).length, 4);
  assert(debug.totalSmallCamps >= 8 && debug.totalSmallCamps <= 16, '2-4 small camps on each of four wilderness maps means 8-16 little camps total');
  for (const zoneId of ZONES) {
    assert(debug.zones[zoneId].smallCampCount >= 2 && debug.zones[zoneId].smallCampCount <= 4, `${zoneId} must have 2-4 little camps`);
    assert.equal(debug.zones[zoneId].chiefReserved, true, `${zoneId} reserves a valid future chief-camp site`);
    for (const camp of debug.zones[zoneId].camps.filter(camp => camp.kind === 'small')) assert(camp.residents >= 2 && camp.residents <= 4);
  }
  assert.equal(debug.chiefZoneId, 'map_southern_cloud_forest');
  assert.equal(ZONES.filter(zoneId => debug.zones[zoneId].chiefActive).length, 1, 'exactly one large chief camp is active');
  assert.equal(debug.zones.map_southern_cloud_forest.camps.find(camp => camp.kind === 'chief').residents, 6);
  assert.equal(chief.rec.scheduleHooks.defaultMapId, 'map_southern_cloud_forest');
  assert.equal(chief.rec.agenda.find(beat => beat.id === 'porakaneki_day').activity, 'break');
  assert.equal(hostileObjects.size, 0, 'all off-zone generated residents remain abstract');

  const originalSmallCenters = JSON.stringify(smallCenters(debug));
  season = 'Deadgrass';
  contextWindow.BanditCamps.updateCampBanners(0.21);
  debug = api.debugSnapshot();
  assert.equal(debug.chiefZoneId, 'map_western_slope');
  assert.equal(ZONES.filter(zoneId => debug.zones[zoneId].chiefActive).length, 1);
  assert.equal(debug.zones.map_western_slope.chiefActive, true);
  assert.equal(debug.zones.map_southern_cloud_forest.chiefActive, false);
  assert.equal(JSON.stringify(smallCenters(debug)), originalSmallCenters, 'small camps remain stable when the chief camp changes maps');
  assert.equal(chief.rec.scheduleHooks.defaultMapId, 'map_western_slope');
  assert(chief.rec.agenda.every(beat => !beat.destinationArea || beat.destinationArea === 'map_western_slope'));

  currentArea = 'map_western_slope';
  chief.area = currentArea;
  const targetCamp = debug.zones.map_western_slope.camps.find(camp => camp.kind === 'small');
  const targetHunter = targetCamp.hunters[0];
  combatDeps.player.x = targetHunter.x * combatDeps.TILE;
  combatDeps.player.y = targetHunter.y * combatDeps.TILE;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  await flush();
  contextWindow.BanditCamps.updateCampBanners(0.21);
  await flush();
  debug = api.debugSnapshot();
  assert(hostileObjects.size >= 1, 'nearby procedural residents materialize through the real Set-backed humanoid combat pipeline');
  const materializedCamp = debug.zones.map_western_slope.camps.find(camp => camp.hunters.some(hunter => hunter.materialized && hunter.fullSimulation));
  const materializedIndex = materializedCamp.hunters.findIndex(hunter => hunter.materialized && hunter.fullSimulation);
  let materialized = materializedCamp.hunters[materializedIndex];
  assert(materialized, 'at least one nearby resident runs full simulation');
  assert.equal(materialized.entityState, 'return', 'neutral resident delegates locomotion to the shared hostile return/home state');
  assert.equal(materialized.plannerControlled, true);
  assert.equal(materialized.registered, true, 'materialized resident is present in the shared hostile Set');
  assert.equal(materialized.renderDelta, 0, 'freshly placed avatar root matches the live simulation position');

  // Distance LOD has no invisible 10x10 chunk edge. A resident entered at 12
  // tiles stays live through the wider 16-tile release radius, so walking a
  // few tiles across an old chunk boundary cannot make it disappear like a
  // ghost. Pick a direction that stays inside the 96x96 test map.
  const direction = materialized.x < 48 ? 1 : -1;
  combatDeps.player.x = (materialized.x + direction * 13) * combatDeps.TILE;
  combatDeps.player.y = materialized.y * combatDeps.TILE;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  materialized = hunterDebug(api, currentArea, materializedCamp.id, materializedIndex);
  assert.equal(materialized.fullSimulation, true, 'already-live resident remains detailed between enter and release radii');
  assert.equal(materialized.visible, true, 'hysteresis does not blink the portrait off at an arbitrary chunk boundary');

  combatDeps.player.x = (materialized.x + direction * 16.5) * combatDeps.TILE;
  combatDeps.player.y = materialized.y * combatDeps.TILE;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  let collapsed = hunterDebug(api, currentArea, materializedCamp.id, materializedIndex);
  assert.equal(collapsed.fullSimulation, false, 'resident exits detailed simulation only beyond the configured release radius');
  assert.equal(collapsed.visible, false, 'beyond the release radius the entity collapses to the abstract representation');

  const hostileCountWhileHidden = hostileObjects.size;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  assert.equal(hostileObjects.size, hostileCountWhileHidden, 'a briefly-dormant resident is not immediately torn down (avoids edge thrash)');
  fakeNowMs += 3001;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  collapsed = hunterDebug(api, currentArea, materializedCamp.id, materializedIndex);
  assert.equal(collapsed.materialized, false, 'sustained dormancy actually releases the entity back to plain abstract data');
  assert(hostileObjects.size < hostileCountWhileHidden, 'the released entity is deleted from hostileObjects, not left as permanent dead weight');

  // Warnings/greetings must read as an actual Porakaneki speaking -- the same
  // overhead chathead+text bubble every other NPC's greeting uses -- not a HUD
  // toast. Warnings additionally opt out of fallback so an async materialization
  // race leaves them pending until a live speaker exists.
  const toastCountBefore = toastLog.length;
  const showCalls = [];
  contextWindow.AmbientDialogue = { show: (...args) => { showCalls.push(args); return { fakeEvent: true }; } };
  contextWindow.NpcAvatarPreview = { buildProfileFromNpcExport: npc => ({ fighter: { id: 'porakaneki_male' }, __npc: npc }) };
  const fakeHunterEntity = {
    id: 'hunter_speak_test', areaId: 'test_area', health: 20,
    avatarRef: { group: { fakeGroup: true, visible: true } },
    rosterRecord: { appearance: { speciesId: 'porakaneki', gender: 'male' }, equippedCosmetics: [], appliedDyes: {} },
  };
  const fakeHunter = { entity: fakeHunterEntity, camp: { zoneId: 'test_area' } };
  const fakeWalker = { root: { fakeRoot: true }, rec: { id: 'porakaneki_chief' }, profile: { fighter: { id: 'chief_walker_profile' } } };

  let ok = api.__test.speakOverheadFromHunter(fakeHunter, 'Go way. No want trouble', { tone: 'warning', important: false, allowToastFallback: false });
  assert.equal(ok, true, 'speakOverheadFromHunter reports success when AmbientDialogue accepts the bubble');
  assert.equal(showCalls.length, 1);
  assert.equal(showCalls[0][0], fakeHunterEntity.avatarRef.group, 'bubble anchors to the speaking hunter\'s own avatar, not a generic point');
  assert.equal(showCalls[0][1], 'Go way. No want trouble');
  assert.equal(showCalls[0][2].mode, 'chathead');
  assert.equal(showCalls[0][2].profile.fighter.id, 'porakaneki_male');
  assert.equal(showCalls[0][2].profile.__npc, fakeHunterEntity.rosterRecord);
  assert.equal(showCalls[0][2].tone, 'warning');
  assert.equal(toastLog.length, toastCountBefore, 'no fallback toast fires once AmbientDialogue actually shows the bubble');

  ok = api.__test.speakOverheadFromWalker(fakeWalker, 'Good to see you, friend.', { tone: 'greeting' });
  assert.equal(ok, true);
  assert.equal(showCalls.length, 2);
  assert.equal(showCalls[1][0], fakeWalker.root);
  assert.equal(showCalls[1][2].profile, fakeWalker.profile);
  assert.equal(showCalls[1][2].mode, 'chathead');

  delete contextWindow.AmbientDialogue;
  const warningToastCount = toastLog.length;
  ok = api.__test.speakOverheadFromHunter(fakeHunter, 'This our spot, not yours. Leave.', { important: false, allowToastFallback: false });
  assert.equal(ok, false);
  assert.equal(toastLog.length, warningToastCount, 'territory warning stays pending instead of degrading to a toast when no live Ambient Dialogue speaker exists');

  ok = api.__test.speakOverheadFromHunter(fakeHunter, 'Ordinary fallback test.', { important: false });
  assert.equal(ok, false);
  assert.equal(toastLog.length, warningToastCount + 1, 'non-territory callers retain the old safe toast fallback');
  assert.deepEqual(toastLog[toastLog.length - 1], { text: 'Ordinary fallback test.', positive: false });

  console.log('Porakaneki distributed seasonal camp regression checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
