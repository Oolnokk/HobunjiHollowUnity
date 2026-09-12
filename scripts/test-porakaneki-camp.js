const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const cfg = JSON.parse(fs.readFileSync('docs/config/porakaneki-camp.json', 'utf8')); // Authoritative camp/LOD/reputation tuning exercised below.
const locale = JSON.parse(fs.readFileSync('docs/config/locales/locale_porakaneki_camp_small.json', 'utf8')); // Real authored footprint used by the runtime stamp.
const localeIndex = JSON.parse(fs.readFileSync('docs/config/locales/index.json', 'utf8')); // Guards locale-editor/index discoverability.
const speciesOverrides = JSON.parse(fs.readFileSync('docs/config/npcs/species-overrides.json', 'utf8')); // Guards the male-only existing chief composition.
const runtimeSource = fs.readFileSync('docs/js/porakaneki-camps-runtime.js', 'utf8'); // Executed in a browser-shaped VM to exercise actual state/LOD transitions.
const houseLoader = fs.readFileSync('docs/js/house-pieces.js', 'utf8'); // Guards parser-time camp-runtime bootstrap.
const combatLoader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Guards the dual-role dagger bridge load.
const socialSource = fs.readFileSync('docs/js/npc-social-relationship-bridge-v2.js', 'utf8'); // Existing once-per-day gift/Rapport layer reused by the named chief.

assert.equal(cfg.schema, 'hobunji_porakaneki_camp.v2');
assert.equal(cfg.zoneId, 'map_western_slope');
assert.equal(cfg.localeId, 'locale_porakaneki_camp_small');
assert.equal(cfg.population.hunters, 3);
assert.deepEqual(cfg.equipment.weaponShapes, ['fishingspear', 'hatchet', 'daggerSword']);
assert.equal(cfg.behavior.fullSimulationChunkTiles, 10);
assert.equal(cfg.behavior.offChunkTickSeconds, 4);
assert.equal(cfg.reputation.initialFavor, -3);
assert.equal(cfg.reputation.minimumFavor, -5);
assert.equal(cfg.reputation.maximumFavor, 10);
assert.equal(cfg.reputation.attackOnSightFavor, -5);
assert.equal(cfg.reputation.greetingFavorThreshold, 1);
assert.equal(cfg.reputation.killPenalty, -1);
assert.deepEqual(cfg.schedule, { sleepStartHour: 22, wakeHour: 6 });
assert.deepEqual(cfg.reputation.initialWarnings, [
  'Go way. No want trouble',
  'This our spot, not yours. Leave.',
  'No want fight. Go way.',
]);
assert.deepEqual(cfg.reputation.escalationWarnings, [
  'Leave or we fight!',
  'We said go way. Go way. Now!',
]);
assert.deepEqual(locale.placement.allowedZones, ['map_western_slope']);
assert.equal(locale.objects.filter(object => object.kind === 'tent').length, 3);
assert(localeIndex.locales.some(entry => entry.id === cfg.localeId && entry.category === 'porakaneki_camp'));
assert.equal(speciesOverrides.npcs.porakaneki_chief.species, 'porakaneki');
assert.equal(speciesOverrides.npcs.porakaneki_chief.avatarExport.appearance.gender, 'male');
assert(houseLoader.includes("['PorakanekiCamps', 'porakaneki-camps-runtime.js?v=20260912c']"));
assert(combatLoader.includes("['js/combat/porakaneki-dagger-ranged.js?v=20260912a'"));
assert(socialSource.includes('canGiftToday'), 'chief gifting must retain the existing once-per-day social gate');
assert(socialSource.includes('window.NpcRapport'), 'chief gifting/dancing/liquor must retain the existing Rapport bridge');
assert(runtimeSource.includes("activity: 'break'"), 'chief daytime behavior must route through the new free-time activity planner rather than a fixed station');
assert(runtimeSource.includes("roles: ['porakaneki-sleep']"), 'night sleep must use a shared tent role instead of one permanently assigned tent');

