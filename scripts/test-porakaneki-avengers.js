// Porakaneki Avengers: Nazgraku-mounted riders seeded at each wilderness map's
// first Porakaneki hunting camp ride down travelling Omgurku hunters and kill
// them. Executes the real camp runtime (both tribes) in a browser-shaped VM.
// Run with: node scripts/test-porakaneki-avengers.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = file => fs.readFileSync(file, 'utf8');
const cfg = JSON.parse(read('docs/config/porakaneki-camp.json')); // Avenger tuning lives with the Porakaneki camp config.
const omgurkuCfg = JSON.parse(read('docs/config/omgurku-camp.json')); // The quarry tribe has no band of its own.
const smallLocale = JSON.parse(read('docs/config/locales/locale_porakaneki_camp_small.json'));
const chiefLocale = JSON.parse(read('docs/config/locales/locale_porakaneki_camp_chief.json'));
const tent = JSON.parse(read('docs/config/pieces/porakaneki-hunting-tent.json'));
const ZONES = cfg.wildernessZones;

assert.equal(cfg.avengers.mountSpecies, 'nazgraku');
assert.equal(cfg.avengers.quarryTribe, 'omgurku');
assert.equal(cfg.avengers.quarryEscapeChance, 0.05, 'mounted riders rarely lose their quarry');
assert.equal(cfg.avengers.killsPerDay, 0, 'Avengers hunt without a daily limit by default');
assert.equal(cfg.avengers.escapeReprieveHours, 2);
assert(cfg.avengers.groupRadiusTiles > 0);
assert(omgurkuCfg.behavior.denHuntGroupMin > cfg.avengers.riders,
  'balance: a full Omgurku hunting party outnumbers a band, so Avengers prey on stragglers and the Omgurku are safest in groups');
assert.equal(cfg.avengers.retreatHours, 1);
assert.equal(cfg.avengers.riderLossChance, 0.1);
assert(cfg.avengers.rideSpeedTilesPerSecond > cfg.behavior.travelSpeedTilesPerSecond, 'mounted riders outpace walking hunters');
assert.equal(omgurkuCfg.avengers, undefined, 'only the Porakaneki keep an Avenger band');
assert.deepEqual([cfg.smallCamps.minResidents, cfg.smallCamps.maxResidents], [2, 4], 'Porakaneki ordinary hunting camp retains its original 2–4 residents');
assert.deepEqual([omgurkuCfg.smallCamps.minResidents, omgurkuCfg.smallCamps.maxResidents], [2, 4], 'Omgurku ordinary hunting camp retains its original 2–4 residents');

let currentArea = 'town'; // Player stays off every wilderness map, so the whole hunt runs abstractly.
let hour = 12;
let day = 3;
const hostileObjects = new Set();
const builds = []; // Captures every BanditCombat.makeEntity request.

function makeLayout() {
  return {
    cols: 96, rows: 96,
    tiles: Array.from({ length: 96 * 96 }, (_, i) => ({ c: i % 96, r: Math.floor(i / 96), type: 'grass', elevTier: 0 })),
    buildings: [],
    dens: [
      { id: 'animalDen_0', x: 8, y: 70, w: 4, h: 4, mouthAnchor: { x: 10, y: 75 } },
      { id: 'animalDen_1', x: 70, y: 8, w: 4, h: 4, mouthAnchor: { x: 74, y: 10 } },
      { id: 'animalDen_2', x: 70, y: 70, w: 4, h: 4, mouthAnchor: { x: 72, y: 75 } },
    ],
    decor: [], furniture: [], transitions: [], rootTotems: [], localeInstances: [],
    toTownExit: { col: 2, row: 2 },
  };
}
const zoneLayouts = new Map(ZONES.map(zoneId => [zoneId, makeLayout()]));
const huntingSitePreferences = new Map(); // Records per-tribe, per-zone requested map ends for cross-tribe placement assertions.
function fakeStamp(view, localeDef, opts) {
  view.__stampSeq = (view.__stampSeq || 0) + 1;
  const seq = view.__stampSeq;
  const isChief = localeDef.id === 'locale_porakaneki_camp_chief';
  const x = isChief ? 4 : 10 + (seq % 4) * 20, y = isChief ? 4 : 30 + Math.floor(seq / 4) * 20;
  const id = opts.instanceId;
  if (!isChief) huntingSitePreferences.set(id, opts.preferredPoint); // Exercises both tribes' actual placement requests despite using a fake stamp.
  for (const object of localeDef.objects) {
    view.objects.push({ id: `${id}_${object.id}`, type: object.kind === 'tent' ? 'tent' : object.kind, key: object.key,
      x: x + object.col, y: y + object.row, w: object.w, h: object.h, rot: object.rot || 0, temporaryLocaleInstanceId: id, destroyed: false });
  }
  return { id, site: { x, y, w: localeDef.cols, h: localeDef.rows }, removedObjectSnapshots: [], tileSnapshot: {} };
}

