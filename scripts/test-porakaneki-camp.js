const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const cfg = JSON.parse(fs.readFileSync('docs/config/porakaneki-camp.json', 'utf8')); // Authoritative camp/schedule/reputation tuning exercised below.
const locale = JSON.parse(fs.readFileSync('docs/config/locales/locale_porakaneki_camp_small.json', 'utf8')); // Real authored footprint used by the runtime's TemporaryLocales stamp.
const localeIndex = JSON.parse(fs.readFileSync('docs/config/locales/index.json', 'utf8')); // Guards discoverability through the locale editor/index.
const speciesOverrides = JSON.parse(fs.readFileSync('docs/config/npcs/species-overrides.json', 'utf8')); // Guards the male-only existing chief composition.
const runtimeSource = fs.readFileSync('docs/js/porakaneki-camps-runtime.js', 'utf8'); // Executed in a browser-shaped VM to exercise actual state transitions.
const houseLoader = fs.readFileSync('docs/js/house-pieces.js', 'utf8'); // Guards parser-time runtime bootstrap.
const combatLoader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Guards the dagger dual-role bridge load.
const socialSource = fs.readFileSync('docs/js/npc-social-relationship-bridge-v2.js', 'utf8'); // Existing once-per-day gifting/Rapport layer reused by the chief.

assert.equal(cfg.zoneId, 'map_western_slope');
assert.equal(cfg.localeId, 'locale_porakaneki_camp_small');
assert.equal(cfg.population.hunters, 3);
assert.deepEqual(cfg.equipment.weaponShapes, ['fishingspear', 'hatchet', 'daggerSword']);
assert.equal(cfg.reputation.initialFavor, -3);
assert.equal(cfg.reputation.attackOnSightFavor, -5);
assert.equal(cfg.reputation.greetingFavorGain, 1);
assert.equal(cfg.reputation.assaultPenalty, -2);
assert.equal(cfg.reputation.killPenalty, -2);
assert.deepEqual(cfg.schedule, { sleepStartHour: 22, wakeHour: 6, huntEndHour: 10 });
assert.deepEqual(locale.placement.allowedZones, ['map_western_slope']);
assert.equal(locale.objects.filter(object => object.kind === 'tent').length, 3);
assert(localeIndex.locales.some(entry => entry.id === cfg.localeId && entry.category === 'porakaneki_camp'));
assert.equal(speciesOverrides.npcs.porakaneki_chief.species, 'porakaneki');
assert.equal(speciesOverrides.npcs.porakaneki_chief.avatarExport.appearance.gender, 'male');
assert(houseLoader.includes("['PorakanekiCamps', 'porakaneki-camps-runtime.js?v=20260912a']"));
assert(combatLoader.includes("['js/combat/porakaneki-dagger-ranged.js?v=20260912a'"));
assert(socialSource.includes('canGiftToday'), 'Porakaneki chief daily gifts must reuse the existing once-per-day NPC gift gate');
assert(socialSource.includes('window.NpcRapport'), 'Porakaneki chief must reuse the existing persisted Rapport bridge');

let currentArea = 'town'; // Mutated by the test to exercise off-zone stamping and live Western Slope behavior separately.
let hour = 12; // Mutated by phase assertions through CalendarSystem.getHour.
const day = 7; // Stable absolute day used by the once-per-day greeting marker.
const relation = { favor: 0, memory: [] }; // Existing chief relationship record doubles as tribe reputation.
const rewardLog = []; // Captures Porakaneki Favor HUD rewards for greeting/assault/kill changes.
const rapportLog = []; // Captures greeting integration with the existing Rapport system.
const hostileObjects = []; // Shared hostile array receives the three generated Porakaneki hunters.
const stations = []; // Captures dynamic camp stations registered for the existing chief walker.
const chief = {
  rec: { id: 'porakaneki_chief', appearance: {}, scheduleHooks: {}, agenda: { id: 'placeholder' } },
  area: 'town',
  root: { position: { x: 26.5, z: 26 } },
}; // Normal NPC walker stub proves the runtime schedules/socializes the real chief rather than inventing a parallel NPC type.

const layout = {
  cols: 64,
  rows: 64,
  tiles: Array.from({ length: 64 * 64 }, (_, i) => ({ c: i % 64, r: Math.floor(i / 64), type: 'grass', elevTier: 0 })),
  buildings: [], dens: [], decor: [], furniture: [], transitions: [], rootTotems: [], localeInstances: [],
  toTownExit: { col: 2, row: 2 },
}; // Flat deterministic generated-zone stand-in consumed by buildZoneView.