let currentArea = 'town'; // Mutated to test off-zone, off-chunk, and same-chunk behavior separately.
let hour = 12; // Mutated by sleep assertions through CalendarSystem.getHour.
const day = 7; // Stable absolute day for daily greetings and sleep choices.
const relation = { favor: 0, memory: [] }; // Existing chief relationship record doubles as tribe reputation.
const rewardLog = []; // Captures permanent Favor changes; greeting should not add one.
const toastLog = []; // Captures non-reward greeting/warning feedback.
const hostileObjects = []; // Shared combat array receives only materialized same-chunk hunters.
const stations = []; // Captures shared sleep-role stations registered for the chief.
const chief = {
  rec: { id: 'porakaneki_chief', appearance: {}, scheduleHooks: {}, agenda: [{ id: 'placeholder' }] },
  area: 'town',
  root: { position: { x: 26.5, z: 26 } },
}; // Normal NPC walker proves the named chief remains in ordinary NPC systems.

const layout = {
  cols: 64,
  rows: 64,
  tiles: Array.from({ length: 64 * 64 }, (_, i) => ({ c: i % 64, r: Math.floor(i / 64), type: 'grass', elevTier: 0 })),
  buildings: [], dens: [], decor: [], furniture: [], transitions: [], rootTotems: [], localeInstances: [],
  toTownExit: { col: 2, row: 2 },
}; // Flat generated-zone stand-in consumed by buildZoneView.

function fakeStamp(view, localeDef, opts) {
  assert.equal(opts.clearableTypes.size, 0, 'Porakaneki camp must never bulldoze generated clutter');
  const id = opts.instanceId; // Matches TemporaryLocales' instance ownership field.
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
  return { visible: true, position: { set() {} }, parent: { remove() {} } }; // Minimal group fields touched by materialize/hide/teardown.
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
}; // Existing BanditCombat API stub proves random loadouts still build real combat-capable humanoids.
const npcScheduling = {
  init(deps) { this.deps = deps; return 'schedule-init'; },
  registerNpcStations(list) { stations.push(...list); },
}; // Existing scheduler API stub captures the shared sleep-role tent stations.
const banditCamps = { updateCampBanners() { return 'camp-tick'; } }; // Cheap game-loop seam wrapped by the runtime.

const contextWindow = {
  fetch: async url => ({ ok: true, status: 200, json: async () => String(url).includes('porakaneki-camp.json') ? cfg : locale }),
  BanditCombat: banditCombat,
  NpcScheduling: npcScheduling,
  BanditCamps: banditCamps,
  TemporaryLocales: { stamp: fakeStamp },
  CalendarSystem: { getHour: () => hour, timeDebugSnapshot: () => ({ rawDay: day }) },
  DialogueContent: { getNpcDlgState: () => relation },
  WorldPopupText: { queueReward: (...args) => rewardLog.push(args) },
  NpcSocialStimuli: { strongestNear: () => null },
  __farmLog() {},
};
contextWindow.window = contextWindow;
const context = vm.createContext({ window: contextWindow, fetch: contextWindow.fetch, console, Date, Math, Set, Map, Promise });
vm.runInContext(runtimeSource, context, { filename: 'porakaneki-camps-runtime.js' });

