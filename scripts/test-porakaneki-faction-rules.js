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
let afflictionCalls = 0;
const hostileObjects = new Set();
const player = { id: 'player', x: 10, y: 20, isPlayer: true };
const resourceSystem = {
  AFFLICTIONS: { windedStamina: {} },
  applyDamage(target, amount) {
    const before = Number(target.health) || 0;
    target.health = Math.max(0, before - Math.max(0, Number(amount) || 0));
    return before - target.health;
  },
  addAffliction() { afflictionCalls++; return 1; },
};
const combatDeps = {
  hostileObjects,
  player,
  damageCreature(target, amount, fromX, fromY, knockbackPxS, opts) {
    return resourceSystem.applyDamage(target, amount, opts);
  },
};
const animalAttacks = {
  start() { return true; },
  update(creature) {
    if (typeof window._duringAnimalUpdate === 'function') return window._duringAnimalUpdate(creature);
    return false;
  },
};
const skillSystem = {
  award() { return true; },
};
const window = {
  __farmLog: () => {},
  WorldPopupText: { queueReward(type, text) { popups.push([type, text]); } },
  DialogueContent: {
    npcDlgState: relationMap,
    getNpcDlgState(id) { if (!relationMap.has(id)) relationMap.set(id, state(0)); return relationMap.get(id); },
    loadNpcRelationships() {},
  },
  ResourceSystem: resourceSystem,
  SkillSystem: skillSystem,
  Combat: {
    deps: combatDeps,
    animalAttacks,
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
  performance,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/js/scene-ready-poller.js'), 'utf8'), sandbox, { filename: 'scene-ready-poller.js' });
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

function resetFavor() {
  relationMap.get('porakaneki_chief').favor = 0;
  relationMap.get('omgurku_chief').favor = 0;
}

const e = hunter('e');
hostileObjects.add(e);
rules.syncNow();
assert(e.def.hostile === false, 'neutral targetability false');
assert(window.Combat.meleeHit({ isCompanion: true }, e, {}) === false, 'neutral companion melee blocked');
assert(window.Combat.animalAttacks.start({ isCompanion: true }, 'pounce', { target: e }) === false, 'neutral companion named attack selection blocked');

// Direct named-attack effects must not hit a neutral Porakaneki even when a special attack bypasses meleeHit.
const companion = { id: 'companion', isCompanion: true, x: 99, y: 99 };
const beforeNeutralNamedAttack = e.health;
window._duringAnimalUpdate = () => {
  window.Combat.deps.damageCreature(e, 4, companion.x, companion.y, 0, { tag: 'special' });
  window.ResourceSystem.applyDamage(e, 4, { tag: 'special' });
  window.ResourceSystem.addAffliction(e, 'windedStamina', 4);
  return true;
};
window.Combat.animalAttacks.update(companion, 0.016);
assert(e.health === beforeNeutralNamedAttack, 'neutral companion named-attack damage blocked');
assert(afflictionCalls === 0, 'neutral companion named-attack affliction blocked');

e._porakanekiPlannerControlled = false;
rules.syncNow();
assert(e.def.hostile === true, 'hostile targetability true');
assert(window.Combat.meleeHit({ isCompanion: true }, e, {}) === true, 'hostile companion melee allowed');
assert(window.Combat.animalAttacks.start({ isCompanion: true }, 'pounce', { target: e }) === true, 'hostile companion named attack allowed');

// Murder: a player-authored neutral hit marks first blood before the same tick's one-shot death.
e.health = 10;
e._porakanekiPlannerControlled = true;
resetFavor();
rules.syncNow();
window._duringTick = () => { window.Combat.deps.damageCreature(e, 10, player.x, player.y, 0, { tag: 'sharp' }); };
window.BanditCamps.updateCampBanners();
assert(relationMap.get('porakaneki_chief').favor === -3, `murder favor ${relationMap.get('porakaneki_chief').favor}`);
assert(relationMap.get('omgurku_chief').favor === 1, `murder rival favor ${relationMap.get('omgurku_chief').favor}`);

// Self-defense: AOS Porakaneki initiates hostility on one tick, then the player's kill stays on the smaller penalty.
const e2 = hunter('e2', 'camp2');
hostileObjects.add(e2);
resetFavor();
rules.syncNow();
attackOnSight = true;
window._duringTick = () => { e2._porakanekiPlannerControlled = false; };
window.BanditCamps.updateCampBanners();
window._duringTick = () => { window.Combat.deps.damageCreature(e2, 10, player.x, player.y, 0, { tag: 'sharp' }); };
window.BanditCamps.updateCampBanners();
assert(relationMap.get('porakaneki_chief').favor === -1, `self defense favor ${relationMap.get('porakaneki_chief').favor}`);
assert(relationMap.get('omgurku_chief').favor === 1, `self defense rival favor ${relationMap.get('omgurku_chief').favor}`);

// Multi-hunter neutral one-shot: surviving retaliation must not reclassify the player's first blood as self-defense.
const a = hunter('a', 'camp3');
const b = hunter('b', 'camp3');
hostileObjects.add(a);
hostileObjects.add(b);
resetFavor();
attackOnSight = false;
rules.syncNow();
window._duringTick = () => {
  window.Combat.deps.damageCreature(a, 10, player.x, player.y, 0, { tag: 'sharp' });
  b._porakanekiPlannerControlled = false;
};
window.BanditCamps.updateCampBanners();
assert(relationMap.get('porakaneki_chief').favor === -3, `multi murder favor ${relationMap.get('porakaneki_chief').favor}`);
assert(relationMap.get('omgurku_chief').favor === 1, `multi murder rival ${relationMap.get('omgurku_chief').favor}`);

// Third-party/friendly-fire death: a neutral hunter losing HP is not proof the player started the fight.
const e3 = hunter('e3', 'camp4');
hostileObjects.add(e3);
resetFavor();
rules.syncNow();
window._duringTick = () => { window.Combat.deps.damageCreature(e3, 10, 999, 999, 0, { tag: 'sharp', friendlyFire: true }); };
window.BanditCamps.updateCampBanners();
assert(relationMap.get('porakaneki_chief').favor === 0, `third-party Porakaneki favor ${relationMap.get('porakaneki_chief').favor}`);
assert(relationMap.get('omgurku_chief').favor === 0, `third-party rival favor ${relationMap.get('omgurku_chief').favor}`);

// Player ranged: direct ResourceSystem ranged damage still marks neutral first blood.
const e4 = hunter('e4', 'camp5');
hostileObjects.add(e4);
resetFavor();
rules.syncNow();
window._duringTick = () => { window.ResourceSystem.applyDamage(e4, 10, { ranged: true, tag: 'sharp' }); };
window.BanditCamps.updateCampBanners();
assert(relationMap.get('porakaneki_chief').favor === -3, `ranged murder favor ${relationMap.get('porakaneki_chief').favor}`);
assert(relationMap.get('omgurku_chief').favor === 1, `ranged rival favor ${relationMap.get('omgurku_chief').favor}`);

// Legacy player melee: SkillSystem's landed-hit signal bridges to the following direct ResourceSystem damage call.
const e5 = hunter('e5', 'camp6');
hostileObjects.add(e5);
resetFavor();
rules.syncNow();
window._duringTick = () => {
  window.SkillSystem.award('combat', 0, 'landed hit');
  window.ResourceSystem.applyDamage(e5, 10, { tag: 'sharp' });
};
window.BanditCamps.updateCampBanners();
assert(relationMap.get('porakaneki_chief').favor === -3, `legacy murder favor ${relationMap.get('porakaneki_chief').favor}`);
assert(relationMap.get('omgurku_chief').favor === 1, `legacy rival favor ${relationMap.get('omgurku_chief').favor}`);

const hooks = rules.debugSnapshot().hooks;
assert(Object.values(hooks).every(Boolean), `all hooks installed: ${JSON.stringify(hooks)}`);

console.log('PASS', JSON.stringify({ debug: rules.debugSnapshot(), popups }, null, 2));