function fakeStamp(view, localeDef, opts) {
  assert.equal(opts.clearableTypes.size, 0, 'Porakaneki camp must never bulldoze generated clutter');
  const id = opts.instanceId; // Used to match exactly the real TemporaryLocales instance ownership field.
  const anchorX = 22, anchorY = 22;
  for (const object of localeDef.objects) {
    view.objects.push({
      id: `${id}_${object.id}`,
      type: object.kind === 'tent' ? 'tent' : object.kind,
      key: object.key,
      x: anchorX + object.col,
      y: anchorY + object.row,
      w: object.w,
      h: object.h,
      temporaryLocaleInstanceId: id,
      destroyed: false,
    });
  }
  return { id, site: { x: 20, y: 20, w: 13, h: 12 }, anchorX, anchorY };
}

function avatarGroup() {
  return { visible: true, position: { set() {} }, parent: { remove() {} } }; // Minimal group fields place/hide/teardown touch.
}

const banditCombat = {
  init(deps) { this.deps = deps; return 'bandit-init'; },
  async loadGangConfig() { return { baseline: true }; },
  async makeEntity(_base, _rank, _tier, x, y, opts) {
    return {
      id: `hunter_${opts.extra.porakanekiHunterIndex}`,
      x, y, health: 20, maxHealth: 20, halfHeight: 0.5,
      def: { aggroRangePx: 360 }, state: 'idle', areaId: currentArea,
      avatarRef: { group: avatarGroup(), dispose() {} },
      groundShadow: { visible: true, position: { set() {} }, parent: { remove() {} }, geometry: { dispose() {} }, material: { dispose() {} } },
      _banditToolHolder: { visible: true, parent: { remove() {} } },
      _banditRangedToolHolder: opts.defOverride.rangedWeaponKey ? { visible: false, parent: { remove() {} } } : null,
      ...opts.extra,
    };
  },
}; // Existing BanditCombat API stub proves runtime opts produce the expected humanoid entities/weapons.
const npcScheduling = {
  init(deps) { this.deps = deps; return 'schedule-init'; },
  registerNpcStations(list) { stations.push(...list); },
}; // Existing scheduler API stub captures the dynamically placed camp stations.
const banditCamps = { updateCampBanners() { return 'camp-tick'; } }; // Existing cheap game-loop seam wrapped by the runtime.

const contextWindow = {
  fetch: async url => ({ ok: true, status: 200, json: async () => String(url).includes('porakaneki-camp.json') ? cfg : locale }),
  BanditCombat: banditCombat,
  NpcScheduling: npcScheduling,
  BanditCamps: banditCamps,
  TemporaryLocales: { stamp: fakeStamp },
  CalendarSystem: { getHour: () => hour, timeDebugSnapshot: () => ({ rawDay: day }) },
  DialogueContent: { getNpcDlgState: () => relation },
  WorldPopupText: { queueReward: (...args) => rewardLog.push(args) },
  NpcRapport: { adjust: (...args) => rapportLog.push(args) },
  requestAnimationFrame: callback => callback(),
  __farmLog() {},
};
contextWindow.window = contextWindow;
const context = vm.createContext({ window: contextWindow, fetch: contextWindow.fetch, console, Date, Math, Set, Map, Promise });
vm.runInContext(runtimeSource, context, { filename: 'porakaneki-camps-runtime.js' });

const combatDeps = {
  TILE: 60,
  player: { x: 26.5 * 60, y: 26 * 60 },
  calendar: { day },
  zoneLayouts: new Map([['map_western_slope', layout]]),
  zoneScenes: new Map(),
  EXTERIOR_ZONES: { map_western_slope: { cols: 64, rows: 64, entryCol: 2, entryRow: 2 } },
  WATERWAY_TYPES: new Set(['river', 'stream']),
  TileType: { PATH: 'path', RAMP: 'ramp', WATERFALL: 'waterfall', SHRUB: 'shrub', ROCK: 'rock' },
  HELD_SHAPE_DEFS: { fishingspear: { dmgType: 'sharp' }, hatchet: { dmgType: 'sharp' }, daggerSword: { dmgType: 'sharp' } },
  craftedToolItemKey: (shape, metal) => `${shape}_${metal}`,
  hostileObjects,
  getCurrentArea: () => currentArea,
  getActiveGrid: () => Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => ({ type: 'grass' }))),
  getActiveCols: () => 64,
  getActiveRows: () => 64,
  tileSurfaceYInArea: () => 0,
  characterGroundShadowSurfaceOffset: () => 0.01,
  moveCreatureToward(hunter, tx, ty, speed, dt) {
    const dx = tx - hunter.x, dy = ty - hunter.y, distance = Math.hypot(dx, dy); // Used to model the normal collision-aware movement seam cheaply.
    if (!distance) return;
    const step = Math.min(distance, speed * dt);
    hunter.x += dx / distance * step;
    hunter.y += dy / distance * step;
  },
  showToast() {},
};
assert.equal(contextWindow.BanditCombat.init(combatDeps), 'bandit-init');
assert.equal(contextWindow.NpcScheduling.init({ npcWalkers: [chief] }), 'schedule-init');

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

