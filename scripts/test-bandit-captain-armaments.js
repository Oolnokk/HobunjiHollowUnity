#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Test the actual committed Foundry pair manifest, not a second hand-written
// compatibility table. No browser renderer or devtools are required.
class Group {
  constructor() { this.children = []; this.parent = null; this.userData = {}; this.visible = true; }
  add(child) { this.children.push(child); child.parent = this; }
  remove(child) { this.children = this.children.filter(item => item !== child); child.parent = null; }
}
const scene = () => { const root = new Group(); return root; };
const gear = { tools: {}, weaponEnchantments: {}, weaponEnchantmentVisuals: {} };
let savedGearCount = 0; // Counts durable pack saves; registration uses the real gear/member transaction.
const bag = { gold: 10000 }, itemDefs = {};
let allowSave = true, throwSave = false, licensed = false, feyComplete = false;
const eventLog = [];
const catalogWindow = { Combat: { deps: { getGearInventory: () => gear } } }; // Real enchantment unlock store writes into the same gear snapshot as registration.
vm.runInNewContext(fs.readFileSync('docs/js/combat/combat-enchantments.js', 'utf8'), { window: catalogWindow });
const definitions = catalogWindow.EnchantmentSystem.DEFINITIONS;
const window = {
  THREE: { Group }, GameRandom: { random: () => 0.37 }, EnemyLoadoutRules: { ruleFor: () => null },
  EnchantmentSystem: catalogWindow.EnchantmentSystem,
  CombatAttackEvents: { hit: (_base, patch) => { eventLog.push(patch); return patch; } },
  Combat: { poses: { SWEEP_POSE: { id: 'real-sweep' } } },
  WeaponEnchantmentVFX: { ALIGNMENTS: Object.fromEntries(['Tothal', 'Hronal', 'Kanthic', 'Ohthic', 'Fey'].map(id => [id, { dyeIds: ['dye'], effects: [{ id: 'orb' }] }])),
    createFixedEmitter: () => ({ update() {}, dispose() {} }) },
};
const context = vm.createContext({ window, console, document: { addEventListener() {}, getElementById: () => null }, performance: { now: () => 1000 } });
function load(path) { vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path }); }
load('docs/config/modular-weapons.js');
load('docs/js/modular-weapons.js');
load('docs/js/combat/weapon-shape-stats.js');
const modular = window.ModularWeapons;
const config = modular.getConfig();
const donorShapes = [...new Set([...Object.values(config.shafts), ...Object.values(config.heads)].map(item => item.sourceShape))];
const shapes = Object.fromEntries(donorShapes.map(id => [id, { shapeKey: id, slots: ['weapon'], animStyle: 'sweep', dmgType: 'sharp', weaponIdleClass: 'light' }]));
const toolDefs = {};
const metals = { nativeCopper: { label: 'Copper', tier: 1 } };
modular.registerDefinitions(toolDefs, shapes, metals, ['nativeCopper']);
toolDefs.hatchet_nativeCopper = { shapeKey: 'hatchet', metalKey: 'nativeCopper', slots: ['weapon'], animStyle: 'sweep', dmgType: 'sharp' };
const culturalWeapons = ['workhammer', 'hatchet', 'fishingmace', 'fishingspear', 'pickshovel', 'bshuakauitl', 'daggerSword', 'plainsSword', 'dagger', 'kylie', 'warCleaver'];
window.WeaponTrustBanditLoadouts = { allowedMeleeShapes: species => species === 'mao-ao' ? culturalWeapons : ['workhammer', 'hatchet'] };
window.WEAPON_TRUST_VISIT_CONFIG = { gifts: [{ shapeKey: 'warCleaver' }], bandits: { weaponShapePool: culturalWeapons } };
const deps = {
  TOOL_ITEM_DEFS: toolDefs, ITEM_DEFS: itemDefs, inventory: bag, inventoryItems: [], METAL_DEFS: metals, HELD_SHAPE_DEFS: shapes,
  rnd: () => 0.37, getGearInventory: () => gear, ensureToolTexture: () => {},
  makeToolPlaneMesh: key => { const mesh = new Group(); mesh.userData.toolPlane = { isObject3D: true, rotation: { z: 0 } }; mesh.itemKey = key; return mesh; },
  buildEquipmentSlots: () => {}, saveMemberWorldData: () => { if (throwSave) throw Error('storage rejected'); if (!allowSave) return false; savedGearCount++; return true; },
};
function entity() {
  const owner = new Group(), stage = scene(), existing = new Group();
  stage.add(existing);
  const handRigAvatarRoot = { userData: { proceduralHandToolHolder: existing } };
  return {
    id: 'test-captain', isBandit: true, enemyClass: 'bandit', scene: stage, health: 50, stamina: 1, maxStamina: 1,
    rosterRecord: { appearance: { speciesId: 'mao-ao' } },
    avatarRef: { group: owner, handRigAvatarRoot },
    _banditToolHolder: existing, _rangedMode: false, enemyLoadoutKind: 'bandit',
    def: { weaponKey: 'hatchet_nativeCopper', weaponShapeStats: window.WeaponShapeStats.forShape('hatchet'), maxStamina: 1,
      attackDamage: 15, attackRangePx: 120, attackHalfConeRad: 1, attackCooldownS: 1, attackStaminaCost: 10,
      attackTag: 'sharp', banditAbilityLoadout: { tap1: 'swingCombo', tap2: 'jab', hold1: 'chargedBreaker' } },
  };
}
window.BanditCombat = {
  init: () => true,
  makeEntity: async () => entity(),
};
load('docs/js/bandit-captain-armaments.js');
const cap = window.BanditCaptainArmaments;
window.DelversGuild = { isMember: () => licensed };
window.FeyArmamentQuest = { completed: () => feyComplete };
load('docs/js/harlyao-relics.js'); // Use the real service price and inventory reconstruction.
window.HarlyaoRelics.init(deps);
let story = { delversGuild: {} }; // Portable custody ledger for this integration test.
window.__hobunjiPlayerProfile = { worldId: 'captain-audit', characterId: 'owner' };
window.OpeningStoryCutscene = { getStory: () => story, updateStory: (_p, fields) => { story = { ...story, ...fields }; return true; } };
load('docs/js/town-magic-checkpoint.js');
const checkpoint = window.TownMagicCheckpoint;
checkpoint.bindInventoryDeps({ ...deps, getPackClothing: () => [] });
window.CharacterMetaSave = { update(fn) { if (!allowSave) return false; fn({}, {}); return true; } };
load('docs/js/gear-member-transaction.js');
window.GearMemberTransaction.init({ ...deps, captureMemberWorldData: () => ({}) });
assert.equal(cap.init(deps), 0);
window.BanditCombat.init(deps);

