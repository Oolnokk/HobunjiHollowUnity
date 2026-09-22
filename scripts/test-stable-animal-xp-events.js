const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('docs/js/stable-animal-xp-events.js', 'utf8');
const loader = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8');
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Guards the caller-side zone gate that keeps this module's discovery wrapper out of interiors.

const player = { x: 0, y: 0 };
const companion = { id: 'companion-actor', health: 100, stableRole: 'companion', master: player, areaId: 'zone-a', avatarRef: { group: { visible: true } } };
const shoulder = { id: 'shoulder-actor', health: 100, stableRole: 'shoulderPet', master: player, areaId: 'zone-a', avatarRef: { group: { visible: true } } };
const entries = {
  companion: { id: 'companion-1', name: 'Hound', kind: 'gar-wolf' },
  shoulderPet: { id: 'shoulder-1', name: 'Moth', kind: 'puktuk' },
  mount: { id: 'mount-1', name: 'Runner', kind: 'gar-wolf' },
};
const xpAwards = [];
const popups = [];
const hostiles = new Set();
let rawDay = 12;
let hour = 8;
let currentArea = 'zone-a';

const storage = new Map();
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
};
localStorage.setItem('hobunjiSaveMeta', JSON.stringify({ worlds: [{ id: 'world-a', discoveredLocales: {} }] }));

const campRec = { cleared: false };
const nest = { remaining: 2, liveBirth: false };
const treasurePlacement = { col: 1, row: 1, found: false };
const treasurePersist = new Map([['zone-a', { week: 3, placements: [treasurePlacement] }]]);
const treasureScenes = new Map([['zone-a', { grid: [[{}, {}], [{}, { type: 'grass' }]] }]]);
const treasureDeps = {
  _zoneTreasurePersist: treasurePersist,
  _zoneScenes: treasureScenes,
  TileType: { TRENCH: 'trench' },
};

const questProgress = { questA: { status: 'available', progress: {} } };
const questDeps = {
  getQuestProgress: () => questProgress,
  setQuestStatus(taskId, status, patch) {
    questProgress[taskId] ||= { status: '', progress: {} };
    questProgress[taskId].status = status;
    Object.assign(questProgress[taskId].progress, patch || {});
  },
};

const context = {
  console,
  Date,
  Map,
  Set,
  WeakMap,
  Object,
  Math,
  Number,
  String,
  JSON,
  Promise,
  localStorage,
  calendar: { day: rawDay },
  queueMicrotask: fn => fn(),
  setInterval: () => 1,
  clearInterval() {},
  __farmLog() {},
  CREATURE_DB: {},
  WorldPopupText: {
    queueReward(kind, text) { popups.push({ kind, text }); },
  },
  StableAnimalProgression: {
    activeEntryForRole(role) { return entries[role] || null; },
    awardXp(entry, amount, sourceName) {
      xpAwards.push({ entry: entry.id, amount, source: sourceName });
      return { ok: true, amount, levels: 0 };
    },
  },
  Combat: {
    deps: {
      player,
      TILE: 64,
      companionObjects: new Set([companion, shoulder]),
      hostileObjects: hostiles,
      getCurrentArea: () => currentArea,
    },
  },
  Mounts: { rideEntity: { health: 100 } },
  CalendarSystem: {
    ready: true,
    isInitialized() { return this.ready; },
    timeDebugSnapshot: () => ({ rawDay }),
    getHour: () => hour,
  },
  CreatureDeath: { begin(target) { return target; } },
  NpcRapport: Object.freeze({ adjust(_npcId, amount) { return Number(amount) || 0; } }),
  WildTreasure: {
    init() {},
    syncZoneInteractivity() {},
  },
  DenNestSystem: {
    currentAimedNest: () => nest,
    updateNestInteraction() { nest.remaining--; },
  },
  BanditCamps: {
    campInstances: new Map([['zone-a', [campRec]]]),
    isCampCleared: rec => !!rec.cleared,
    updateTentInteraction() {},
    ensureCurrentZoneCamps() {},
  },
  ProceduralTasks: { init() {} },
  BountyBoard: { init() {} },
  DialogueContent: { init() {} },
  TasksPanel: { init() {} },
};
context.WildernessMap = {
  updateFogAroundPlayer() {
    const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta'));
    meta.worlds[0].discoveredLocales['locale-new'] = { name: 'New Place' };
    localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
  },
  remembered: {},
  getDiscoveredThreats() { return { ...this.remembered }; },
  rememberDiscoveredThreat(key, info) { this.remembered[key] = info; },
};
context.window = context;

vm.createContext(context);
vm.runInContext(source, context, { filename: 'stable-animal-xp-events.js' });
const api = context.StableAnimalXpEvents.install();
assert(api, 'StableAnimalXpEvents installs');
assert.match(loader, /StableAnimalXpEvents/, 'farm bootstrap loads the stable animal XP bridge');
assert.match(gameSource, /if \(_isZoneArea\(currentArea\)\) window\.WildernessMap\.updateFogAroundPlayer\(\);/, 'game loop must not enter wilderness fog/discovery wrapper chains while the player is inside a cave or building');

