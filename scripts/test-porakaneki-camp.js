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
const porakanekiTentExport = JSON.parse(fs.readFileSync('docs/config/pieces/porakaneki-tent.json', 'utf8')); // Preserved full-size House Editor export remains available outside hunting camps.
const huntingTentExport = JSON.parse(fs.readFileSync('docs/config/pieces/porakaneki-hunting-tent.json', 'utf8')); // Dedicated 2x2 half-height hunting-camp shelter under test.
const banditTentExport = JSON.parse(fs.readFileSync('docs/config/pieces/bandit-tent.json', 'utf8')); // Full House Editor export supplied for the bandit shelter.
const porakanekiTent = porakanekiTentExport.currentPiece || porakanekiTentExport; // Runtime/editor compatibility accepts wrapped or flat piece JSON.
const huntingTent = huntingTentExport.currentPiece || huntingTentExport; // Runtime/editor compatibility for the new camp-only shelter.
const banditTent = banditTentExport.currentPiece || banditTentExport; // Runtime/editor compatibility accepts wrapped or flat piece JSON.
const banditLocale = JSON.parse(fs.readFileSync('docs/config/locales/locale_bandit_camp_small.json', 'utf8')); // Bandit collision footprint follows the authored 2x3 piece.
const assetIndex = JSON.parse(fs.readFileSync('docs/assets/index.json', 'utf8')); // House Editor repo picker discoverability.
const banditRuntimeSource = fs.readFileSync('docs/js/bandit-camps.js', 'utf8'); // Bandit camps must render the authored piece instead of procedural cone geometry.
const housePieceGenSource = fs.readFileSync('docs/js/HousePieceGen.js', 'utf8'); // Guards semantic door-opening depth bias shared by authored tents.
const gameIndexSource = fs.readFileSync('docs/index.html', 'utf8'); // Guards cache-busted runtime loading of the shared HousePiece renderer.
const combatBanditSource = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8'); // Guards the shared bandit-like avatar builder's explicit body-color override handoff.
const devSpawnerSource = fs.readFileSync('docs/js/dev-spawner.js', 'utf8'); // Guards Testing Arena Porakaneki selecting from the same finite authored body swatches.
const ZONES = [
  'map_northern_cliffs',
  'map_southern_cloud_forest',
  'map_western_slope',
  'map_eastern_mire',
];

assert.equal(cfg.schema, 'hobunji_porakaneki_camp.v3');
assert.deepEqual(cfg.wildernessZones, ZONES);
assert.equal(cfg.smallCamps.minPerZone, 1);
assert.equal(cfg.smallCamps.maxPerZone, 1);
assert.equal(cfg.smallCamps.huntingPartiesMinPerZone, 2);
assert.equal(cfg.smallCamps.huntingPartiesMaxPerZone, 4);
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
assert.equal(cfg.behavior.fullSimulationRadiusTiles, 18);
assert.equal(cfg.behavior.fullSimulationReleaseRadiusTiles, 24);
assert(cfg.behavior.fullSimulationReleaseRadiusTiles > cfg.behavior.fullSimulationRadiusTiles, 'LOD hysteresis must have a wider release radius than enter radius');
assert.equal(cfg.behavior.offChunkTickSeconds, 4);
assert.equal(cfg.behavior.denHuntGroupMin, 2);
assert.equal(cfg.behavior.denHuntGroupMax, 3);
assert.equal(cfg.behavior.denHuntFormationRadiusTiles, 1.15);
assert.equal(cfg.behavior.denHuntArrivalRadiusTiles, 2.5);
assert.equal(cfg.behavior.denHuntDwellMinSeconds, 4);
assert.equal(cfg.behavior.denHuntDwellMaxSeconds, 8);
assert.equal(cfg.behavior.huntRadiusMinTiles, undefined, 'legacy solo random-radius hunting is removed in favor of den patrol parties');
assert.equal(cfg.behavior.huntRadiusMaxTiles, undefined, 'legacy solo random-radius hunting is removed in favor of den patrol parties');
assert.equal(cfg.behavior.activityWeights.hunt, undefined, 'legacy solo hunt activity weight is removed because den hunting is party-owned');
assert.equal(cfg.reputation.initialFavor, -3);
assert.equal(cfg.reputation.minimumFavor, -5);
assert.equal(cfg.reputation.killPenalty, 0, 'legacy blanket kill penalty stays disabled in favor of context-specific penalties');
assert.equal(cfg.reputation.selfDefenseKillPenalty, -1);
assert.equal(cfg.reputation.murderKillPenalty, -3);
function assertTentsFaceFire(locale, label) {
  const fire = locale.objects.find(object => object.key === 'bonfire'); // Central target each authored tent must face.
  assert(fire, `${label} has a bonfire`);
  const fireCenterX = fire.col + fire.w * 0.5; // Used to compute the normalized tent-to-fire direction.
  const fireCenterZ = fire.row + fire.h * 0.5; // Used with fireCenterX for facing checks in locale grid space.
  for (const tent of locale.objects.filter(object => object.kind === 'tent')) {
    const tentCenterX = tent.col + tent.w * 0.5; // Runtime group center of this 2x2 shelter.
    const tentCenterZ = tent.row + tent.h * 0.5; // Runtime group center paired with tentCenterX.
    const dx = fireCenterX - tentCenterX; // Direction toward the center fire on the locale X axis.
    const dz = fireCenterZ - tentCenterZ; // Direction toward the center fire on the locale Z/row axis.
    const distance = Math.hypot(dx, dz); // Normalizes the direction before comparing it to authored yaw.
    const yaw = Number(tent.rot || 0) * Math.PI / 180; // HousePieceGen rotation convention: 0 faces +row, +90 faces +col.
    const dot = Math.sin(yaw) * (dx / distance) + Math.cos(yaw) * (dz / distance); // 1 means the tent doorway faces exactly at the fire.
    assert(dot > 0.999, `${label} ${tent.id} faces its bonfire (dot=${dot.toFixed(4)})`);
  }
}
assertTentsFaceFire(smallLocale, 'small camp');
assertTentsFaceFire(chiefLocale, 'chief camp');