// The available donor shapes are exactly the cultural FULL weapons; the
// candidate generator must also respect every genuine Foundry disallow.
const pairs = cap.eligiblePairs(culturalWeapons);
assert(pairs.length > 0, 'captains require at least one real craft-compatible donor pair');
assert.equal(config.heads['war-cleaver'].editorOnly, false, 'War-cleaver head is available in the real authored catalog');
assert.equal(config.shafts['war-cleaver'].editorOnly, false, 'War-cleaver haft is now also available, not just the head');
assert(pairs.some(pair => pair.head === 'war-cleaver'), 'the already-enabled War-cleaver head must be in eligible pair choices');
assert(pairs.some(pair => pair.shaft === 'war-cleaver'), 'newly enabled War-cleaver haft must have at least one culturally legal Foundry pair');
for (const pair of pairs) {
  assert(culturalWeapons.includes(pair.donors[0]) && culturalWeapons.includes(pair.donors[1]));
  assert.equal(modular.isDisallowed(pair.shaft, pair.head), false, 'the Foundry veto must never be bypassed');
  assert(!config.shafts[pair.shaft].editorOnly && !config.heads[pair.head].editorOnly && !config.heads[pair.head].craftDisabled);
}
assert.equal(cap.eligiblePairs(['hatchet', 'warCleaver']).every(pair => pair.donors.every(shape => ['hatchet','warCleaver'].includes(shape))), true);
assert.equal(cap.eligiblePairs(['shape-that-does-not-exist']).length, 0, 'no imaginary donor weapons');
const migratedStorage = new Map(); // Simulates an older browser draft that still marks the War-cleaver grip as editor-only.
const savedDraft = JSON.parse(JSON.stringify(window.MODULAR_WEAPON_CONFIG));
savedDraft.shafts['war-cleaver'].editorOnly = true;
migratedStorage.set('hobunji.modularWeapons.v5', JSON.stringify(savedDraft));
const migratedWindow = { MODULAR_WEAPON_CONFIG: window.MODULAR_WEAPON_CONFIG,
  localStorage: { getItem: key => migratedStorage.get(key) || null, setItem: (key, value) => migratedStorage.set(key, value) } };
