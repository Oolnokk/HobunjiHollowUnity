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
assert.equal(cfg.behavior.fullSimulationChunkTiles, 10);
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
assert(localeIndex.locales.some(entry => entry.id === 'locale_porakaneki_camp_small'));
assert(localeIndex.locales.some(entry => entry.id === 'locale_porakaneki_camp_chief' && entry.singleton === true));
assert(houseLoader.includes('porakaneki-camps-runtime.js?v=20260912'));
assert(socialSource.includes('canGiftToday'), 'chief gifting must retain the ordinary once-per-day NPC gate');
assert(socialSource.includes('window.NpcRapport'), 'chief must retain the ordinary Rapport bridge');
assert(runtimeSource.includes("activity: 'break'"), 'chief daytime behavior must remain free-time planner driven');
assert(runtimeSource.includes('for (const zoneId of (cfg.wildernessZones || []))'), 'runtime must build camps across every configured wilderness zone');

let currentArea = 'town'; // Mutated through off-zone, same-zone/off-chunk, and same-chunk cases.
let hour = 12; // Calendar hour for awake/sleep checks.
let season = 'Stormtide'; // Mutated to prove large-camp migration without disturbing little camps.
const day = 7;
const relation = { favor: 0, memory: [] }; // Named chief relationship record doubles as tribe-wide Favor.
const hostileObjects = []; // Real combat entities should only appear for same-chunk residents.
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
const zoneLayouts = new Map(ZONES.map(zoneId => [zoneId, makeLayout()])); // All four generated wilderness layouts are available to the runtime at once.

function fakeStamp(view, localeDef, opts) {
  view.__stampSeq = (view.__stampSeq || 0) + 1; // First call is the silent large-camp reservation, following calls are small camps.
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
  return { visible: true, position: { set() {} }, parent: { remove() {} } }; // Minimal fields touched by materialize/hide/teardown.
}
const banditCombat = {
  init(deps) { this.deps = deps; return 'bandit-init'; },
  async loadGangConfig() { return { baseline: true }; },
  async makeEntity(_base, _rank, _tier, x, y, opts) {
    return {
      id: `generated_${opts.extra.porakanekiCampId}_${opts.extra.porakanekiHunterIndex}`,
      x, y, health: 20, maxHealth: 20, halfHeight: 0.5,
      def: { aggroRangePx: 360 }, state: 'idle', areaId: currentArea,
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
const context = vm.createContext({ window: contextWindow, fetch: contextWindow.fetch, console, Date, Math, Set, Map, Promise, performance: { now: () => 1000 } });
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
  HELD_SHAPE_DEFS: { fishingspear: { dmgType: 'sharp' }, hatchet: { dmgType: 'sharp' }, daggerSword: { dmgType: 'sharp' } },
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

(async () => {
  await flush();
  const api = contextWindow.PorakanekiCamps;
  assert.equal(api.version, 3);
  assert.equal(api.__test.isSleepingHour(2), true);
  assert.equal(api.__test.isSleepingHour(12), false);
  assert.equal(api.__test.desiredChiefZone('Stormtide'), 'map_southern_cloud_forest');
  assert.equal(api.__test.desiredChiefZone('Coldmuck'), 'map_northern_cliffs');
  assert.equal(api.__test.weaponRoll(() => 0.99), 'daggerSword');
  assert.equal(api.__test.weaponRoll(() => 0.99), 'daggerSword', 'independent random weapon rolls may duplicate');

  assert.equal(api.initializeReputation(), true);
  assert.equal(relation.favor, -3);

  contextWindow.BanditCamps.updateCampBanners(0.21); // Builds all four camp networks even though the player is in town.
  let debug = api.debugSnapshot();
  assert.equal(debug.version, 3);
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
  assert.equal(hostileObjects.length, 0, 'all off-zone generated residents remain abstract');

  const originalSmallCenters = JSON.stringify(smallCenters(debug));
  season = 'Deadgrass';
  contextWindow.BanditCamps.updateCampBanners(0.21); // Large camp migrates; little camps must not move/re-roll.
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
  assert(hostileObjects.length >= 1, 'same-chunk procedural residents materialize through the real humanoid combat pipeline');
  const materialized = debug.zones.map_western_slope.camps.flatMap(camp => camp.hunters).find(hunter => hunter.materialized && hunter.fullSimulation);
  assert(materialized, 'at least one same-chunk resident runs full simulation');

  combatDeps.player.x = 90 * combatDeps.TILE;
  combatDeps.player.y = 90 * combatDeps.TILE;
  contextWindow.BanditCamps.updateCampBanners(4.1);
  debug = api.debugSnapshot();
  assert(debug.coarseTicks >= 1);
  const collapsed = debug.zones.map_western_slope.camps.flatMap(camp => camp.hunters).find(hunter => hunter.materialized && !hunter.fullSimulation);
  assert(collapsed && collapsed.visible === false, 'previously materialized residents collapse back to hidden abstract agents outside the player chunk');

  console.log('Porakaneki distributed seasonal camp regression checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