assert.deepEqual(smallLocale.placement.allowedZones, ZONES);
assert.equal(smallLocale.placement.maxInstances, 1);
assert.equal(smallLocale.meta.namedNpcs, false);
assert.deepEqual(chiefLocale.placement.allowedZones, ZONES);
assert.equal(chiefLocale.placement.maxInstances, 1);
assert.equal(chiefLocale.meta.namedNpc, 'porakaneki_chief');
assert.equal(smallLocale.objects.filter(object => object.kind === 'tent').length, 3, 'small hunting camp keeps three shelters around its open center');
assert.equal(chiefLocale.objects.filter(object => object.kind === 'tent').length, 8, 'chief camp keeps a full eight-tent ring');
assert(smallLocale.objects.filter(object => object.kind === 'tent').every(object => object.w === 2 && object.h === 2), 'every small-camp hunting tent reserves its authored 2x2 footprint');
assert(chiefLocale.objects.filter(object => object.kind === 'tent').every(object => object.w === 2 && object.h === 2), 'every chief-camp hunting tent reserves its authored 2x2 footprint');
assert.deepEqual(
  smallLocale.objects.filter(object => object.key === 'bonfire').map(object => [object.w, object.h]),
  [[2, 2]],
  'small camp uses exactly one shared 2x2 bonfire',
);
assert.deepEqual(
  chiefLocale.objects.filter(object => object.key === 'bonfire').map(object => [object.w, object.h]),
  [[2, 2]],
  'chief camp uses exactly one shared 2x2 council bonfire',
);
assert.equal(smallLocale.objects.filter(object => object.key === 'benchlog').length, 2, 'small camp reuses two wild benchlogs');
assert.equal(chiefLocale.objects.filter(object => object.key === 'benchlog').length, 4, 'chief camp reuses four wild benchlogs');
assert(banditLocale.objects.filter(object => object.kind === 'tent').every(object => object.w === 2 && object.h === 3), 'bandit collision/loot footprints must match the authored 2x3 tent piece');
assert.equal(porakanekiTentExport.schema, 'modular-house-piece-author/v38', 'Porakaneki tent should remain a loadable full House Editor export');
assert.equal(banditTentExport.schema, 'modular-house-piece-author/v38', 'Bandit tent should remain a loadable full House Editor export');
assert.equal(porakanekiTent.base.height, 2.55, 'Porakaneki tent stays 50% taller than the 1.7-tile bandit tent');
assert.equal(porakanekiTent.footprint.cells.length, 9, 'Porakaneki tent House Editor footprint is exactly 3x3');
assert.equal(porakanekiTent.base.faces.length, 8, 'Porakaneki square-taper shell keeps its authored eight-panel topology');
assert.equal(huntingTentExport.schema, 'modular-house-piece-author/v38', 'hunting tent stays loadable in the same House Editor format');
assert.equal(huntingTent.base.height, 1.275, 'hunting-camp tent is exactly half the full 2.55-tile height');
assert.equal(huntingTent.footprint.cells.length, 4, 'hunting-camp tent House Editor footprint is exactly 2x2');
assert.equal(huntingTent.base.faces.length, 8, 'scaled hunting tent retains the authored eight-panel square-taper topology');
const poraVertices = porakanekiTent.base.faces.flatMap(face => face.v);
const poraBottom = poraVertices.filter(vertex => Math.abs(vertex[1]) < 1e-9);
const poraTop = poraVertices.filter(vertex => Math.abs(vertex[1] - 2.55) < 1e-9);
const span = (vertices, axis) => Math.max(...vertices.map(vertex => vertex[axis])) - Math.min(...vertices.map(vertex => vertex[axis]));
assert(Math.abs(span(poraBottom, 0) - 3) < 1e-9, 'Porakaneki tent base X span is 3 tiles');
assert(Math.abs(span(poraBottom, 2) - 3) < 1e-9, 'Porakaneki tent base Z span is 3 tiles');
assert(Math.abs(span(poraTop, 0) - 1.5) < 1e-9, 'Porakaneki tent square top is half the base X span');
assert(Math.abs(span(poraTop, 2) - 1.5) < 1e-9, 'Porakaneki tent square top is half the base Z span');
const huntingVertices = huntingTent.base.faces.flatMap(face => face.v); // Used below to prove the scaled camp shelter is 2x2 with a 1x1 square top.
const huntingBottom = huntingVertices.filter(vertex => Math.abs(vertex[1]) < 1e-9); // Ground-ring vertices used for the authored footprint span checks.
const huntingTop = huntingVertices.filter(vertex => Math.abs(vertex[1] - 1.275) < 1e-9); // Peak-ring vertices used for half-width taper checks.
assert(Math.abs(span(huntingBottom, 0) - 2) < 1e-9, 'hunting tent base X span is exactly 2 tiles');
assert(Math.abs(span(huntingBottom, 2) - 2) < 1e-9, 'hunting tent base Z span is exactly 2 tiles');
assert(Math.abs(span(huntingTop, 0) - 1) < 1e-9, 'hunting tent square top remains half the base X span');
assert(Math.abs(span(huntingTop, 2) - 1) < 1e-9, 'hunting tent square top remains half the base Z span');
assert.equal(banditTent.base.height, 1.7, 'Bandit tent keeps the authored Researcher-style 1.7-tile height');
assert.equal(banditTent.footprint.cells.length, 6, 'Bandit tent House Editor footprint is exactly 2x3');
assert.equal(banditTent.base.faces.length, 8, 'Bandit tent keeps the authored A-frame eight-panel topology');
assert(assetIndex.housePieces.some(entry => entry.path === 'config/pieces/bandit-tent.json' && entry.category === 'tent'), 'Bandit Tent must be available in the House Editor repo picker');
assert(assetIndex.housePieces.some(entry => entry.path === 'config/pieces/porakaneki-tent.json' && entry.category === 'tent'), 'original Porakaneki Tent must remain available in the House Editor repo picker');
assert(assetIndex.housePieces.some(entry => entry.path === 'config/pieces/porakaneki-hunting-tent.json' && entry.category === 'tent'), 'Porakaneki Hunting Tent must be available in the House Editor repo picker');
assert(runtimeSource.includes("tentPieceUrl: 'config/pieces/porakaneki-hunting-tent.json'"), 'Porakaneki camp runtime must load the dedicated 2x2 hunting tent');
assert(runtimeSource.includes("const BENCHLOG_KEY = 'benchlog'"), 'camp runtime must reuse the authored wilderness sitting log');
assert(runtimeSource.includes("const BONFIRE_KEY = 'bonfire'"), 'camp runtime must use the large shared bonfire key');
assert(runtimeSource.includes('HousePieceGen.buildGroupFromPiece'), 'Porakaneki runtime must render through HousePieceGen');
assert.match(housePieceGenSource, /mesh\.userData\.housePieceFaceTag = f\.tag[\s\S]{0,450}f\.tag === 'doorOpening'[\s\S]{0,450}mat\.polygonOffsetFactor = 2/, 'authored dark door-opening faces are identified and depth-biased behind their cloth border');
assert(/HousePieceGen\.js\?v=[A-Za-z0-9_.-]+/.test(gameIndexSource), 'game runtime cache-busts the shared tent clipping fix');
assert(banditRuntimeSource.includes("const BANDIT_TENT_PIECE_URL = 'config/pieces/bandit-tent.json'"), 'Bandit runtime must load the authored bandit tent clone');
assert(banditRuntimeSource.includes('HousePieceGen.buildGroupFromPiece'), 'Bandit runtime must render through HousePieceGen');
assert(!banditRuntimeSource.includes('buildBanditTentCanvasGeometry'), 'old procedural five-sided bandit tent geometry must stay removed');
assert.deepEqual(cfg.equipment.weaponShapes, ['fishingspear', 'hatchet', 'dagger'], 'Porakaneki must use the true dagger shape, never daggerSword');
assert(localeIndex.locales.some(entry => entry.id === 'locale_porakaneki_camp_small'));
assert(localeIndex.locales.some(entry => entry.id === 'locale_porakaneki_camp_chief' && entry.singleton === true));
assert(/porakaneki-camps-runtime\.js\?v=[A-Za-z0-9_.-]+/.test(houseLoader));
assert(runtimeSource.includes("bodyColorsForSeed: seed => window.HobunjiPorakanekiSpecies?.bodyColorsForSeed?.(seed, 'male') || null") && runtimeSource.includes('bodyColorsOverride: tribe.bodyColorsForSeed?.(hunter.id) || null'), 'camp residents must choose an authored Mashtzarr swatch only when materializing their avatar');
const bodyColorWriteIndex = combatBanditSource.indexOf('roster.appearance.bodyColors = opts.bodyColorsOverride'); // Used with avatar-build ordering below to ensure explicit finite colors reach the portrait before raster work begins.
const banditAvatarBuildIndex = combatBanditSource.indexOf('const avatarRef = await buildQueuedBanditAvatar(roster, opts.zoneId);'); // Must occur after the explicit body-color assignment.
assert(bodyColorWriteIndex >= 0 && banditAvatarBuildIndex > bodyColorWriteIndex, 'BanditCombat must apply explicit body colors before portrait generation');
assert(!combatBanditSource.includes('opts.appearanceSeed'), 'Porakaneki color variation must not randomize the whole portrait profile or create continuous body tint-cache keys');
assert(devSpawnerSource.includes('window.HobunjiPorakanekiSpecies?.bodyColorsForSeed?.(`dev-porakaneki:'), 'Testing Arena Porakaneki must use the same bounded authored swatch helper');
assert(socialSource.includes('canGiftToday'), 'chief gifting must retain the ordinary once-per-day NPC gate');
assert(socialSource.includes('window.NpcRapport'), 'chief must retain the ordinary Rapport bridge');
assert(runtimeSource.includes("activity: 'break'"), 'chief daytime behavior must remain free-time planner driven');
assert(runtimeSource.includes('function ensureHuntingParty(camp)') && runtimeSource.includes("hunter.activity = 'hunt-den'"), 'camp residents must form explicit den-hunting parties rather than solo random hunt targets');
assert(runtimeSource.includes('function occupiedSites(zoneId)') && runtimeSource.includes('occupiedSites,'), 'runtime must expose exact active camp footprints so relocated dens cannot spawn through Porakaneki camps');
assert(runtimeSource.includes("dens.length > 1 ? dens.filter(den => String(den.id) !== String(party.denId)) : dens"), 'den patrols must pick a different specific den when more than one den exists');
assert(runtimeSource.includes('Targets only exterior walkable tiles; hunters never invoke den transitions or enter cavern maps.'), 'den patrol destinations must remain outside den interiors');
assert(!runtimeSource.includes("if (activity === 'hunt') hunter.target = randomPointAround"), 'legacy solo random-radius hunting target must stay removed');
assert(runtimeSource.includes('for (const zoneId of (cfg.wildernessZones || []))'), 'runtime must build camps across every configured wilderness zone');
assert(runtimeSource.includes("entity.state = 'return'"), 'neutral Porakaneki must delegate actual travel/rendering to the shared hostile return/home path');
assert(runtimeSource.includes("const SCHEDULER_ID = `${KEY}-camps-runtime`") && runtimeSource.includes("id: 'porakaneki'"), 'Porakaneki planner exposes a stable shared-frame scheduler id');
assert(runtimeSource.includes('window.RuntimeFrameScheduler.register(SCHEDULER_ID') && runtimeSource.includes("phase: 'pre-game'"), 'production Porakaneki planner runs from the shared pre-game scheduler before hostile AI');
assert(runtimeSource.includes("if (!installRuntimeTick())") && runtimeSource.includes("state.tickOwner = 'BanditCamps-fallback'"), 'isolated contexts without RuntimeFrameScheduler retain the legacy BanditCamps wrapper fallback');
assert(runtimeSource.includes('state.updateTicks += 1'), 'planner cadence increments a mobile-visible tick counter whenever a real planner step executes');
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
    buildings: [],
    dens: [
      { id: 'animalDen_0', x: 8, y: 70, w: 4, h: 4, mouthAnchor: { x: 10, y: 75 } },
      { id: 'animalDen_1', x: 70, y: 8, w: 4, h: 4, mouthAnchor: { x: 74, y: 10 } },
      { id: 'animalDen_2', x: 70, y: 70, w: 4, h: 4, mouthAnchor: { x: 72, y: 75 } },
      { id: 'animalDen_3', x: 40, y: 80, w: 4, h: 4, mouthAnchor: { x: 42, y: 85 }, isAnimalDen: false }, // A cave with no animal den (js/cave-site-system.js): never a hunting target.
    ],
    decor: [], furniture: [], transitions: [], rootTotems: [], localeInstances: [],
    toTownExit: { col: 2, row: 2 },
  };
}
const zoneLayouts = new Map(ZONES.map(zoneId => [zoneId, makeLayout()]));