vm.runInNewContext(fs.readFileSync('docs/js/modular-weapons.js', 'utf8'), { window: migratedWindow, console });
assert.equal(migratedWindow.ModularWeapons.getConfig().shafts['war-cleaver'].editorOnly, false, 'existing browser drafts migrate to a usable War-cleaver shaft');
assert.equal(migratedStorage.get('hobunji.modularWeapons.warCleaverForgeable.v1'), '1', 'the new migration runs just once');
assert(!cap.eligiblePairs(['workhammer','hatchet']).some(pair => pair.donors.includes('warCleaver')),
  'captains without the correct cultural donor cannot acquire War-cleaver pieces');

// Star counts, limits and ban on Fey are enforced before spawning.
for (const [tier, expected] of [[4,2],[5,3],[6,4],[7,5]]) {
  const stars = cap.capStars(tier);
  const state = cap.rollEnchantments(stars, () => 0.37);
  assert.equal(state.base.length + Object.keys(state.flourishes).length, expected, stars + '★ count');
  assert.equal(state.base.length, 2);
  assert.equal(new Set(state.base).size, 2, 'bases are distinct');
  assert.equal(new Set(Object.values(state.flourishes)).size, expected - 2, 'Flourishes are distinct');
  assert(Object.keys(state.flourishes).every(slot => ['tap1','tap2','hold1'].includes(slot)));
  for (const id of [...state.base,...Object.values(state.flourishes)]) assert.notEqual(definitions[id].alignment, 'Fey');
  for (const [slot,id] of Object.entries(state.flourishes)) assert(catalogWindow.EnchantmentSystem.allowsFlourishSlot(id,slot), 'captain uses a legal slot');
}

// Exercise seeded selection across many roll orders, not just the fixed fixture RNG.
let seed = 139;
const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
for (let i=0;i<500;i++) {
  const state=cap.rollEnchantments(8,rng);
  assert(state && state.base.length===2 && Object.keys(state.flourishes).length===3, '8-star weapon never loses a promised enchantment');
  for (const [slot,id] of Object.entries(state.flourishes)) assert(catalogWindow.EnchantmentSystem.allowsFlourishSlot(id,slot));
}