// Random sequence is arranged so weapon rolls (every fourth draw during
// abstract-hunter creation) are dagger, dagger, spear. That proves loadouts
// are independent random samples and duplicates are legal rather than a
// hardcoded one-of-each assignment.
const randomValues = [
  0.20, 0.30, 0.90, 0.10,
  0.40, 0.50, 0.90, 0.20,
  0.60, 0.70, 0.10, 0.30,
  0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95,
];
let randomIndex = 0;
const combatDeps = {
  TILE: 60,
  player: { x: 60 * 60, y: 60 * 60 }, // Far from camp at first: no hunter should materialize despite sharing the same zone later.
  calendar: { day },
  rnd: () => randomValues[(randomIndex++) % randomValues.length],
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
    const dx = tx - hunter.x, dy = ty - hunter.y, distance = Math.hypot(dx, dy); // Cheap stand-in for the normal collision-aware movement helper.
    if (!distance) return;
    const step = Math.min(distance, speed * dt);
    hunter.x += dx / distance * step;
    hunter.y += dy / distance * step;
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

(async () => {
  await flush();
  const api = contextWindow.PorakanekiCamps;
  assert.equal(api.version, 2);
  assert.equal(api.__test.isSleepingHour(2), true);
  assert.equal(api.__test.isSleepingHour(7), false);
  assert.equal(api.__test.isSleepingHour(23), true);
  assert.deepEqual(JSON.parse(JSON.stringify(api.__test.chunkOf(26, 26))), { x: 2, y: 2 });

  assert.equal(api.initializeReputation(), true);
  assert.equal(relation.favor, -3, 'fresh chief relationship becomes the tribe-wide -3 starting reputation');
  assert(relation.memory.some(entry => entry.event === 'porakaneki_faction_initialized'));
  api.initializeReputation();
  assert.equal(relation.favor, -3, 'starting reputation is not re-applied after its memory marker exists');

  contextWindow.BanditCamps.updateCampBanners(0.21); // Off-zone tick stamps camp, authors chief planner agenda, and creates abstract hunter identities only.
  let debug = api.debugSnapshot();
  assert.equal(debug.stamped, true);
  assert.equal(debug.zoneId, 'map_western_slope');
  assert.equal(chief.rec.gender, 'male');
  assert.equal(chief.rec.appearance.speciesId, 'porakaneki');
  assert.equal(chief.rec.scheduleHooks.defaultMapId, 'map_western_slope');
  assert.equal(chief.rec.scheduleHooks.rules.length, 0, 'chief must not be bound to fixed daytime schedule stations');
  assert.equal(JSON.stringify(chief.rec.agenda.map(beat => [beat.id, beat.activity])), JSON.stringify([
    ['porakaneki_sleep_late', 'goToRole'],
    ['porakaneki_sleep_early', 'goToRole'],
    ['porakaneki_day', 'break'],
  ]));
  assert.equal(stations.length, 3);
  assert(stations.every(station => station.roles.includes('porakaneki-sleep')), 'all tents are equivalent sleep choices');
  assert.equal(JSON.stringify(debug.hunters.map(hunter => hunter.weapon)), JSON.stringify(['daggerSword', 'daggerSword', 'fishingspear']), 'weapon selection is independent and may duplicate');
  assert.equal(hostileObjects.length, 0, 'off-zone abstract hunters do not allocate combat entities');

  currentArea = 'map_western_slope';
  chief.area = currentArea;
  contextWindow.BanditCamps.updateCampBanners(4.1); // Player is still in a far chunk: only the coarse abstract simulation should run.
  debug = api.debugSnapshot();
  assert.equal(debug.coarseTicks, 1);
  assert.equal(hostileObjects.length, 0, 'different-chunk hunters remain abstract even while player shares the wilderness zone');
  assert(debug.hunters.every(hunter => hunter.materialized === false));

  // Positive reputation causes a greeting, but greeting itself is social
  // presentation only — it must not manufacture Favor or Rapport.
  relation.favor = 1;
  combatDeps.player.x = chief.root.position.x * combatDeps.TILE;
  combatDeps.player.y = chief.root.position.z * combatDeps.TILE;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  assert.equal(relation.favor, 1, 'greeting at Favor >= 1 does not change permanent reputation');
  assert.equal(rewardLog.length, 0, 'greeting emits no Favor reward');
  assert(toastLog.some(entry => /chief greets you/i.test(entry.text)));

  // Move into the first hunter's actual chunk. Only now should the expensive
  // humanoid entity/portrait be built, while hunters in other chunks stay abstract.
  debug = api.debugSnapshot();
  const firstAbstract = debug.hunters[0];
  combatDeps.player.x = firstAbstract.x * combatDeps.TILE;
  combatDeps.player.y = firstAbstract.y * combatDeps.TILE;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  await flush();
  contextWindow.BanditCamps.updateCampBanners(0.21);
  await flush();
  debug = api.debugSnapshot();
  assert(hostileObjects.length >= 1, 'same-chunk hunter materializes into the real combat pipeline');
  assert(debug.hunters.some(hunter => hunter.fullSimulation && hunter.materialized));
  const daggerEntity = hostileObjects.find(entity => entity.porakanekiWeaponShape === 'daggerSword');
  assert(daggerEntity?._banditRangedToolHolder, 'a randomly rolled dagger remains melee-capable and gets the thrown-ranged holder');

  // Once a materialized hunter leaves the player's chunk it must keep moving
  // as an abstract agent. Its stale hidden entity transform must not overwrite
  // the coarse position on each later off-chunk tick.
  const firstMaterializedEntity = hostileObjects.find(entity => entity.porakanekiHunterIndex === firstAbstract.index);
  assert(firstMaterializedEntity, 'first abstract hunter has a materialized entity before the LOD-collapse regression');
  combatDeps.player.x = 60 * combatDeps.TILE;
  combatDeps.player.y = 60 * combatDeps.TILE;
  contextWindow.BanditCamps.updateCampBanners(4.1);
  let collapsed = api.debugSnapshot().hunters.find(hunter => hunter.index === firstAbstract.index);
  assert.equal(collapsed.visible, false, 'leaving the chunk hides the detailed entity');
  const collapsedOnce = [collapsed.x, collapsed.y];
  contextWindow.BanditCamps.updateCampBanners(4.1);
  collapsed = api.debugSnapshot().hunters.find(hunter => hunter.index === firstAbstract.index);
  assert.notDeepEqual([collapsed.x, collapsed.y], collapsedOnce, 'a dormant materialized hunter continues coarse abstract travel instead of snapping back to its stale entity transform');

  // Re-enter that hunter's current abstract chunk before violence checks;
  // rematerialization must occur at the coarse position rather than its old one.
  combatDeps.player.x = collapsed.x * combatDeps.TILE;
  combatDeps.player.y = collapsed.y * combatDeps.TILE;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  await flush();
  contextWindow.BanditCamps.updateCampBanners(0.21);
  assert.equal(firstMaterializedEntity.avatarRef.group.visible, true, 'returning to the hunter chunk restores full simulation');

  // Hurting a hunter provokes immediate self-defense but does not change the
  // permanent tribe score. Killing one applies exactly -1 and clamps at -5.
  relation.favor = -3;
  const firstEntity = firstMaterializedEntity;
  firstEntity.health = 19;
  combatDeps.player.x = firstEntity.x;
  combatDeps.player.y = firstEntity.y;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  assert.equal(relation.favor, -3, 'an attack alone does not permanently deduct Porakaneki Favor');
  assert.equal(api.debugSnapshot().provoked, true, 'attack opens a temporary group self-defense window');
  assert.equal(firstEntity.state, 'chase');

  firstEntity.health = 0;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  assert.equal(relation.favor, -4, 'one player-attributed Porakaneki death costs exactly one Favor');

  // A second kill reaches the authored minimum. Materialize another hunter
  // by entering its chunk if necessary, then verify -5 attack-on-sight.
  debug = api.debugSnapshot();
  const secondAbstract = debug.hunters.find(hunter => hunter.health !== 0 && hunter.index !== firstEntity.porakanekiHunterIndex);
  combatDeps.player.x = secondAbstract.x * combatDeps.TILE;
  combatDeps.player.y = secondAbstract.y * combatDeps.TILE;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  await flush();
  contextWindow.BanditCamps.updateCampBanners(0.21);
  await flush();
  const secondEntity = hostileObjects.find(entity => entity.health > 0 && entity.porakanekiHunterIndex === secondAbstract.index);
  assert(secondEntity, 'second hunter materializes when its chunk becomes relevant');
  secondEntity.health = 0;
  combatDeps.player.x = secondEntity.x;
  combatDeps.player.y = secondEntity.y;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  assert.equal(relation.favor, -5, 'second kill reaches, but cannot pass, the -5 minimum');
  debug = api.debugSnapshot();
  assert.equal(debug.attackOnSight, true);
  assert.equal(debug.kills, 2);
  assert.equal(rewardLog.length, 2, 'only the two kills emitted permanent Favor rewards');

  console.log('Porakaneki camp regression checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