const contextWindow = {
  fetch: async url => {
    const value = String(url);
    const payload = value.includes('hunting-tent') ? tent : value.includes('omgurku-camp.json') ? omgurkuCfg
      : value.includes('porakaneki-camp.json') ? cfg : value.includes('chief') ? chiefLocale : smallLocale;
    return { ok: true, status: 200, json: async () => payload };
  },
  BanditCombat: {
    init(deps) { this.deps = deps; },
    discardEntity() {},
    async loadGangConfig() { return {}; },
    async makeEntity(_base, rank, tier, x, y, opts) { builds.push({ rank, tier, opts }); return null; },
  },
  NpcScheduling: { init() {}, registerNpcStations() {} },
  RuntimeFrameScheduler: { callbacks: [], register(_id, callback) { this.callbacks.push(callback); } }, // Production owner: one pre-game callback per tribe.
  TemporaryLocales: { stamp: fakeStamp },
  CalendarSystem: {
    getHour: () => hour, timeDebugSnapshot: () => ({ rawDay: day }), yearNumber: () => 1, tothalCycle: () => 1,
    currentSeason: () => ({ name: 'Stormtide' }),
  },
  DialogueContent: { getNpcDlgState: () => ({ favor: 0, memory: [] }) },
  NpcSocialStimuli: { strongestNear: () => null },
  __farmLog() {},
};
contextWindow.window = contextWindow;
let nowMs = 1000;
vm.runInContext(read('docs/js/porakaneki-camps-runtime.js'), vm.createContext({
  window: contextWindow, fetch: contextWindow.fetch, console, Date, Math, Set, Map, Promise, performance: { now: () => nowMs },
}), { filename: 'porakaneki-camps-runtime.js' });