function fakeStamp(view, localeDef, opts) {
  const instanceId = String(opts.instanceId || '');
  const forceMinimumRecovery = instanceId.startsWith('porakaneki_small_map_northern_cliffs_') && !instanceId.endsWith('_minimum'); // Simulates a zone where every ordinary hunting-camp placement attempt fails.
  if (forceMinimumRecovery) return null;
  view.__stampSeq = (view.__stampSeq || 0) + 1;
  const seq = view.__stampSeq;
  const isChief = localeDef.id === 'locale_porakaneki_camp_chief';
  const width = localeDef.cols, height = localeDef.rows; // Test stamp mirrors the authored locale footprint instead of stale pre-redesign dimensions.
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
      rot: object.rot || 0, // Runtime bench/tent facing uses the stamped object's authored yaw.
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
  discardEntity(entity) { entity?.avatarRef?.dispose?.(); }, // Runtime fixture implements the canonical full-entity disposal dependency.
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
const tentCollisionProviders = new Map(); // Captures registered tribe tent collision providers for movement/projectile and migration checks.

const contextWindow = {
  fetch: async url => {
    const value = String(url);
    const payload = value.includes('porakaneki-hunting-tent.json') ? huntingTentExport : value.includes('porakaneki-tent.json') ? porakanekiTentExport : value.includes('porakaneki-camp.json') ? cfg : value.includes('chief') ? chiefLocale : smallLocale;
    return { ok: true, status: 200, json: async () => payload };
  },
  BanditCombat: banditCombat,
  NpcScheduling: npcScheduling,
  BanditCamps: banditCamps,
  AreaFootprintBlockers: {
    register(id, provider) { tentCollisionProviders.set(id, provider); return () => tentCollisionProviders.delete(id); },
  },
  TemporaryLocales: { stamp: fakeStamp },
  CalendarSystem: {
    getHour: () => hour,
    timeDebugSnapshot: () => ({ rawDay: day }),
    yearNumber: () => 1,
    tothalCycle: () => 1,
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
  assert.equal(api.version, 8);
  const rawRockLayout = { cols: 5, rows: 5, tiles: [ // Generated wilderness may not have created its live-grid rockKind/boulderId yet.
    { c: 0, r: 0, type: 'rock', generatedObjectType: 'undiggableBoulder', generatedObjectId: 'source-boulder' },
    { c: 1, r: 0, type: 'rock', generatedObjectType: 'undiggableBoulder', generatedObjectId: 'source-boulder' },
    { c: 2, r: 0, type: 'rock' }, // An untyped rock cliff is not a replaceable resource.
    { c: 3, r: 0, type: 'grass', mapBoundary: true },
    { c: 4, r: 0, type: 'rock', rockKind: 'diggableRockOre', generatedObjectId: 'source-ore' },
    { c: 1, r: 1, type: 'rock', rockKind: 'undiggableBoulder', boulderId: 'map-prefixed:boulder' },
  ], buildings: [], dens: [], decor: [], furniture: [], transitions: [], rootTotems: [], localeInstances: [] };
  const rawRockView = api.__test.buildZoneView('map_western_slope', rawRockLayout); // Validates real camp placement metadata against pre-merged generator output.
  assert.equal(rawRockView.tiles[0][0].rockKind, 'undiggableBoulder');
  assert.equal(rawRockView.tiles[0][0].boulderId, 'source-boulder', 'unmerged generator rock identities survive into camp placement');
  assert.equal(rawRockView.tiles[0][1].boulderId, 'source-boulder', 'multiple tiles of one boulder share the same removal identity');
  assert.equal(rawRockView.tiles[1][1].boulderId, 'map-prefixed:boulder', 'live-grid boulder IDs take priority when already available');
  assert.equal(rawRockView.tiles[0][2].occupiedBy?.includes('natural_cliff'), true, 'unidentified cliff rock cannot be bulldozed as ordinary camp clutter');
  assert.equal(rawRockView.tiles[0][3].borderEscarpment, true, 'boundary escarpments remain forbidden camp footprint tiles');
  assert.equal(rawRockView.tiles[0][4].occupiedBy?.includes('clutter'), true, 'ordinary identified resource rocks remain replaceable');

  let outlinedLayer = null; // Captures the render layer enabled by the camp outline helper under test.
  api.__test.markOutline({
    traverse(visitor) {
      visitor({ isMesh: true, userData: {}, layers: { enable(layer) { outlinedLayer = layer; } } });
    },
  });
  assert.equal(outlinedLayer, 1, 'camp prop outline helper enables the shared outline render layer without relying on an undefined outer-scope function');
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
  assert.equal(debug.version, 8);
  assert.equal(debug.fullSimulationRadiusTiles, 18);
  assert.equal(debug.fullSimulationReleaseRadiusTiles, 24);
  assert.equal(Object.keys(debug.zones).length, 4);
  assert.equal(debug.totalSmallCamps, ZONES.length, 'each wilderness map has exactly one Porakaneki hunting camp, including minimum-recovery zones');
  for (const zoneId of ZONES) {
    if (zoneId === 'map_northern_cliffs') {
      assert.equal(debug.zones[zoneId].smallCampCount, 1, `${zoneId} recovers to exactly the hard one-camp minimum after all ordinary placements fail`);
      assert(debug.zones[zoneId].camps.some(camp => camp.id === 'porakaneki_small_map_northern_cliffs_minimum'), 'minimum recovery creates the dedicated fallback camp instance');
    } else {
      assert.equal(debug.zones[zoneId].smallCampCount, 1, `${zoneId} has exactly one ordinary hunting camp`);
    }
    assert.equal(debug.zones[zoneId].chiefReserved, true, `${zoneId} reserves a valid future chief-camp site`);
    for (const camp of debug.zones[zoneId].camps.filter(camp => camp.kind === 'small')) {
      const oldCohorts = api.__test.historicalHuntingCohortsForZone(zoneId); // Uses each former 2–4-camp population roll to validate the consolidated count.
      assert(oldCohorts.length >= 2 && oldCohorts.length <= 4, 'one physical camp retains the previous 2–4 independent hunting cohorts');
      assert.deepEqual(camp.cohortSizes, oldCohorts, 'each cohort exactly preserves the population of its former physical camp');
      assert.equal(camp.residents, oldCohorts.reduce((sum, count) => sum + count, 0), 'one camp contains the same total number of ordinary hunters as before');
      assert.equal(camp.hunters.length, camp.residents, 'every consolidated hunter is spawned exactly once');
      assert.equal(camp.huntingParties.length, oldCohorts.length, 'all former Porakaneki camps retain their own awake hunting parties');
      const memberIds = new Set(); // Detects accidental double-assignment across independent den parties.
      for (const party of camp.huntingParties) {
        assert(party.memberCount >= 2 && party.memberCount <= 3, 'Porakaneki parties retain their previous 2–3 hunter group size');
        const den = zoneLayouts.get(zoneId).dens.find(entry => String(entry.id) === String(party.denId));
        assert(den, 'each party owns a specific authored den');
        assert.notEqual(den.isAnimalDen, false, 'hunting parties only target caves an animal den lives in');
        const t = party.target;
        const insideDen = t.col >= den.x && t.col < den.x + den.w && t.row >= den.y && t.row < den.y + den.h;
        assert.equal(insideDen, false, 'each party targets a point outside its den footprint');
        const assigned = camp.hunters.filter(hunter => hunter.huntPartyId === party.id);
        assert.equal(assigned.length, party.memberCount, 'each party has a distinct assigned membership');
        for (const hunter of assigned) {
          assert(!memberIds.has(hunter.index), 'a hunter cannot belong to two parties simultaneously');
          memberIds.add(hunter.index);
          assert.equal(hunter.huntDenId, party.denId, 'every member travels toward its own party den');
          assert.equal(hunter.activity, 'hunt-den');
        }
      }
    }
  }
  assert.equal(api.__test.MIN_HUNTING_CAMPS_PER_ZONE, 1, 'runtime exposes the hard hunting-camp floor used by generation and bandit conflict resolution');
  assert.equal(debug.chiefZoneId, 'map_southern_cloud_forest');
  const tentCollision = tentCollisionProviders.get('porakaneki-camp-tents:map_southern_cloud_forest'); // Provider tracks current active tents rather than stale off-season reservations.
  assert(tentCollision, 'Porakaneki and Omgurku runtime registers physical tent blockers for wilderness');
  assert.equal(tentCollision.area, 'map_southern_cloud_forest');
  const authoredChiefTent = chiefLocale.objects.find(prop => prop.kind === 'tent'); // Fake chief camp stamp uses its exact authored 2x2 shelter.
  const tentWorldCol = 4 + authoredChiefTent.col + 1;
  const tentWorldRow = 4 + authoredChiefTent.row + 1;
  const wallCol = 4 + authoredChiefTent.col + 0.09; // Canvas corner is always structurally solid regardless of which wall owns the entrance.
  const wallRow = 4 + authoredChiefTent.row + 0.09; // Paired with wallCol for perimeter and roof-height checks.
  assert(tentCollision.blocksBox(wallCol, wallRow, 0.1), 'walking actors collide with physical tent canvas walls');
  assert(tentCollision.blocksBox(wallCol, wallRow, 0.1, 0.8), 'low projectiles hit the canvas rather than passing through');
  assert(!tentCollision.blocksBox(wallCol, wallRow, 0.1, 50), 'high projectiles clear the tent roof');
  assert(!tentCollision.blocksBox(tentWorldCol, tentWorldRow, 0.1), 'chief can still reach the sleeping position inside the tent');
  const sampleTent = { x: 10, y: 10, w: 2, h: 2, rot: 0 }; // Exercises the physical doorway facing +row, as authored in HousePieceGen.
  assert(!api.__test.tentWallsBlockBox(sampleTent, 11, 11.95, 0.1), 'the front doorway has enough room for NPC-sized actors');
  assert(api.__test.tentWallsBlockBox(sampleTent, 11, 10.05, 0.1), 'the back wall stays solid');
  assert(api.__test.tentWallsBlockBox({ ...sampleTent, rot: 90 }, 10.05, 11, 0.1), 'rotating the entrance rotates its physical walls');
  assert(!api.__test.tentWallsBlockBox({ ...sampleTent, rot: 90 }, 11.95, 11, 0.1), 'rotated front doorway stays passable');
  assert(!tentCollision.blocksBox(0.25, 0.25, 0.1), 'tent collision is limited to real stamped canvas wall footprints');
  assert.equal(ZONES.filter(zoneId => debug.zones[zoneId].chiefActive).length, 1, 'exactly one large chief camp is active');
  const firstChiefDebug = debug.zones.map_southern_cloud_forest.camps.find(camp => camp.kind === 'chief'); // Used below to verify redesigned chief-camp structural diagnostics.
  assert.equal(firstChiefDebug.residents, 6);
  assert.equal(firstChiefDebug.tents, 8);
  assert.equal(firstChiefDebug.bonfires, 1);
  assert.equal(firstChiefDebug.benchLogs, 4);
  assert.equal(firstChiefDebug.benchSeats, 8);
  const chiefBenchStations = stations.filter(station => station.roles?.includes?.('porakaneki-camp-rest')); // Registered shared seating affordances visible to the ordinary NPC free-time planner.
  assert.equal(chiefBenchStations.length, 8, 'four chief-camp logs expose both authored seat anchors to normal NPC AI');
  assert(chiefBenchStations.every(station => station.pose === 'sit' && station.furnitureKey === 'benchlog' && station.roles.includes('sit')), 'camp seats reuse the normal sit-station contract');
  assert.equal(chief.rec.scheduleHooks.defaultMapId, 'map_southern_cloud_forest');
  assert.equal(chief.rec.agenda.find(beat => beat.id === 'porakaneki_day').activity, 'break');
  assert.equal(hostileObjects.size, 0, 'all off-zone generated residents remain abstract');

  const originalSmallCenters = JSON.stringify(smallCenters(debug));
  const stationCountBeforeRepeat = stations.length; // Used below to catch accidental duplicate registration during an ordinary same-season camp tick.
  contextWindow.BanditCamps.updateCampBanners(0.21);
  assert.equal(stations.length, stationCountBeforeRepeat, 'repeated same-season camp ticks do not duplicate already-registered bench stations');
  season = 'Deadgrass';
  contextWindow.BanditCamps.updateCampBanners(0.21);
  assert.equal(stations.filter(station => station.roles?.includes?.('porakaneki-camp-rest')).length, 16, 'chief migration registers the new camp seats once while preserving stable station ids from the previous site');
  debug = api.debugSnapshot();
  assert.equal(debug.chiefZoneId, 'map_western_slope');
  assert.equal(ZONES.filter(zoneId => debug.zones[zoneId].chiefActive).length, 1);
  assert.equal(debug.zones.map_western_slope.chiefActive, true);
  assert.equal(debug.zones.map_southern_cloud_forest.chiefActive, false);
  assert(!tentCollision.blocksBox(wallCol, wallRow, 0.1), 'the migrated chief tent no longer blocks movement in its old map');
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

  const savedFavor = relation.favor; // Preserve the original LOD scenario after these hostility/gift-target checks.
  const giftEntity = [...hostileObjects].find(entity => entity._porakanekiPlannerControlled === true && entity.avatarRef?.group?.visible); // A real materialized camp hunter is the gift interaction target.
  assert(giftEntity);
  const savedPlayerPosition = { x: combatDeps.player.x, y: combatDeps.player.y }; // Restored before the original LOD boundary checks.
  combatDeps.player.x = giftEntity.x;
  combatDeps.player.y = giftEntity.y;
  relation.favor = -5;
  contextWindow.NpcRapport = { get: () => 25, canGiftToday: () => true };
  contextWindow.BanditCamps.updateCampBanners(0.21);
  assert.equal(api.debugSnapshot().attackOnSight, false, 'positive daily Rapport overrides even the worst permanent Favor');
  assert.equal(giftEntity._porakanekiPlannerControlled, true, 'the real hunter remains peaceful');
  const giftWalker = api.getNearbyGiftWalker(giftEntity.x / combatDeps.TILE, giftEntity.y / combatDeps.TILE, 2); // Exercises the public path called by updateNpcWalkers.
  assert(giftWalker?.isPorakanekiHunter);
  assert.equal(api.getNearbyGiftWalker(giftEntity.x / combatDeps.TILE, giftEntity.y / combatDeps.TILE, 2), giftWalker, 'cached proxies do not cause action-bar refresh churn');
  contextWindow.NpcRapport.canGiftToday = () => false;
  assert.equal(api.getNearbyGiftWalker(giftEntity.x / combatDeps.TILE, giftEntity.y / combatDeps.TILE, 2), null, 'shared chief gift quota hides hunter offers');
  contextWindow.NpcRapport.get = () => 0;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  assert.equal(api.debugSnapshot().attackOnSight, true, 'Rapport expiry restores authored attack-on-sight rules');
  assert.equal(giftEntity._porakanekiPlannerControlled, false);
  contextWindow.NpcRapport.get = () => 25;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  giftEntity.health -= 1;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  assert.equal(giftEntity._porakanekiPlannerControlled, false, 'attacking a hunter still provokes retaliation despite positive Rapport');
  fakeNowMs += 100000;
  relation.favor = savedFavor;
  delete contextWindow.NpcRapport;
  combatDeps.player.x = savedPlayerPosition.x;
  combatDeps.player.y = savedPlayerPosition.y;
  contextWindow.BanditCamps.updateCampBanners(0.21);

  // Distance LOD has no invisible 10x10 chunk edge. A resident entered at 12
  // tiles stays live through the wider 16-tile release radius, so walking a
  // few tiles across an old chunk boundary cannot make it disappear like a
  // ghost. Pick a direction that stays inside the 96x96 test map.
  const direction = materialized.x < 48 ? 1 : -1;
  combatDeps.player.x = (materialized.x + direction * 19) * combatDeps.TILE;
  combatDeps.player.y = materialized.y * combatDeps.TILE;
  contextWindow.BanditCamps.updateCampBanners(0.21);
  materialized = hunterDebug(api, currentArea, materializedCamp.id, materializedIndex);
  assert.equal(materialized.fullSimulation, true, 'already-live resident remains detailed between enter and release radii');
  assert.equal(materialized.visible, true, 'hysteresis does not blink the portrait off at an arbitrary chunk boundary');

  combatDeps.player.x = (materialized.x + direction * 24.5) * combatDeps.TILE;
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

  // Chunk-local ecology: only actors inside the player's real 16x16 streamed
  // chunk receive faction targets. Humanoids use _chunkCombatTarget while
  // predators reuse patrol-chase/targetCreature.
  hostileObjects.clear();
  combatDeps.player.x = 32 * combatDeps.TILE;
  combatDeps.player.y = 32 * combatDeps.TILE;
  const pora = { id: 'eco_pora', x: 32 * combatDeps.TILE, y: 32 * combatDeps.TILE, health: 20, maxHealth: 20, areaId: currentArea, isBandit: true, isPorakanekiHunter: true, _porakanekiPlannerControlled: true, def: { aggroRangePx: 0 } };
  const bandit = { id: 'eco_bandit', x: 33 * combatDeps.TILE, y: 32 * combatDeps.TILE, health: 20, maxHealth: 20, areaId: currentArea, isBandit: true, def: {} };
  const predator = { id: 'eco_predator', creatureKey: 'test-predator', wildlifeRole: 'predator', x: 34 * combatDeps.TILE, y: 32 * combatDeps.TILE, health: 20, maxHealth: 20, areaId: currentArea, state: 'idle', def: {} };
  const prey = { id: 'eco_prey', creatureKey: 'test-prey', wildlifeRole: 'prey', x: 35 * combatDeps.TILE, y: 32 * combatDeps.TILE, health: 20, maxHealth: 20, areaId: currentArea, state: 'idle', def: {} };
  for (const entity of [pora, bandit, predator, prey]) hostileObjects.add(entity);
  api.__test.updateChunkEcology();
  assert.equal(pora._chunkCombatTarget, bandit, 'Porakaneki prioritize a bandit/shared threat over prey');
  assert.equal(bandit._chunkCombatTarget, pora, 'bandits target Porakaneki in the observed chunk');
  assert.equal(predator.targetCreature, bandit, 'predator targets the nearest bandit/Porakaneki actor');
  assert.equal(predator.state, 'patrol-chase');
  const nearerHunter = { id: 'eco_nearer_hunter', x: 33.1 * combatDeps.TILE, y: 32 * combatDeps.TILE, health: 20, areaId: currentArea, isBandit: true, isPorakanekiHunter: true, def: {} }; // Tests the per-actor commitment when a closer same-faction opponent joins mid-fight.
  hostileObjects.add(nearerHunter);
  api.__test.updateChunkEcology();
  assert.equal(bandit._chunkCombatTarget, pora, 'a newly nearer hunter cannot steal an ongoing bandit fight');
  assert.equal(predator.targetCreature, bandit, 'the predator also keeps its existing living faction target');
  pora.health = 0;
  api.__test.updateChunkEcology();
  assert.equal(bandit._chunkCombatTarget, nearerHunter, 'a killed opponent frees the bandit to pick another target');
  pora.health = 20;
  hostileObjects.delete(nearerHunter);
  api.__test.updateChunkEcology();
  assert.equal(bandit._chunkCombatTarget, pora, 'a despawned opponent frees its committed target, even if still alive in memory');
  assert.equal(pora._porakanekiPlannerControlled, true, 'ecology combat does not make Porakaneki hostile to the player');
  let ecologyDebug = api.debugSnapshot().ecology;
  assert.deepEqual(JSON.parse(JSON.stringify(ecologyDebug)), {
    chunk: '2,2', porakaneki: 1, omgurku: 0, bandits: 1, predators: 1, prey: 1, humanoidTargets: 2, predatorTargets: 1,
  }, 'debug snapshot exposes the active 16x16 ecology chunk and assignment counts for mobile verification');
  assert.equal(api.hasSharedEnemyNearby(pora), true, 'bandit/predator in the player chunk activates crossfire forgiveness');

  hostileObjects.delete(bandit);
  hostileObjects.delete(predator);
  api.__test.updateChunkEcology();
  assert.equal(pora._chunkCombatTarget, prey, 'Porakaneki hunt prey when no bandit/predator threat is present');
  assert.equal(api.hasSharedEnemyNearby(pora), true, 'recent shared-enemy combat retains the short simultaneous-death grace');
  fakeNowMs += 1600;
  assert.equal(api.hasSharedEnemyNearby(pora), false, 'crossfire grace expires when no shared enemy remains');

  // Rival tribes: an Omgurku hunter in the same chunk is a shared enemy, so
  // Porakaneki fight it on sight (neutral to the player) instead of hunting prey.
  const omg = { id: 'eco_omg', x: 33 * combatDeps.TILE, y: 33 * combatDeps.TILE, health: 20, maxHealth: 20, areaId: currentArea, isBandit: true, isTribeHunter: true, tribeId: 'omgurku', _porakanekiPlannerControlled: true, def: {} };
  hostileObjects.add(omg);
  api.__test.updateChunkEcology();
  assert.equal(pora._chunkCombatTarget, omg, 'Porakaneki attack a rival Omgurku before prey');
  assert.equal(omg._chunkCombatTarget, pora, 'Omgurku attack a rival Porakaneki');
  assert.equal(omg._porakanekiPlannerControlled, true, 'tribe-vs-tribe combat keeps both hunters neutral to the player');
  assert.equal(api.hasSharedEnemyNearby(pora), true, 'a rival tribe in the chunk forgives crossfire deaths like a bandit does');
  assert.equal(api.debugSnapshot().ecology.omgurku, 1);
  hostileObjects.delete(omg);
  api.__test.updateChunkEcology();
  fakeNowMs += 1600;

  // The player outranks the ecology: a bandit already fighting the player, just
  // hit by the player/companion, or with the player in its aggro range keeps
  // fighting them instead of being pulled into a faction fight; a bandit whose
  // faction fight ends is released from 'chase' rather than left chasing nobody.
  {
    const T = combatDeps.TILE;
    const fightingBandit = { id: 'eco_fighting_bandit', x: 34 * T, y: 32 * T, health: 20, maxHealth: 20, areaId: currentArea, isBandit: true, state: 'chase', def: { aggroRangePx: 0, leashRangePx: 8 * T } }; // Chasing the player (no actor target).
    const hitBandit = { id: 'eco_hit_bandit', x: 33 * T, y: 33 * T, health: 20, maxHealth: 20, areaId: currentArea, isBandit: true, state: 'idle', homeX: 20 * T, homeY: 20 * T, def: { aggroRangePx: 0, leashRangePx: 8 * T } };
    const wolf = { id: 'eco_chasing_predator', creatureKey: 'test-predator', wildlifeRole: 'predator', x: 38 * T, y: 32 * T, health: 20, maxHealth: 20, areaId: currentArea, state: 'chase', def: { aggroRangePx: 0 } };
    for (const entity of [fightingBandit, hitBandit, wolf]) hostileObjects.add(entity);
    api.__test.updateChunkEcology();
    assert.equal(fightingBandit._chunkCombatTarget ?? null, null, 'a bandit chasing the player is not reassigned to a hunter');
    assert.equal(fightingBandit.state, 'chase', 'its pursuit of the player is untouched');
    assert.equal(wolf.targetCreature ?? null, null, 'a predator chasing the player is not pulled into a faction fight');
    assert.equal(wolf.state, 'chase');
    assert.equal(hitBandit._chunkCombatTarget, pora, 'an unengaged bandit still joins the faction fight');
    assert.equal(hitBandit.state, 'chase');

    hitBandit._teamHitAt = fakeNowMs; // The player (or companion) lands a hit mid-fight.
    api.__test.updateChunkEcology();
    assert.equal(hitBandit._chunkCombatTarget ?? null, null, 'a hit from the player ends the bandit\'s faction fight');
    assert.equal(hitBandit.state, 'chase', 'and turns it on the player');
    assert.deepEqual([hitBandit.homeX, hitBandit.homeY], [hitBandit.x, hitBandit.y], 'its leash anchor moves to the fight so it does not instantly return to camp');
    api.__test.updateChunkEcology();
    assert.equal(hitBandit._chunkCombatTarget ?? null, null, 'it stays on the player while the hit is recent');
    hitBandit.state = 'idle'; // The fight with the player is over.
    fakeNowMs += 6001;
    api.__test.updateChunkEcology();
    assert.deepEqual([hitBandit.homeX, hitBandit.homeY], [20 * T, 20 * T], 'the camp leash anchor is restored once the player fight is over');
    assert.equal(hitBandit._chunkCombatTarget, pora, 'and the bandit can rejoin the faction fight');

    const nearBandit = { id: 'eco_near_bandit', x: 36 * T, y: 32 * T, health: 20, maxHealth: 20, areaId: currentArea, isBandit: true, state: 'chase', _chunkCombatTarget: pora, def: { aggroRangePx: 6 * T, leashRangePx: 8 * T } }; // Player at (32,32) is inside its aggro range.
    hostileObjects.add(nearBandit);
    api.__test.updateChunkEcology();
    assert.equal(nearBandit._chunkCombatTarget ?? null, null, 'a bandit with the player in aggro range drops the hunter for the player');

    // A finished faction fight must not leave the bandit in 'chase' with no target.
    hostileObjects.delete(fightingBandit); hostileObjects.delete(nearBandit); hostileObjects.delete(wolf);
    pora.health = 0;
    hostileObjects.delete(omg);
    api.__test.updateChunkEcology();
    assert.equal(hitBandit._chunkCombatTarget ?? null, null, 'no opponent remains');
    assert.equal(hitBandit.state, 'return', 'a bandit whose opponent died is released from chase instead of lingering as a phantom player-combat chaser');
    pora.health = 20;
    hostileObjects.delete(hitBandit);
    api.__test.updateChunkEcology();
    fakeNowMs += 1600;
  }

  hostileObjects.delete(prey);
  // Fights cover every live actor within the 24-tile release radius around the
  // player, not just the player's own 16x16 chunk: rivals in plain view fight.
  const nextChunkBandit = { id: 'eco_next_chunk_bandit', x: 48 * combatDeps.TILE, y: 32 * combatDeps.TILE, health: 20, maxHealth: 20, areaId: currentArea, isBandit: true, def: {} };
  hostileObjects.add(nextChunkBandit);
  api.__test.updateChunkEcology();
  assert.equal(pora._chunkCombatTarget, nextChunkBandit, 'a visible actor across the 16-tile chunk boundary is still a faction target');
  hostileObjects.delete(nextChunkBandit);
  const outsideBandit = { id: 'eco_outside_bandit', x: 32 * combatDeps.TILE, y: 57 * combatDeps.TILE, health: 20, maxHealth: 20, areaId: currentArea, isBandit: true, def: {} };
  hostileObjects.add(outsideBandit);
  api.__test.updateChunkEcology();
  assert.equal(pora._chunkCombatTarget, null, 'an actor beyond the 24-tile ecology radius is not simulated as a faction target');
  assert.deepEqual(JSON.parse(JSON.stringify(api.__test.streamChunkOfTile(15.99, 0))), { x: 0, y: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(api.__test.streamChunkOfTile(16, 0))), { x: 1, y: 0 });

  const easternBefore = api.debugSnapshot().zones.map_eastern_mire.smallCampCount;
  assert.equal(easternBefore, 1);
  assert.equal(api.reduceHuntingCampsForBandit('map_eastern_mire'), null, 'bandit placement cannot sacrifice the only Porakaneki hunting camp');
  const easternAfter = api.debugSnapshot().zones.map_eastern_mire;
  assert.equal(easternAfter.smallCampCount, 1, 'the one-hunting-camp cap and protected floor remain intact');
  assert.equal(easternAfter.chiefReserved, true, 'future chief-camp reservation is never sacrificed for bandit placement');

  console.log('Porakaneki distributed seasonal camp regression checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
