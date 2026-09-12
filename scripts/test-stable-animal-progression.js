'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const stable = [
  { id: 'comp1', kind: 'hound', name: 'Moro', role: 'companion', level: 0 },
  { id: 'mount1', kind: 'garwolf', name: 'Tallfoot', role: 'mount', level: 0 },
  { id: 'pet1', kind: 'bird', name: 'Pip', role: 'shoulderPet', level: 0 },
];
let saveCount = 0;
let activeCompanionId = 'comp1';
let activeMountId = 'mount1';
let activeShoulderPetId = 'pet1';
const player = { x: 0, y: 0 };
const companion = { id: 'liveComp', stableRole: 'companion', health: 10, areaId: 'town', master: player, def: { perceptionTiles: 6 }, avatarRef: { group: { visible: true } } };
const mount = { id: 'liveMount', stableRole: 'mount', health: 10, areaId: 'town', master: player, def: {}, avatarRef: { group: { visible: true } } };
const shoulder = { id: 'livePet', stableRole: 'shoulderPet', health: 10, areaId: 'town', master: player, def: {}, avatarRef: { group: { visible: true } } };
const beastHound = { id: 'enemyHound', stableRole: 'companion', health: 10, areaId: 'town', master: { id: 'bandit' }, def: { perceptionTiles: 6 } };
const companions = new Set([companion, mount, shoulder, beastHound]);
const hostiles = new Set();
let seenDiscoveryRoles = null;
let seenPerception = null;
let originalDialogueTreeId = null;
let rapportApplied = null;

const document = {
  createElement(tag) {
    if (tag === 'canvas') return { width: 0, height: 0, getContext: () => ({ clearRect(){}, beginPath(){}, arc(){}, stroke(){}, moveTo(){}, lineTo(){}, set strokeStyle(v){}, set shadowColor(v){}, set shadowBlur(v){}, set lineWidth(v){}, set globalAlpha(v){} }) };
    return { style: {}, classList: { add(){}, remove(){} }, appendChild(){}, addEventListener(){}, remove(){}, querySelector(){ return null; }, textContent: '', disabled: false };
  },
  getElementById() { return null; },
};

const farmDeps = {
  getStable: () => stable,
  saveStable: () => { saveCount++; },
  getActiveCompanionId: () => activeCompanionId,
  getActiveMountId: () => activeMountId,
  getActiveShoulderPetId: () => activeShoulderPetId,
  showToast() {},
};

const dialogueStates = new Map([['friend1', { favor: 3, memory: [] }]]);
const DialogueContent = {
  init() {},
  getNpcDlgState(id) {
    if (!dialogueStates.has(id)) dialogueStates.set(id, { favor: 0, memory: [] });
    return dialogueStates.get(id);
  },
  recordNpcMemory(id, event) { this.getNpcDlgState(id).memory.push({ event, day: 1, ts: 1 }); },
  beginNpcConversation(rec) { originalDialogueTreeId = rec.dialogueTrees?.[0]?.id || null; },
};

const BanditCamps = {
  init(deps) { this.deps = deps; },
  updateCompanionPerception() {
    seenDiscoveryRoles = [...this.deps.companionObjects].map(a => a.stableRole + ':' + (a.master === player ? 'player' : 'other'));
    seenPerception = companion.def.perceptionTiles;
  },
  updateRandomEncounters() {
    seenDiscoveryRoles = [...this.deps.companionObjects].map(a => a.stableRole + ':' + (a.master === player ? 'player' : 'other'));
  },
};

const context = {
  window: null,
  document,
  console,
  performance: { now: () => 1000 },
  requestAnimationFrame: () => 1,
  setTimeout,
  clearTimeout,
};
context.window = context;
context.CreatureGenetics = { stableEntryRole: entry => entry.role };
context.FarmAnimals = { init() {}, addToStable() {} };
context.FarmPanel = { init() {}, renderStablePanel() {} };
context.BanditCamps = BanditCamps;
context.AmbientDialogue = { init() {}, update() {}, show() {} };
context.DialogueContent = DialogueContent;
context.NpcRapport = Object.freeze({
  adjust(npcId, amount, source) { rapportApplied = { npcId, amount, source }; return amount; },
});
context.Combat = {
  deps: { player, companionObjects: companions, hostileObjects: hostiles, TILE: 64, getCurrentArea: () => 'town' },
  loadout: { getSlot: () => 'opportunistJab' },
  quickAttackData: { TECHNIQUES: { opportunistJab: { condKey: 'enemyStriking' } } },
  getQuickAttackConditions: (_deps, enemy) => ({ enemyStriking: !!enemy.quickOk }),
  chargedBreakerData: { POWER: 1.7 },
  heavyTelegraphVisuals: { activeVisuals: () => [] },
};
context.Mounts = { get rideEntity() { return mount; } };
context.AnimalVocalizations = { warning() {}, profileForDebug: () => ({ warning: { allowedClips: ['a.ogg','b.ogg','c.ogg'] } }) };
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/stable-animal-progression.js', 'utf8'), context, { filename: 'stable-animal-progression.js' });
const bridgeSource = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8'); // Verifies the parser-time farm bridge loads and installs the new runtime before game initialization.
assert.match(bridgeSource, /globalKey: 'StableAnimalProgression'/, 'farm feature bridge loads stable animal progression');
assert.match(bridgeSource, /installStableAnimalProgression\(\)/, 'farm feature bridge installs stable animal progression');