(async () => {
  const below = await window.BanditCombat.makeEntity({}, 'captain', 3, 0, 0);
  assert.equal(below._banditCaptainArmament, undefined, '4★ captain stays with a full weapon');
  assert.equal((await window.BanditCombat.makeEntity({}, 'lieutenant', 7, 0, 0))._banditCaptainArmament, undefined);
  assert.equal((await window.BanditCombat.makeEntity({ weaponShapePool: ['shape-that-does-not-exist'] }, 'captain', 7, 0, 0))._banditCaptainArmament, undefined, 'a restricted full-weapon pool cannot be widened by the modular roller');
  assert.equal((await window.BanditCombat.makeEntity({ _preserveMineEnemyTiers: true }, 'captain', 7, 0, 0))._banditCaptainArmament, undefined, 'mine ghouls are not ordinary captains');
  assert.equal((await window.BanditCombat.makeEntity({}, 'captain', 7, 0, 0, { defOverride: { weaponKey: 'authored' } }))._banditCaptainArmament, undefined, 'authored enemy weapons are protected');

  const first = await window.BanditCombat.makeEntity({}, 'captain', 4, 0, 0);
  const second = await window.BanditCombat.makeEntity({}, 'captain', 7, 0, 0);
  const weapon = first._banditCaptainArmament, weapon2 = second._banditCaptainArmament;
  assert(weapon && weapon2, 'eligible captains must have a modular weapon');
  assert(weapon.key.startsWith(cap.PREFIX) && weapon.key !== weapon2.key, 'each lootable weapon has independent identity');
  assert.equal(modular.decode(weapon.key).metal, 'nativeCopper');
  assert.equal(first.def.weaponKey, weapon.key, 'AI damage and rendering use the held unique key');
  assert(first.def.maxStamina >= first.def.attackStaminaCost * 2, 'new modular grip must retain the ordinary two-opening-attacks stamina floor');
  assert(first.maxStamina >= first.def.maxStamina && first.stamina >= first.def.attackStaminaCost, 'living captain stamina must be synchronized with its new budget');
  assert.equal(first._banditToolHolder.userData.hobunjiHeldPortraitOwner, first.avatarRef.group, 'holder remains attached to correct portrait mask');
  assert.equal(first.avatarRef.handRigAvatarRoot.userData.proceduralHandToolHolder, first._banditToolHolder, 'hands follow the replacement in the same frame');
  assert.equal(toolDefs[weapon.key].sprite, modular.itemKey(weapon.shaft, weapon.head, weapon.metal), 'special drop reuses the real authored assembled PNG');
  assert.equal(toolDefs[weapon.key].modular.shaft, weapon.shaft);
  assert.equal(toolDefs[weapon.key].captainModular, true);
  assert.deepEqual(Object.keys(gear.tools), [], 'simply spawning a captain cannot grant player ownership');
  assert.deepEqual(Object.keys(gear.weaponEnchantments), [], "simply spawning must not teach the player's enchantment system");
  assert(cap.unlootedEnchantmentState(weapon.key), 'living captain holds private enchantments until searched');

  cap.emitHit(first, { health: 5 }, 12, 'tap1', { comboFinisher: true });
  cap.emitHit(first, { health: 5 }, 12, 'hold2');
  assert.equal(eventLog.length, 2);
  assert.equal(eventLog[0].comboFinisher, true);
  assert.equal(eventLog[0].attacker, first);
  assert.equal(eventLog[1].slotId, 'hold2', 'counter-riposte still applies Base effects');

  const before = JSON.stringify(modular.unlockedParts([], gear, toolDefs));
  const boundKey = cap.boundKeyFor(first);
  allowSave = false;
  assert.equal(cap.grantCorpseWeapon(first), null, 'a rejected pack save leaves the corpse retryable');
  assert.equal(bag[boundKey], undefined);
  allowSave = true;
  throwSave = true;
  assert.equal(cap.grantCorpseWeapon(first), null, 'thrown storage rejection cannot grant a weapon');
  assert.equal(bag[boundKey], undefined);
  throwSave = false;
  const name = cap.grantCorpseWeapon(first);
  assert.match(name, /Bound Captain's/);
  assert.equal(bag[boundKey], 1);
  assert.equal(gear.tools[weapon.key], undefined, 'bound loot cannot enter equipment');
  assert.equal(gear.enchantmentUnlocks, undefined, 'loot does not teach any enchantment');
  assert.equal(savedGearCount, 1);
  assert.equal(cap.unlootedEnchantmentState(weapon.key), null);
  delete itemDefs[boundKey];
  window.HarlyaoRelics.ensureInventoryItemDefs(bag);
  assert.equal(itemDefs[boundKey].uniqueInventoryKey, true, 'pack identity rehydrates through the real relic startup path');
  assert.equal(cap.registerBoundWeapon(boundKey).reason, 'license');
  delete itemDefs[boundKey];
  assert.equal(checkpoint.pending().find(entry => entry.key === boundKey).count, 1, 'codec detects contraband even without a cached catalog entry');
  assert.equal(checkpoint.confiscate().ok, true);
  assert.equal(bag[boundKey], undefined);
  assert.equal(checkpoint.registerAndReturn('inventory:' + boundKey).reason, 'license');
  licensed = true;
  assert.equal(cap.registerBoundWeapon(boundKey).reason, 'not-owned', 'registration cannot bypass custody');
  allowSave = false;
  assert.equal(checkpoint.registerAndReturn('inventory:' + boundKey).ok, false, 'rejected reclaim leaves the weapon in custody');
  assert.equal(bag[boundKey], undefined);
  allowSave = true;
  assert.equal(checkpoint.registerAndReturn('inventory:' + boundKey).ok, true);
  assert.equal(bag[boundKey], 1);
  assert.equal(checkpoint.pending().some(entry => entry.key === boundKey), false, 'legal transport after reclaim does not retrigger Spearhead');
  assert.equal(gear.tools[weapon.key], undefined);
  assert.equal(gear.enchantmentUnlocks, undefined, 'custody release alone teaches nothing');
  const afterCustodySaves = savedGearCount; // Repeated corpse requests may not perform another member write.
  const goldBefore = bag.gold;
  const price = window.HarlyaoRelics.unbindPrice(weapon.enchantments);
  bag.gold = 0;
  assert.equal(cap.registerBoundWeapon(boundKey).reason, 'gold');
  assert.equal(bag[boundKey], 1);
  bag.gold = goldBefore;
  allowSave = false;
  assert.equal(cap.registerBoundWeapon(boundKey).reason, 'save');
  assert.equal(bag[boundKey], 1);
  assert.equal(bag.gold, goldBefore);
  assert.equal(gear.enchantmentUnlocks, undefined);
  allowSave = true;
  assert.equal(cap.registerBoundWeapon(boundKey).ok, true);
  assert.equal(bag.gold, goldBefore - price);
  assert.equal(bag[boundKey], undefined);
  assert.equal(gear.tools[weapon.key], true);
  assert.equal(gear.captainModularWeapons[weapon.key].stars, 5);
  assert.equal(gear.weaponEnchantments[weapon.key].base.length, 2);
  for (const id of weapon.enchantments.base) assert.equal(window.EnchantmentSystem.isBaseUnlocked(id), true);
  assert.equal(JSON.stringify(gear.weaponEnchantmentVisuals[weapon.key]), JSON.stringify(weapon.visual), 'registration preserves the exact particle choices');
  assert.equal(JSON.stringify(modular.unlockedParts([], gear, toolDefs)), before, 're-registration must not unlock donor recipes');
  assert.equal(gear.tools.hatchet_nativeCopper, undefined);
  assert.equal(cap.grantCorpseWeapon(first), name);
  assert.equal(savedGearCount, afterCustodySaves);
  assert.equal(cap.registerBoundWeapon(boundKey).ok, false, 'registration cannot be repeated');
  assert.deepEqual(Object.keys(gear.tools), [weapon.key]);

  const secondBound = cap.boundKeyFor(second);
  cap.grantCorpseWeapon(second);
  assert.equal(bag[secondBound], 1);
  assert.equal(cap.registerBoundWeapon(secondBound).ok, true);
  assert.equal(Object.keys(gear.tools).length, 2);
  assert.equal(gear.weaponEnchantments[weapon2.key].base.length + Object.keys(gear.weaponEnchantments[weapon2.key].flourishes).length, 5);
  for (const [slot,id] of Object.entries(weapon2.enchantments.flourishes)) {
    assert.equal(window.EnchantmentSystem.isFlourishUnlocked(id, slot), true);
    for (const other of ['tap1','tap2','hold1','hold2'].filter(s => s !== slot)) assert.equal(window.EnchantmentSystem.isFlourishUnlocked(id, other), false, 'registration unlocks only the recovered slot');
  }
  delete toolDefs[weapon.key]; delete toolDefs[weapon2.key];
  assert.equal(cap.restore(), 2, 'save restore must re-register both independent weapon definitions');
  assert(toolDefs[weapon.key] && toolDefs[weapon2.key]);

  // Game startup injects relic dependencies BEFORE loading the player's saved gear.
  // The real post-load HarlyaoRelics.restore() must therefore rehydrate captain
  // definitions again, not rely on a one-off initialization hook.
  let postLoadRestores = 0; // Counts post-gear-load restoration through the real Harlyao API.
  const startupWindow = { BanditCaptainArmaments: {
    init() { return 0; },
    restore() { postLoadRestores++; return cap.restore(); },
  } };
  const relicContext = vm.createContext({ window: startupWindow, console });
  vm.runInContext(fs.readFileSync('docs/js/harlyao-relics.js', 'utf8'), relicContext);
  startupWindow.HarlyaoRelics.init({ TOOL_ITEM_DEFS: toolDefs, ITEM_DEFS: {}, inventory: {}, getGearInventory: () => gear });
  delete toolDefs[weapon.key]; delete toolDefs[weapon2.key];
  startupWindow.HarlyaoRelics.restore();
  assert.equal(postLoadRestores, 1, 'late gear restoration calls the captain definition rehydrator');
  assert(toolDefs[weapon.key] && toolDefs[weapon2.key], 'a character loaded from saved gear can still equip its individual captain weapons');

  assert.equal(modular.decode('banditModular:constructor:dagger:nativeCopper:hi'), null, 'prototype identifiers cannot become parts');

  // Run the REAL hit publisher and enchantment listeners in an isolated
  // browser-like world: an NPC hit must apply both the Base status and the
  // qualifying Combo Flourish without creating player gear unlocks.
  const enemyGear = { weaponEnchantments: {} }; // Read-only player ownership control for real hostile enchantment events.
  const nativeEnemy = { health: 30, maxHealth: 30 }; // Recipient of the real target damage event.
  const nativeAttacker = { health: 40, maxHealth: 40 }; // Hostile enchantment wielder and sole Flourish recipient.
  const nativeState = { base: ['burning', 'mirrored'], flourishes: { tap1: 'fury' } }; // A legal, non-Fey captain loadout.
  const nativeWindow = {
    Combat: { deps: { getGearInventory: () => enemyGear, player: {} }, loadout: { SLOT_IDS: ['tap1','tap2','hold1','hold2'] } },
    ResourceSystem: {
      addAffliction(target, id, amount) { target[id] = (target[id] || 0) + amount; return amount; },
      addEnhancedResource(target, id, amount) { target[id] = (target[id] || 0) + amount; return amount; },
    },
    BanditCaptainArmaments: { unlootedEnchantmentState: key => key === weapon.key ? nativeState : null },
    GameRandom: { random: () => 0.9 },
    __farmLog() {},
  };
  const nativeContext = vm.createContext({ window: nativeWindow, console, performance: { now: () => 3000 } });
  vm.runInContext(fs.readFileSync('docs/js/combat/combat-attack-events.js', 'utf8'), nativeContext);
  vm.runInContext(fs.readFileSync('docs/js/combat/combat-enchantments.js', 'utf8'), nativeContext);
  nativeWindow.CombatAttackEvents.hit(null, {
    attacker: nativeAttacker, target: nativeEnemy, weaponKey: weapon.key,
    slotId: 'tap1', attackCategory: 'combo', comboFinisher: true, actualDamage: 12,
  });
  assert(nativeEnemy.burningHealth > 0, 'real Base listener burns the hostile captain\'s victim');
  assert(nativeAttacker.mirroredHealth > 0, 'real Base listener credits actual hit damage to the captain');
  assert(nativeAttacker.furiousStamina > 0, 'real Combo finisher triggers the captain\'s Fury Flourish');
  assert.equal(Object.keys(enemyGear.weaponEnchantments).length, 0, 'unlooted hostile enchantments never become player-owned gear');

  const gameEntry = fs.readFileSync('docs/index.html', 'utf8'); // Authoring tools must execute the same held-action bootstrap that owns bandit hands.
  const handRuntimeVersion = /js\/held-action-animations\.js\?v=([A-Za-z0-9_-]+)/.exec(gameEntry)?.[1];
  assert(handRuntimeVersion, 'gameplay must load a versioned hand runtime');
  for (const entry of [
    'docs/tools/animation-author/index.html',
    'docs/tools/attack-animation-editor/index.html',
    'docs/tools/enemy-loadout-editor/preview.js',
    'docs/tools/omgurku-calibration/index.html',
  ]) {
    const text = fs.readFileSync(entry, 'utf8');
    assert(text.includes('held-action-animations.js?v=' + handRuntimeVersion),
      entry + ' must use the gameplay hand runtime rather than cached old hand attachment rules');
  }

  const handSource = fs.readFileSync('docs/js/procedural-hand-frame-driver.js', 'utf8');
  const actorIndex = handSource.indexOf('const actorHolder = record?.avatarRoot?.userData?.proceduralHandToolHolder === toolHolder');
  const playerSnapshotIndex = handSource.indexOf('const snapshot = editor ? null : (global.WeaponToolStances');
  assert(actorIndex > 0 && playerSnapshotIndex > actorIndex, 'actor grip basis must be resolved before consulting player stance snapshot');
  assert(handSource.includes('const mirrorX = Number(visibleMesh?.scale?.x) < 0'), 'bandit Backhand detects the visible weapon reflection');
  assert(handSource.includes('if (visualBasis.mirrorX) localOffset.x = -localOffset.x'), 'actual hand socket offset follows the mirrored weapon handle');
  const combatSource = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
  for (const slot of ['tap1','tap2','hold1','hold2']) assert(combatSource.includes("enchantmentSlot: '"+slot+"'"), 'all captain attack families publish their real slot: ' + slot);
  assert(combatSource.includes('BanditCaptainArmaments?.tick?.'), 'enemy blade VFX are updated by the live hostile weapon loop');
  // Rootledoot pool is exactly the legal union of dagger hafts and Porakaneki club heads.
  const rootPairs=cap.rootledootPairs();assert(rootPairs.length>0);
  for(const [shaft,s] of Object.entries(config.shafts))for(const [head,h] of Object.entries(config.heads)){
    const expected=!s.editorOnly&&!h.editorOnly&&!h.craftDisabled&&(shaft==='dagger'||head==='porakaneki-greatclub')&&!modular.isDisallowed(shaft,head);
    assert.equal(rootPairs.some(p=>p.shaft===shaft&&p.head===head),expected);
  }
  // Exercise the actual initial bandit weapon roll as well as the subsequent enchantment wrapper.
  const banditSource=fs.readFileSync('docs/js/combat/combat-bandit.js','utf8'),start=banditSource.indexOf('  function banditWeaponFor('),end=banditSource.indexOf('  function banditRangedWeaponFor(',start);
  const select=new Function('window','deps','configuredWeaponMetalKey','rollBanditWeaponMetalKey',banditSource.slice(start,end)+';return banditWeaponFor;');
  for(const rank of ['grunt','lieutenant','captain'])for(let i=0;i<rootPairs.length;i++){
    const roll=select(window,{...deps,rnd:()=> (i+.5)/rootPairs.length,metalDmgMultiplier:()=>1},()=> 'nativeCopper',()=> 'nativeCopper');
    const weapon=roll({_rootledootWeaponPool:true},rank,0);assert(cap.isRootledootWeapon(weapon.weaponKey));assert.equal(weapon.animStyle,toolDefs[weapon.weaponKey].animStyle);
  }
  for(const rank of ['grunt','lieutenant'])for(const roll of [0.1,0.4,0.9]){
    const actor=entity();actor.rootledoot=true;actor.enemyClass='rootledoot';const part=rootPairs[0];actor.def.weaponKey=modular.itemKey(part.shaft,part.head,'nativeCopper');
    cap.equip(actor,{},rank,0,{}, {...deps,rnd:()=>roll});assert(cap.isRootledootWeapon(actor.def.weaponKey));assert.equal(!!actor._banditCaptainArmament,roll<(rank==='lieutenant'?.5:.25));
    if(actor._banditCaptainArmament){assert.equal(actor._banditCaptainArmament.origin,'Fey');assert(actor._banditCaptainArmament.enchantments.base.every(id=>definitions[id].alignment==='Fey'));cap.discard(actor);}
  }
  // Rootledoots use the actual modular catalog even below the normal captain's minimum tier.
  for(let tier=0;tier<=7;tier++){
    const boss=entity();boss.rootledootBig=true;boss.enemyClass='rootledoot';
    cap.equip(boss,{},'captain',tier,{},deps);
    const record=boss._banditCaptainArmament;
    assert(record,'every Big Rootledoot tier gets an enchanted weapon');
    assert.equal(record.origin,'Fey');
    assert(record.shaft==='dagger'||record.head==='porakaneki-greatclub');assert(!modular.isDisallowed(record.shaft,record.head));
    assert.equal(record.visual.alignment,'Fey');
    const ids=[...record.enchantments.base,...Object.values(record.enchantments.flourishes)];
    assert(ids.length>0&&ids.every(id=>definitions[id].alignment==='Fey'));
    assert.equal(boss.def.weaponKey,record.key);
    const saveCount=savedGearCount;
    if(tier===0){
      const boundKey = cap.boundKeyFor(boss);
      assert.match(cap.grantCorpseWeapon(boss,{deferSave:true}),/Bound Fey-touched/);
      assert.equal(bag[boundKey],1);
      const questWindow = { BanditCaptainArmaments: cap, EnchantmentSystem: window.EnchantmentSystem, __hobunjiPlayerProfile: { worldId: 'captain-audit', questProgress: {} } };
      vm.runInNewContext(fs.readFileSync('docs/js/fey-armament-quest.js','utf8'), { window: questWindow, document: { addEventListener() {} } });
      questWindow.FeyArmamentQuest.bindInventoryDeps(deps);
      assert(questWindow.FeyArmamentQuest.ownedFeyWeaponKeys().includes(boundKey), 'the actual Fey quest discovers bound modular loot before it can be equipped');
      assert.equal(questWindow.FeyArmamentQuest.maybeStart({ deferSave: true, silent: true }), true);
      assert.equal(gear.tools[record.key],undefined);
      assert.equal(cap.registerBoundWeapon(boundKey).reason,'quest');
      assert.equal(savedGearCount,saveCount,'atomic owner performs the save, not the weapon helper');
      assert(cap.unlootedEnchantmentState(record.key),'the record remains available until transaction completion');
      cap.discard(boss);
      assert.equal(toolDefs[record.key],undefined,'bound pack loot needs no live tool definition');
      feyComplete=true;
      assert.equal(cap.registerBoundWeapon(boundKey).ok,true);
      assert.equal(cap.unlootedEnchantmentState(record.key),null);
      delete toolDefs[record.key];
      cap.restore();
      assert.match(toolDefs[record.key].label,/Fey-touched/,'restoration preserves the Fey name and origin');
    }else{
      let disposed=0;
      window.CharacterHeldTools={toolTextures:{[record.key]:{dispose(){disposed++;}}},modularToolGeometries:new Map([[record.key,{dispose(){disposed++;}}]])};
      cap.discard(boss);
      assert.equal(disposed,2,'abandoned unique weapon releases its texture and geometry');
      assert.equal(toolDefs[record.key],undefined);
      assert.equal(cap.unlootedEnchantmentState(record.key),null);
      assert.equal(gear.tools[record.key],undefined);
    }
  }
  console.log('Bandit captain modular/enchantment/loot/hand-pose regression checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
