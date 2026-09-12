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
const mount = { id: 'liveMount', stableRole: 'mount', health: 10, areaId: 'town', master: player, def: { mountSpeed: 100 }, avatarRef: { group: { visible: true } } };
const shoulder = { id: 'livePet', stableRole: 'shoulderPet', health: 10, areaId: 'town', master: player, def: {}, avatarRef: { group: { visible: true } } };
const beastHound = { id: 'enemyHound', stableRole: 'companion', health: 10, areaId: 'town', master: { id: 'bandit' }, def: { perceptionTiles: 6 } };
const companions = new Set([companion, mount, shoulder, beastHound]);
const hostiles = new Set();
let seenDiscoveryRoles = null;
let seenPerception = null;
let originalDialogueTreeId = null;
const rapportCalls = [];
const mountedChecks = {};
let mountRideState = 'mounted';

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

const mountDeps = {
  ACCEL: 10,
  clamp(value, min, max) { return Math.max(min, Math.min(max, value)); },
};
const Mounts = {
  init(deps) { this.deps = deps; },
  updateMountedMovement(dt) {
    mountedChecks.dt = dt;
    mountedChecks.speed = this.rideEntity.def.mountSpeed;
    mountedChecks.accel = this.deps.ACCEL;
    mountedChecks.turnClamp = this.deps.clamp(1, -0.1, 0.1);
  },
  updateMountRide(dt) { mountedChecks.rideDt = dt; },
  get rideState() { return mountRideState; },
  get rideEntity() { return mount; },
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
context.AmbientDialogue = { init() {}, update() {}, show() { return {}; } };
context.DialogueContent = DialogueContent;
context.NpcRapport = Object.freeze({
  currentGameDay: () => 1,
  adjust(npcId, amount, source) { rapportCalls.push({ npcId, amount, source }); return amount; },
});
context.Combat = {
  deps: { player, companionObjects: companions, hostileObjects: hostiles, TILE: 64, getCurrentArea: () => 'town' },
  loadout: { getSlot: () => 'opportunistJab' },
  quickAttackData: { TECHNIQUES: { opportunistJab: { condKey: 'enemyStriking' } } },
  getQuickAttackConditions: (_deps, enemy) => ({ enemyStriking: !!enemy.quickOk }),
  chargedBreakerData: { POWER: 1.7 },
  heavyTelegraphVisuals: { activeVisuals: () => [] },
};
context.Mounts = Mounts;
context.AnimalVocalizations = { warning() {}, profileForDebug: () => ({ warning: { allowedClips: ['a.ogg','b.ogg','c.ogg'] } }) };
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/stable-animal-progression.js', 'utf8'), context, { filename: 'stable-animal-progression.js' });
vm.runInContext(fs.readFileSync('docs/js/stable-animal-perk-adjustments.js', 'utf8'), context, { filename: 'stable-animal-perk-adjustments.js' });
const bridgeSource = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8'); // Verifies the parser-time farm bridge loads both progression layers before game initialization.
assert.match(bridgeSource, /globalKey: 'StableAnimalProgression'/, 'farm feature bridge loads stable animal progression');
assert.match(bridgeSource, /globalKey: 'StableAnimalPerkAdjustments'/, 'farm feature bridge loads the corrected role/perk integration');
assert.match(bridgeSource, /installStableAnimalProgression\(\)/, 'farm feature bridge installs stable animal progression');

const api = context.StableAnimalProgression;
api.install();
context.FarmAnimals.init(farmDeps);
context.FarmPanel.init(farmDeps);
context.BanditCamps.init({ player, companionObjects: companions });
context.Mounts.init(mountDeps);

assert.equal(stable[0].level, 0, 'existing stable level 0 is preserved as the progression baseline');
assert.equal(Object.keys(stable[0].animalPerks).length, 0, 'perks normalize onto stable entries');
assert(!api.trees.companion.some(perk => /XP/i.test(perk.desc) || perk.id === 'fieldLessons'), 'companions have no XP multiplier perk');
assert(!api.trees.shoulderPet.some(perk => /XP/i.test(perk.desc) || perk.id === 'perchLessons'), 'shoulder pets have no XP multiplier perk');
assert(!api.trees.mount.some(perk => perk.id === 'rapportBond' || /XP/i.test(perk.desc) || perk.id === 'roadLessons'), 'mounts have neither rapport nor XP multiplier perks');
assert.deepEqual(Array.from(api.trees.mount, perk => perk.id), ['mountSpeed', 'mountAcceleration', 'mountManeuverability', 'mountCliffClimb'], 'mount tree is entirely riding-performance focused');

api.awardXp('comp1', 181, 'test');
assert.equal(stable[0].level, 3, 'XP crosses level 0->1, 1->2, and 2->3 thresholds');
assert.equal(api.availablePoints(stable[0]), 3, 'one training point is earned per level');
assert(api.spendPoint('comp1', 'rapportBond').ok);
assert(api.spendPoint('comp1', 'rapportBond').ok);
assert(api.spendPoint('comp1', 'rapportBond').ok);
assert.equal(api.rapportMultiplierDetails().multiplier, 1.18, 'companion rapport perk applies while the companion is present');
context.NpcRapport.adjust('friend1', 2, 'gift');
assert.equal(rapportCalls.at(-1).amount, 2.36, 'positive rapport is multiplied through the shared NpcRapport API');

// A removed legacy XP perk is refunded by normalization and cannot change XP gain.
stable[0].animalPerks.fieldLessons = 5;
const beforeXp = stable[0].stableXp;
const xpResult = api.awardXp('comp1', 7, 'no-multiplier-check');
assert.equal(xpResult.amount, 7, 'animal XP is never multiplied');
assert.equal(stable[0].stableXp, beforeXp + 7, 'raw animal XP is applied exactly');
assert(!('fieldLessons' in stable[0].animalPerks), 'removed XP perk ranks are normalized away/refunded');

stable[0].level = 4;
assert(api.spendPoint('comp1', 'keenSenses').ok);
context.BanditCamps.updateCompanionPerception(1);
assert(!seenDiscoveryRoles.includes('shoulderPet:player'), 'shoulder pets are removed only for camp/den discovery checks');
assert(!seenDiscoveryRoles.includes('mount:player'), 'mounts are removed only for camp/den discovery checks');
assert(seenDiscoveryRoles.includes('companion:player'), 'the player animal companion remains eligible for discovery');
assert(seenDiscoveryRoles.includes('companion:other'), 'bandit-owned companion actors remain untouched');
assert(Math.abs(seenPerception - 6.6) < 1e-9, 'Keen Senses scales the authoritative companion perception radius');
assert(companions.has(shoulder) && companions.has(mount), 'temporarily filtered roles are restored immediately afterward');

stable[1].level = 20;
stable[1].animalPerks = { mountSpeed: 1, mountAcceleration: 1, mountManeuverability: 1, mountCliffClimb: 1 };
context.Mounts.updateMountedMovement(0.5);
assert.equal(mountedChecks.speed, 104, 'Fleet Stride scales only the mount riding top speed');
assert.equal(mountedChecks.accel, 11, 'Quick Start scales the existing mount acceleration');
assert(Math.abs(mountedChecks.turnClamp - 0.108) < 1e-9, 'Sure Turning expands the existing heading turn clamp');
assert.equal(mount.def.mountSpeed, 100, 'temporary riding speed scaling never mutates the shared mount definition');
assert.equal(mountDeps.ACCEL, 10, 'temporary acceleration scaling restores the shared movement dependency');
mountRideState = 'climbLeap';
context.Mounts.updateMountRide(1);
assert.equal(mountedChecks.rideDt, 1.1, 'Cliff Runner accelerates the existing mounted cliff-leap state machine');
mountRideState = 'mounted';

stable[2].level = 3;
stable[2].animalPerks = { heavyWindupAlert: 1, quickOpportunityAlert: 1, rangedFocusAlert: 1 };
const heavyEnemy = { health: 10, isBandit: true, telegraphState: 'windup', _banditSwingAnim: 'sweep', _banditSwingPower: 1.7, def: {} };
const quickEnemy = { health: 10, quickOk: true, _rangedMode: false, def: { weaponKey: 'sword' } };
const rangedEnemy = { health: 10, _rangedMode: true, def: { rangedWeaponKey: 'crossbow', weaponKey: 'dagger' } };
assert.deepEqual([...api.alertKindsForTarget(heavyEnemy)], ['heavyWindup']);
assert.deepEqual([...api.alertKindsForTarget(quickEnemy)], ['quickOpportunity']);
assert.deepEqual([...api.alertKindsForTarget(rangedEnemy)], ['rangedFocus']);

// Greeting a rapport-trained pet produces one automatic Rapport gain per NPC/animal/day.
stable[2].level = 5;
stable[2].animalPerks = { rapportBond: 1 };
const callsBeforeGreeting = rapportCalls.length;
context.AmbientDialogue.show({}, 'Hello, Pip!', { speakerId: 'friend1', faceTarget: { root: shoulder.avatarRef.group } });
assert.equal(rapportCalls.length, callsBeforeGreeting + 1, 'a rendered greeting to a rapport-trained pet awards Rapport');
assert.equal(rapportCalls.at(-1).source, 'pet_greeting:pet1', 'pet greeting Rapport records the individual animal source');
context.AmbientDialogue.show({}, 'Hello again, Pip!', { speakerId: 'friend1', faceTarget: { root: shoulder.avatarRef.group } });
assert.equal(rapportCalls.length, callsBeforeGreeting + 1, 'the same NPC/pet pair cannot award greeting Rapport twice in one day');

stable[0].animalPerks.rapportBond = 3;
const rec = { id: 'friend1', name: 'Friend', dialogueTrees: [{ id: 'ordinary', trigger: 'interact', entryNode: 'x', nodes: [] }] };
context.DialogueContent.beginNpcConversation(rec);
assert.equal(originalDialogueTreeId, 'stable_animal_recognition_comp1', 'friend gets the one-off regular recognition dialogue before ordinary chat');
assert.equal(rec.dialogueTrees[0].id, 'ordinary', 'temporary recognition tree does not mutate authored dialogue content');
assert(dialogueStates.get('friend1').memory.some(m => m.event === 'stableAnimalRecognized:comp1'), 'recognition is stored in normal NPC memory');

assert(saveCount > 0, 'progression mutations persist through the existing stable save function');
console.log('Stable animal progression regression tests passed.');