const api = context.StableAnimalProgression;
api.install();
context.FarmAnimals.init(farmDeps);
context.FarmPanel.init(farmDeps);
context.BanditCamps.init({ player, companionObjects: companions });

assert.equal(stable[0].level, 0, 'existing stable level 0 is preserved as the progression baseline');
assert.equal(Object.keys(stable[0].animalPerks).length, 0, 'perks normalize onto stable entries');

api.awardXp('comp1', 181, 'test');
assert.equal(stable[0].level, 3, 'XP crosses level 0->1, 1->2, and 2->3 thresholds');
assert.equal(api.availablePoints(stable[0]), 3, 'one training point is earned per level');
assert(api.spendPoint('comp1', 'rapportBond').ok);
assert(api.spendPoint('comp1', 'rapportBond').ok);
assert(api.spendPoint('comp1', 'rapportBond').ok);
assert.equal(api.rapportMultiplierDetails().multiplier, 1.18, 'companion rapport perk applies while the companion is present');
context.NpcRapport.adjust('friend1', 2, 'gift');
assert.equal(rapportApplied.amount, 2.36, 'positive rapport is multiplied through the shared NpcRapport API');

stable[0].level = 4;
assert(api.spendPoint('comp1', 'keenSenses').ok);
context.BanditCamps.updateCompanionPerception(1);
assert(!seenDiscoveryRoles.includes('shoulderPet:player'), 'shoulder pets are removed only for camp/den discovery checks');
assert(!seenDiscoveryRoles.includes('mount:player'), 'mounts are removed only for camp/den discovery checks');
assert(seenDiscoveryRoles.includes('companion:player'), 'the player animal companion remains eligible for discovery');
assert(seenDiscoveryRoles.includes('companion:other'), 'bandit-owned companion actors remain untouched');
assert(Math.abs(seenPerception - 6.6) < 1e-9, 'Keen Senses scales the authoritative companion perception radius');
assert(companions.has(shoulder) && companions.has(mount), 'temporarily filtered roles are restored immediately afterward');

stable[2].level = 3;
stable[2].animalPerks = { heavyWindupAlert: 1, quickOpportunityAlert: 1, rangedFocusAlert: 1 };
const heavyEnemy = { health: 10, isBandit: true, telegraphState: 'windup', _banditSwingAnim: 'sweep', _banditSwingPower: 1.7, def: {} };
const quickEnemy = { health: 10, quickOk: true, _rangedMode: false, def: { weaponKey: 'sword' } };
const rangedEnemy = { health: 10, _rangedMode: true, def: { rangedWeaponKey: 'crossbow', weaponKey: 'dagger' } };
assert.deepEqual([...api.alertKindsForTarget(heavyEnemy)], ['heavyWindup']);
assert.deepEqual([...api.alertKindsForTarget(quickEnemy)], ['quickOpportunity']);
assert.deepEqual([...api.alertKindsForTarget(rangedEnemy)], ['rangedFocus']);

stable[0].animalPerks.rapportBond = 3;
const rec = { id: 'friend1', name: 'Friend', dialogueTrees: [{ id: 'ordinary', trigger: 'interact', entryNode: 'x', nodes: [] }] };
context.DialogueContent.beginNpcConversation(rec);
assert.equal(originalDialogueTreeId, 'stable_animal_recognition_comp1', 'friend gets the one-off regular recognition dialogue before ordinary chat');
assert.equal(rec.dialogueTrees[0].id, 'ordinary', 'temporary recognition tree does not mutate authored dialogue content');
assert(dialogueStates.get('friend1').memory.some(m => m.event === 'stableAnimalRecognized:comp1'), 'recognition is stored in normal NPC memory');

assert(saveCount > 0, 'progression mutations persist through the existing stable save function');
console.log('Stable animal progression regression tests passed.');