(async () => {
  await flush();
  const api = contextWindow.PorakanekiCamps;
  assert.equal(api.version, 1);
  assert.equal(api.__test.phaseForHour(2), 'sleep');
  assert.equal(api.__test.phaseForHour(7), 'hunt');
  assert.equal(api.__test.phaseForHour(12), 'camp');
  assert.equal(api.__test.phaseForHour(23), 'sleep');

  assert.equal(api.initializeReputation(), true);
  assert.equal(relation.favor, -3, 'fresh chief relationship becomes the tribe-wide -3 starting reputation');
  assert(relation.memory.some(entry => entry.event === 'porakaneki_faction_initialized'));
  api.initializeReputation();
  assert.equal(relation.favor, -3, 'starting reputation is not re-applied after its persistent memory marker exists');

  contextWindow.BanditCamps.updateCampBanners(0.21); // Off-zone tick still stamps the generated camp and makes the chief schedule authoritative.
  let debug = api.debugSnapshot();
  assert.equal(debug.stamped, true);
  assert.equal(debug.zoneId, 'map_western_slope');
  assert.equal(chief.rec.gender, 'male');
  assert.equal(chief.rec.appearance.speciesId, 'porakaneki');
  assert.equal(chief.rec.scheduleHooks.defaultMapId, 'map_western_slope');
  assert.equal(JSON.stringify(chief.rec.scheduleHooks.rules.map(rule => [rule.start, rule.end, rule.stationId])), JSON.stringify([
    ['22:00', '06:00', 'porakaneki_camp_sleep'],
    ['06:00', '10:00', 'porakaneki_camp_hunt'],
    ['10:00', '22:00', 'porakaneki_camp_fire'],
  ]));
  assert.equal(stations.length, 3);

  currentArea = 'map_western_slope';
  chief.area = currentArea;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  assert.equal(relation.favor, -2, 'first chief proximity greeting grants exactly +1 Porakaneki Favor');
  assert.equal(rapportLog.length, 1, 'greeting also uses the existing Rapport system');
  contextWindow.BanditCamps.updateCampBanners(0.21);
  assert.equal(relation.favor, -2, 'same game day cannot award greeting Favor twice');

  await flush();
  contextWindow.BanditCamps.updateCampBanners(0.21);
  await flush();
  contextWindow.BanditCamps.updateCampBanners(0.21);
  debug = api.debugSnapshot();
  assert.equal(debug.huntersCached, 3);
  assert.equal(JSON.stringify(debug.hunterWeapons), JSON.stringify(['fishingspear', 'hatchet', 'daggerSword']));
  const daggerHunter = hostileObjects.find(hunter => hunter.porakanekiWeaponShape === 'daggerSword');
  assert(daggerHunter._banditRangedToolHolder, 'dagger hunter receives a ranged holder for dual-role throwing');

  relation.favor = -3; // Reset only the number so violence threshold is tested from the authored initial baseline.
  const first = hostileObjects[0];
  first.health = 19;
  combatDeps.player.x = first.x;
  combatDeps.player.y = first.y;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  assert.equal(relation.favor, -5, 'first player-attributed hunter attack applies -2 and reaches attack-on-sight threshold');
  assert(hostileObjects.filter(hunter => hunter.health > 0).every(hunter => hunter.state === 'chase'), 'all surviving hunters become hostile at -5');

  first.health = 0;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  assert.equal(relation.favor, -7, 'killing a hunter applies the additional authored kill penalty');

  debug = api.debugSnapshot();
  assert.equal(debug.attackOnSight, true);
  assert.equal(debug.assaults, 1);
  assert.equal(debug.kills, 1);
  assert.equal(debug.greetings, 1);
  assert(rewardLog.length >= 3);

  console.log('Porakaneki camp regression checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