function newAwards(fn) {
  const start = xpAwards.length;
  fn();
  return xpAwards.slice(start);
}

const enemy = { id: 'bandit-1', isBandit: true };
hostiles.add(enemy);
let gained = newAwards(() => context.CreatureDeath.begin(enemy));
assert.deepEqual(gained.map(x => [x.entry, x.amount]), [['companion-1', 4], ['shoulder-1', 4]], 'enemy defeat awards companion and shoulder pet');

const mother = { id: 'gar-wolf-den-mother', isDenMother: true };
hostiles.add(mother);
gained = newAwards(() => context.CreatureDeath.begin(mother));
assert.deepEqual(gained.map(x => [x.entry, x.amount]), [['companion-1', 20], ['shoulder-1', 4]], 'den-mother defeat combines enemy XP with companion den-mother bonus');

gained = newAwards(() => context.NpcRapport.adjust('npc-a', 7, 'dance_with_player'));
assert.deepEqual(gained.map(x => [x.entry, x.amount]), [['shoulder-1', 7]], 'positive Rapport awards shoulder-pet XP by actual Rapport gained');
assert.equal(context.NpcRapport.adjust('npc-a', -4, 'bad_event'), -4, 'negative Rapport still passes through unchanged');

context.ProceduralTasks.init(questDeps);
gained = newAwards(() => questDeps.setQuestStatus('questA', 'completed', {}));
assert.deepEqual(gained.map(x => [x.entry, x.amount]), [['mount-1', 20]], 'first quest completion awards mount XP');
gained = newAwards(() => questDeps.setQuestStatus('questA', 'completed', {}));
assert.equal(gained.length, 0, 'repeated completed status cannot double-award mount quest XP');

gained = newAwards(() => context.WildernessMap.updateFogAroundPlayer());
assert.deepEqual(gained.map(x => [x.entry, x.amount]), [['mount-1', 12]], 'new locale discovery awards mount XP');
gained = newAwards(() => context.WildernessMap.rememberDiscoveredThreat('camp-a', { kind: 'camp' }));
assert.deepEqual(gained.map(x => [x.entry, x.amount]), [['mount-1', 12]], 'new camp/den discovery counts as a mount location discovery');
gained = newAwards(() => context.WildernessMap.rememberDiscoveredThreat('camp-a', { kind: 'camp' }));
assert.equal(gained.length, 0, 'already-known threat location cannot double-award mount XP');

context.WildTreasure.init(treasureDeps);
context.WildTreasure.syncZoneInteractivity('zone-a');
treasureScenes.get('zone-a').grid[1][1].type = 'trench';
gained = newAwards(() => context.WildTreasure.syncZoneInteractivity('zone-a'));
assert.deepEqual(gained.map(x => [x.entry, x.amount]), [['companion-1', 12]], 'undug-to-trench treasure transition awards companion XP');
gained = newAwards(() => context.WildTreasure.syncZoneInteractivity('zone-a'));
assert.equal(gained.length, 0, 'same dug treasure cannot award twice');

gained = newAwards(() => context.DenNestSystem.updateNestInteraction(0.1));
assert.deepEqual(gained.map(x => [x.entry, x.amount]), [['companion-1', 10]], 'taking an egg/baby from a den nest awards companion XP');

context.BanditCamps.updateTentInteraction(0.1); // seed false state
campRec.cleared = true;
gained = newAwards(() => context.BanditCamps.updateTentInteraction(0.1));
assert.deepEqual(gained.map(x => [x.entry, x.amount]), [['companion-1', 20]], 'bandit camp false-to-cleared transition awards companion XP');
gained = newAwards(() => context.BanditCamps.updateTentInteraction(0.1));
assert.equal(gained.length, 0, 'cleared camp cannot award twice');

context.CalendarSystem.ready = false;
assert.equal(api._test.gameHourSample(), null, 'parser-time Stable XP polling defers until CalendarSystem receives game.js state');
context.CalendarSystem.ready = true;

api.checkMountTravel(); // seed hour 8
player.x = 60 * 64;
hour = 9;
gained = newAwards(() => api.checkMountTravel());
assert.deepEqual(gained.map(x => [x.entry, x.amount]), [['mount-1', 10]], 'hourly mount travel XP scales with net tile displacement');

assert(popups.length >= xpAwards.length, 'each applied animal XP award reaches the centered XP reward queue');
assert(popups.every(row => row.kind === 'skillXp'), 'animal XP uses the same centered list category as player skill XP');
assert(popups.some(row => /Mount XP$/.test(row.text)), 'mount XP popup is labeled by role');
assert(popups.some(row => /Shoulder Pet XP$/.test(row.text)), 'shoulder-pet XP popup is labeled by role');
assert(popups.some(row => /Companion XP$/.test(row.text)), 'companion XP popup is labeled by role');

const debug = context.__stableAnimalXpDebug();
assert.equal(debug.installed, true, 'mobile debug snapshot reports installation');
assert(debug.lastAward && debug.awards.length, 'mobile debug snapshot retains recent animal XP awards');
assert.equal(debug.xp.mountTravelTilesPerXp, 6, 'debug snapshot exposes centralized tuning values');

console.log('Stable animal XP event regression tests passed.');