let seed = 7;
const combatDeps = {
  TILE: 60, player: { x: 0, y: 0 }, calendar: { day: 3 },
  rnd: () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; },
  zoneLayouts, zoneScenes: new Map(),
  EXTERIOR_ZONES: Object.fromEntries(ZONES.map(zoneId => [zoneId, { cols: 96, rows: 96, entryCol: 2, entryRow: 2 }])),
  WATERWAY_TYPES: new Set(), TileType: { PATH: 'path', RAMP: 'ramp', WATERFALL: 'waterfall', SHRUB: 'shrub', ROCK: 'rock' },
  HELD_SHAPE_DEFS: { fishingspear: {}, hatchet: {}, dagger: {} }, craftedToolItemKey: (shape, metal) => `${shape}_${metal}`,
  hostileObjects, getCurrentArea: () => currentArea,
  getActiveGrid: () => null, getActiveCols: () => 96, getActiveRows: () => 96, tileSurfaceYInArea: () => 0,
  characterGroundShadowSurfaceOffset: () => 0.01, showToast() {},
};
contextWindow.BanditCombat.init(combatDeps);
contextWindow.NpcScheduling.init({ npcWalkers: [] });
const tick = dt => {
  nowMs += dt * 1000;
  for (const callback of contextWindow.RuntimeFrameScheduler.callbacks) callback({ deltaMs: dt * 1000 });
};
const flush = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  await flush(); await flush();
  const pora = contextWindow.PorakanekiCamps, omg = contextWindow.OmgurkuCamps;
  assert.equal(contextWindow.TribeCamps.get('omgurku'), omg);
  tick(0.21);

  // Each map keeps only one hunting camp per tribe; Omgurku requests the edge
  // opposite the Porakaneki camp's ACTUAL placement, not just its planned edge.
  for (const zoneId of ZONES) {
    assert.equal(pora.debugSnapshot().zones[zoneId].smallCampCount, 1, `${zoneId} has one Porakaneki hunting camp`);
    assert.equal(omg.debugSnapshot().zones[zoneId].smallCampCount, 1, `${zoneId} has one Omgurku hunting camp`);
    const poraResidents = pora.debugSnapshot().zones[zoneId].camps.find(camp => camp.kind === 'small'); // Single-camp baseline used for ordinary residents, excluding the separate Avenger band.
    const omgResidents = omg.debugSnapshot().zones[zoneId].camps.find(camp => camp.kind === 'small'); // Rival single-camp baseline, independent of the Porakaneki chief.
    for (const [runtime, camp, tribeCfg] of [[pora, poraResidents, cfg], [omg, omgResidents, omgurkuCfg]]) {
      const cohortSizes = runtime.__test.historicalHuntingCohortsForZone(zoneId); // Exact previous per-camp population rolls.
      assert(cohortSizes.length >= 2 && cohortSizes.length <= 4, 'former 2-4 camps now share one site');
      assert.deepEqual(camp.cohortSizes, cohortSizes, 'each former population roll is retained');
      assert.equal(camp.residents, cohortSizes.reduce((sum, size) => sum + size, 0), 'former total hunters remain unchanged');
      assert.equal(camp.hunters.filter(h => h.role === 'resident').length, camp.residents, 'no duplicated residents or Avenger counts');
      assert.equal(camp.huntingParties.length, cohortSizes.length, 'one independent party per former camp');
      const seen = new Set(); // Verify independent party membership rather than duplicating the same hunter.
      for (const party of camp.huntingParties) {
        const members = camp.hunters.filter(h => h.huntPartyId === party.id);
        assert.equal(members.length, party.memberCount, 'party membership matches debug');
        assert(members.length >= 2 && members.length <= tribeCfg.behavior.denHuntGroupMax, 'original party-size bounds retained');
        assert(members.every(h => h.role === 'resident'), 'Avengers never enter a den party');
        for (const hunter of members) {
          assert(!seen.has(hunter.index), 'no resident belongs to two parties');
          seen.add(hunter.index);
        }
      }
    }
    const poraPoint = huntingSitePreferences.get(`porakaneki_small_${zoneId}_0`);
    const omgPoint = huntingSitePreferences.get(`omgurku_small_${zoneId}_0`);
    const rivalSite = pora.occupiedSites(zoneId)[0]; // The first site is always the small camp, not the seasonal chief.
    assert.equal(poraPoint.col, 0, 'first tribe prefers the west end of a square map');
    assert.equal(omgPoint.col, rivalSite.x + rivalSite.w / 2 < 48 ? 96 : 0,
      'second tribe prefers the map end farthest from its actual Porakaneki rival camp');
    assert.equal(omgPoint.row, rivalSite.y + rivalSite.h / 2, 'the rival camp keeps the transverse axis aligned');
  }

  // One band per wilderness map, at that map's only Porakaneki hunting camp.
  let debug = pora.debugSnapshot();
  for (const zoneId of ZONES) {
    const camps = debug.zones[zoneId].camps;
    const homes = camps.filter(camp => camp.avengers);
    assert.equal(homes.length, 1, `${zoneId} has exactly one Avenger band`);
    assert.equal(homes[0].kind, 'small');
    const riders = homes[0].hunters.filter(hunter => hunter.role === 'avenger');
    assert.equal(riders.length, cfg.avengers.riders);
    assert(riders.every(rider => rider.mount === 'nazgraku'), 'every Avenger rides a Nazgraku');
    assert(riders.every(rider => cfg.avengers.weaponShapes.includes(rider.weapon)));
    assert.equal(homes[0].residents, homes[0].hunters.length - riders.length, 'riders join on top of the ordinary residents');
    assert(homes[0].huntingParties.every(party => homes[0].hunters.filter(h => h.huntPartyId === party.id).every(h => h.role === 'resident')),
      'Avengers never join any of the independent den-hunting parties');
  }
  for (const zoneId of ZONES) assert(omg.debugSnapshot().zones[zoneId].camps.every(camp => !camp.avengers), 'Omgurku camps keep no band');

  // An off-screen catch is a contest. Force each roll through the shared rnd seam.
  const seeded = combatDeps.rnd;
  const riderRows = () => Object.values(pora.debugSnapshot().zones).flatMap(zone => zone.camps.flatMap(camp => camp.hunters)).filter(h => h.role === 'avenger');
  combatDeps.rnd = () => cfg.avengers.riderLossChance / 2; // Below riderLossChance: the quarry kills a rider and escapes.
  for (let i = 0; i < 400 && pora.debugSnapshot().avengerLosses === 0; i++) tick(4.1);
  debug = pora.debugSnapshot();
  assert(debug.avengerLosses > 0, 'a cornered Omgurku can kill an Avenger');
  assert.equal(debug.avengerKills, 0, 'the quarry that kills a rider gets away');
  assert(riderRows().some(rider => rider.activity === 'slain'), 'the dead rider is marked slain');
  assert(debug.avengerEscapes >= debug.avengerLosses, 'a rider loss also counts as an escape');
  combatDeps.rnd = () => cfg.avengers.riderLossChance + cfg.avengers.quarryEscapeChance / 2; // Escape band: nobody dies.
  const lossesBefore = debug.avengerLosses, escapesBefore = debug.avengerEscapes;
  for (let i = 0; i < 400 && pora.debugSnapshot().avengerEscapes === escapesBefore; i++) tick(4.1);
  debug = pora.debugSnapshot();
  assert(debug.avengerEscapes > escapesBefore, 'a travelling Omgurku can simply escape');
  assert.equal(debug.avengerLosses, lossesBefore);
  assert.equal(debug.avengerKills, 0);
  // An escapee only gets a short reprieve before the band rides it down again.
  const escapedZone = ZONES.find(zone => pora.debugSnapshot().zones[zone].camps.find(camp => camp.avengers).avengers.lastEscapeId);
  const bandOf = () => pora.debugSnapshot().zones[escapedZone].camps.find(camp => camp.avengers).avengers;
  const escapedId = bandOf().lastEscapeId;
  assert(escapedId, 'the band reports which quarry got away');
  combatDeps.rnd = seeded;
  for (let i = 0; i < 5; i++) { tick(0.21); assert.notEqual(bandOf().quarryId, escapedId, 'the escapee is left alone during its reprieve'); }

  day += 2; // New day: escapees are fair game again and slain riders are replaced.
  tick(0.21);
  assert(riderRows().every(rider => rider.activity !== 'slain'), 'slain Avengers are replaced after a couple of days');
  assert.equal(riderRows().length, ZONES.length * cfg.avengers.riders);

  // Ride through the day: travelling Omgurku get chased down and slain off-screen.
  const zoneId = ZONES[0];
  for (let i = 0; i < 400 && pora.debugSnapshot().avengerKills === 0; i++) tick(4.1);
  debug = pora.debugSnapshot(); // Any of the four single-camp maps may produce the first catch; don't require one selected zone.
  assert(debug.avengerKills > 0, 'Avengers kill a travelling Omgurku');
  const slain = Object.values(omg.debugSnapshot().zones).flatMap(zone => zone.camps.flatMap(camp => camp.hunters)).filter(h => h.activity === 'slain');
  assert(slain.length >= 1, 'the slain Omgurku is marked dead in its own camp runtime');
  const travellers = ZONES.flatMap(zone => omg.travellingHunters(zone, 0));
  assert(travellers.every(hunter => !hunter.slain), 'a slain hunter is never offered as a traveller again');
  assert(/avengers-slew/.test(debug.lastReason) || debug.avengerKills > 0);

  // No daily limit: a band keeps hunting all day. Off-screen victims are replaced later.
  for (let i = 0; i < 300; i++) tick(4.1);
  const perBand = () => Object.values(pora.debugSnapshot().zones).map(zone => zone.camps.find(camp => camp.avengers).avengers.kills);
  assert(perBand().some(kills => kills > 1), `a band makes several kills in one day (${perBand()})`);
  const slainCount = () => Object.values(omg.debugSnapshot().zones).flatMap(zone => zone.camps.flatMap(camp => camp.hunters)).filter(h => h.activity === 'slain').length;
  const killsBefore = pora.debugSnapshot().avengerKills; // Lifetime kill count includes residents replaced after prior game days.
  assert(slainCount() > 0 && slainCount() <= killsBefore, 'the outstanding slain population cannot exceed lifetime Avenger kills');
  const slainIdsBefore = new Set(Object.values(omg.debugSnapshot().zones).flatMap(zone =>
    zone.camps.flatMap(camp => camp.hunters.filter(h => h.activity === 'slain').map(h => `${camp.id}:${h.index}`)))); // Follow exact victim slots rather than comparing cumulative kills with live deaths.
  day += 2;
  tick(0.21);
  const slainIdsAfter = new Set(Object.values(omg.debugSnapshot().zones).flatMap(zone =>
    zone.camps.flatMap(camp => camp.hunters.filter(h => h.activity === 'slain').map(h => `${camp.id}:${h.index}`))));
  assert([...slainIdsBefore].some(id => !slainIdsAfter.has(id)), 'slain residents are replaced in their camp slots after a couple of days');

  // Outnumbered: if the quarry's group is bigger than the band, the riders
  // break off and ride home to regroup instead of engaging.
  const groupRadius = cfg.avengers.groupRadiusTiles;
  cfg.avengers.groupRadiusTiles = 0; // Give a band a target before broadening the group's radius; otherwise it correctly refuses outnumbering upfront.
  let pursuing = null;
  for (let i = 0; i < 400 && !pursuing; i++) {
    tick(0.21);
    pursuing = ZONES.find(zone => omg.huntersNear(zone, 48, 48, 500) > cfg.avengers.riders
      && pora.debugSnapshot().zones[zone].camps.find(camp => camp.avengers).avengers.quarryId);
  }
  assert(pursuing, 'a band can lock a quarry in a zone with more rival hunters than its riders');
  const pursuer = () => pora.debugSnapshot().zones[pursuing].camps.find(camp => camp.avengers);
  const withdrawalsBefore = pora.debugSnapshot().avengerWithdrawals;
  cfg.avengers.groupRadiusTiles = 500; // The entire zone becomes the quarry's group, now larger than the selected band.
  tick(0.21);
  assert(pora.debugSnapshot().avengerWithdrawals > withdrawalsBefore, 'an outnumbered band withdraws');
  assert.equal(pursuer().avengers.retreating, true);
  assert.equal(pursuer().avengers.quarryId, null, 'it drops the quarry');
  assert(pursuer().hunters.filter(h => h.role === 'avenger').every(h => h.activity === 'withdraw'), 'every rider rides home');
  hour += cfg.avengers.retreatHours + 0.1;
  for (let i = 0; i < 20; i++) tick(4.1);
  assert.equal(pursuer().avengers.retreating, false, 'the band regroups after retreatHours');
  assert(ZONES.every(zone => !pora.debugSnapshot().zones[zone].camps.find(camp => camp.avengers).avengers.quarryId), 'a band never picks a quarry whose group outnumbers it');
  cfg.avengers.groupRadiusTiles = groupRadius;
  hour = 12;

  // An optional killsPerDay cap still holds when configured.
  cfg.avengers.killsPerDay = 1; // Same object the runtime loaded.
  day += 1;
  const capStart = perBand();
  for (let i = 0; i < 300; i++) tick(4.1);
  assert(perBand().every((kills, i) => kills - capStart[i] <= 1), `a configured daily cap holds (${capStart} -> ${perBand()})`);
  cfg.avengers.killsPerDay = 0;

  // Only hunters away from camp count as travelling; nobody travels at night.
  for (const traveller of ZONES.flatMap(zone => omg.travellingHunters(zone, 8))) {
    assert(['hunt-den', 'wander', 'investigate'].includes(traveller.activity));
    const center = traveller.camp.center;
    assert(Math.hypot(traveller.x - center.col, traveller.y - center.row) >= 8);
  }
  hour = 23;
  tick(0.21);
  assert.equal(omg.travellingHunters(zoneId, 0).length, 0, 'sleeping Omgurku are not travelling');
  assert(Object.values(pora.debugSnapshot().zones).every(zone => zone.camps.every(camp => !camp.avengers?.quarryId)), 'bands stand down at night');
  hour = 12;

  // Near the player, riders materialize mounted, tougher and faster.
  const home = pora.debugSnapshot().zones[zoneId].camps.find(camp => camp.avengers);
  const rider = home.hunters.find(hunter => hunter.role === 'avenger');
  currentArea = zoneId;
  combatDeps.player.x = rider.x * combatDeps.TILE; combatDeps.player.y = rider.y * combatDeps.TILE;
  tick(0.21); await flush();
  const riderBuild = builds.find(build => build.opts.extra.isTribeAvenger);
  assert(riderBuild, 'a nearby Avenger materializes through BanditCombat');
  assert.equal(riderBuild.opts.mountSpecies, 'nazgraku');
  assert.equal(riderBuild.opts.nameOverride, 'Porakaneki Avenger');
  assert.equal(riderBuild.tier, cfg.avengers.tier);
  assert.equal(riderBuild.opts.extra.tribeId, 'porakaneki', 'riders fight Omgurku through the shared rival-tribe ecology');
  assert(builds.filter(build => !build.opts.extra.isTribeAvenger).every(build => !build.opts.mountSpecies), 'ordinary hunters stay on foot');

  // On screen, a withdrawing rider disengages from the shared ecology fight
  // (the Omgurku may still give chase).
  const T = combatDeps.TILE;
  const live = (id, extra) => ({ id, x: combatDeps.player.x, y: combatDeps.player.y, health: 20, maxHealth: 20, areaId: currentArea, isBandit: true, isTribeHunter: true, def: {}, ...extra });
  const riderEntity = live('rider', { tribeId: 'porakaneki', isTribeAvenger: true, _porakanekiPlannerControlled: true });
  const omgEntity = live('omg', { tribeId: 'omgurku', x: combatDeps.player.x + T, _porakanekiPlannerControlled: true });
  hostileObjects.add(riderEntity); hostileObjects.add(omgEntity);
  pora.__test.updateChunkEcology();
  assert.equal(riderEntity._chunkCombatTarget, omgEntity, 'an engaged rider fights the Omgurku');
  riderEntity._avengerRetreating = true;
  pora.__test.updateChunkEcology();
  assert.equal(riderEntity._chunkCombatTarget, null, 'a withdrawing rider breaks off');
  assert.equal(omgEntity._chunkCombatTarget, riderEntity, 'the Omgurku can still chase it');
  hostileObjects.delete(riderEntity); hostileObjects.delete(omgEntity);

  // Run the production temporary-locale finder and tribe placement policy,
  // not only fakeStamp: the actual camps must occupy opposite ends on square,
  // portrait and landscape wilderness maps, including after regeneration.
  const realPlacementContext = vm.createContext({ window: contextWindow, globalThis: contextWindow, console, Math, Set, Map, Object, Date }); // Shared window permits the real placement modules to replace the earlier test-only stamper.
  vm.runInContext(read('docs/js/temporary-locales.js'), realPlacementContext);
  vm.runInContext(read('docs/js/porakaneki-camp-placement-policy.js'), realPlacementContext);
  for (const { cols, rows } of [{ cols: 96, rows: 96 }, { cols: 64, rows: 96 }, { cols: 96, rows: 64 }]) {
    const zone = ZONES[0]; // A single test zone is regenerated repeatedly while the other zone states remain intact.
    const layout = makeLayout(); // Fresh map reference exercises the production regeneration path.
    layout.cols = cols;
    layout.rows = rows;
    layout.tiles = layout.tiles.filter(tile => tile.c < cols && tile.r < rows);
    layout.dens = [{ id: 'animalDen_placement', x: Math.floor(cols / 2), y: Math.floor(rows / 2), w: 3, h: 3 }];
    zoneLayouts.set(zone, layout);
    pora.ensureZoneState(zone);
    omg.ensureZoneState(zone);
    const poraSite = pora.occupiedSites(zone)[0]; // Porakaneki's first occupied site is its only hunting camp.
    const omgSite = omg.occupiedSites(zone)[0]; // Omgurku's first occupied site is its only hunting camp.
    assert.equal(pora.debugSnapshot().zones[zone].smallCampCount, 1, `Porakaneki single-camp count after regeneration on ${cols}x${rows}`);
    assert.equal(omg.debugSnapshot().zones[zone].smallCampCount, 1, `Omgurku single-camp count after regeneration on ${cols}x${rows}`);
    assert(poraSite && omgSite, 'both rival hunting camps received a legal site');
    const longAxisDistance = cols >= rows ? omgSite.x - poraSite.x : omgSite.y - poraSite.y; // Positive and broad separation along the map's long axis.
    assert(longAxisDistance > Math.max(cols, rows) / 2, `real opposing-end placement on ${cols}x${rows}`);
    const poraChunks = new Set(pora.reservedCampChunks(zone)); // Includes Porakaneki's seasonal chief reservation.
    const omgChunks = new Set(omg.reservedCampChunks(zone)); // Includes Omgurku's seasonal chief reservation.
    assert([...poraChunks].every(chunk => !omgChunks.has(chunk)), 'rival hunting/chief camps never share a streamed wilderness chunk');
  }

  // In heavily obstructed wilderness, both tribes still get their minimum
  // legal 2x2 outpost when a normal 13x13 footprint cannot be accommodated.
  combatDeps.WATERWAY_TYPES.add('river');
  const blockedZoneId = ZONES[0]; // Regenerate one more map with deterministic scattered impassable water.
  const blockedLayout = makeLayout(); // Retains a few legal 2x2 clearings but no regular full-sized camp site.
  for (const tile of blockedLayout.tiles) {
    if ((tile.c * 97 + tile.r * 131 + 3 * 47) % 31 < 5) tile.type = 'river';
  }
  zoneLayouts.set(blockedZoneId, blockedLayout);
  pora.ensureZoneState(blockedZoneId);
  omg.ensureZoneState(blockedZoneId);
  assert.equal(pora.debugSnapshot().zones[blockedZoneId].smallCampCount, 1, 'Porakaneki minimum camp survives obstructed regeneration');
  assert.equal(omg.debugSnapshot().zones[blockedZoneId].smallCampCount, 1, 'Omgurku minimum camp survives obstructed regeneration');
  const fallbackPora = pora.occupiedSites(blockedZoneId)[0]; // Fallback site's real footprint, not an assumed 13x13 locale.
  const fallbackOmg = omg.occupiedSites(blockedZoneId)[0]; // Companion fallback site on the opposite edge.
  assert(fallbackPora && fallbackOmg && fallbackPora.x < fallbackOmg.x, 'real compact/tent-only recovery preserves opposite-end ordering');
  assert([...new Set(pora.reservedCampChunks(blockedZoneId))].every(chunk => !new Set(omg.reservedCampChunks(blockedZoneId)).has(chunk)),
    'fallback camps still enforce exclusive stream chunks');

  console.log('Porakaneki Avengers regression checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
