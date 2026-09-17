const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../docs/js/porakaneki-faction-rules.js'), 'utf8');

function state(favor = 0) {
  return { favor, memory: [], visitedSeqSlots: {}, heardTrees: [], heardPoolEntries: [] };
}

const relationMap = new Map([
  ['porakaneki_chief', state(0)],
  ['baruhi_chief', { ...state(2), memory: [{ event: 'old' }], localNickname: 'oldfriend' }],
]);
const popups = [];
let attackOnSight = false;
const hostileObjects = new Set();
const window = {
  __farmLog: () => {},
  WorldPopupText: { queueReward(type, text) { popups.push([type, text]); } },
  DialogueContent: {
    npcDlgState: relationMap,
    getNpcDlgState(id) { if (!relationMap.has(id)) relationMap.set(id, state(0)); return relationMap.get(id); },
    loadNpcRelationships() {},
  },
  Combat: {
    deps: { hostileObjects },
    meleeHit() { return true; },
  },
  PorakanekiCamps: { debugSnapshot() { return { attackOnSight }; } },
  BanditCamps: { updateCampBanners() { if (typeof window._duringTick === 'function') window._duringTick(); } },
};
const sandbox = {
  window,
  console,
  Date,
  Math,
  Number,
  Object,
  Array,
  String,
  Set,
  Map,
  WeakSet,
  JSON,
  Promise,
  fetch: async () => ({
    ok: true,
    json: async () => ({ reputation: { killPenalty: 0, selfDefenseKillPenalty: -1, murderKillPenalty: -3, rivalNpcId: 'omgurku_chief', rivalKillFavor: 1 } }),
  }),
  setInterval(fn) { return { unref() {} }; },
  clearInterval() {},
  setTimeout,
  clearTimeout,
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'porakaneki-faction-rules.js' });
const rules = window.PorakanekiFactionRules;
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Canonical data rewrite.
const db = { worldContext: { tribalWar: { summary: 'Baruhi and bushdog people', keyNpcs: ['baruhi_chief'] } }, npcs: [{ id: 'baruhi_chief', tags: ['baruhi'], name: 'Baruhi Leader' }] };
rules.canonicalizeNpcDatabaseInPlace(db);
assert(db.worldContext.tribalWar.summary === 'Omgurku and sheep people', 'canon summary');
assert(db.worldContext.tribalWar.keyNpcs[0] === 'omgurku_chief', 'canon id');
assert(db.npcs[0].id === 'omgurku_chief' && db.npcs[0].tags[0] === 'omgurku', 'canon npc');

// Legacy relationship migration.
rules.migrateLegacyRelationshipState();
assert(!relationMap.has('baruhi_chief'), 'legacy id removed');
assert(relationMap.get('omgurku_chief')?.favor === 2, 'favor migrated');
assert(relationMap.get('omgurku_chief')?.localNickname === 'oldfriend', 'nickname migrated');

function hunter(id, camp = 'camp1') {
  return {
    id,
    isPorakanekiHunter: true,
    porakanekiCampId: camp,
    _porakanekiPlannerControlled: true,
    def: { hostile: true },
    health: 10,
    maxHealth: 10,
    areaId: 'map',
    x: 0,
    y: 0,
  };
}

const e = hunter('e');
hostileObjects.add(e);
rules.syncNow();
assert(e.def.hostile === false, 'neutral targetability false');
assert(window.Combat.meleeHit({ isCompanion: true }, e, {}) === false, 'neutral companion melee blocked');
e._porakanekiPlannerControlled = false;
rules.syncNow();
assert(e.def.hostile === true, 'hostile targetability true');
assert(window.Combat.meleeHit({ isCompanion: true }, e, {}) === true, 'hostile companion melee allowed');

// Murder: neutral -> dead in the same wrapped combat tick. Native kill favor is disabled; rules apply -3 and Omgurku +1 exactly once.
e.health = 10;
e._porakanekiPlannerControlled = true;
relationMap.get('porakaneki_chief').favor = 0;
relationMap.get('omgurku_chief').favor = 0;
rules.syncNow();
window._duringTick = () => { e.health = 0; };
window.BanditCamps.updateCampBanners();
assert(relationMap.get('porakaneki_chief').favor === -3, `murder favor ${relationMap.get('porakaneki_chief').favor}`);
assert(relationMap.get('omgurku_chief').favor === 1, `murder rival favor ${relationMap.get('omgurku_chief').favor}`);

// Self-defense: AOS Porakaneki initiates hostility on one tick, dies on next; total remains small -1, rival still +1.
const e2 = hunter('e2', 'camp2');
hostileObjects.add(e2);
relationMap.get('porakaneki_chief').favor = 0;
relationMap.get('omgurku_chief').favor = 0;
rules.syncNow();
attackOnSight = true;
window._duringTick = () => { e2._porakanekiPlannerControlled = false; };
window.BanditCamps.updateCampBanners();
window._duringTick = () => { e2.health = 0; };
window.BanditCamps.updateCampBanners();
assert(relationMap.get('porakaneki_chief').favor === -1, `self defense favor ${relationMap.get('porakaneki_chief').favor}`);
assert(relationMap.get('omgurku_chief').favor === 1, `self defense rival favor ${relationMap.get('omgurku_chief').favor}`);

// Multi-hunter neutral one-shot: surviving retaliation must not reclassify the kill as self-defense.
const a = hunter('a', 'camp3');
const b = hunter('b', 'camp3');
hostileObjects.add(a);
hostileObjects.add(b);
relationMap.get('porakaneki_chief').favor = 0;
relationMap.get('omgurku_chief').favor = 0;
attackOnSight = false;
rules.syncNow();
window._duringTick = () => {
  a.health = 0;
  b._porakanekiPlannerControlled = false;
};
window.BanditCamps.updateCampBanners();
assert(relationMap.get('porakaneki_chief').favor === -3, `multi murder favor ${relationMap.get('porakaneki_chief').favor}`);
assert(relationMap.get('omgurku_chief').favor === 1, `multi murder rival ${relationMap.get('omgurku_chief').favor}`);

console.log('PASS', JSON.stringify({ debug: rules.debugSnapshot(), popups }, null, 2));
