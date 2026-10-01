#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Assertions exercise the real quest, loadout, and unlock modules.
const fs = require('node:fs'); // Reads production files and authored maps.
const vm = require('node:vm'); // Isolates one character's runtime and save state.

class Element {
  constructor() { this.children = []; this.style = {}; this.dataset = {}; this.hidden = false; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  addEventListener() {}
  querySelector() { return null; }
}
function harness() {
  const progress = {}; // Live world-member quest store, retained when a session is cancelled.
  const learned = {}; // Real technique persistence is inspected through the shared in-memory localStorage.
  const gear = { tools: { hatchet: true, crossbow: true }, rangedAmmoLoadouts: {}, specialAmmo: 2 }; // Only these weapons are actually owned.
  const equipment = { weapon: 'hatchet', ranged: 'crossbow' }; // Borrowed spear/mace never enter gear.tools.
  let clock = 100, dialogueCount = 0, spawnWait = null; // Deterministic coaching clock and automatically opened dialogue count.
  let area = 'map_i_watchhouse', dialogue = false, combatLevel = 0, mastery = 0, target = null, saves = 0, restores = 0, failTravel = false; // Harness-owned game closures.
  const walker = { area, pause: 0, root: { position: { x: 8.5, z: 11.5 } }, transferToArea(next, pos) { this.area = next; this.root.position = { x: pos.c + 0.5, z: pos.r + 0.5 }; } }; // Real controller moves and restores this actor.
  const body = new Element(); // Captures the mobile panel and its enabled controls.
  const document = { body, head: new Element(), createElement: () => new Element(), addEventListener() {}, querySelector: () => null, getElementById: () => null }; // No browser-only dependency is needed for the state-machine tests.
  const window = { Combat: { deps: { toolMasteryLevel: () => mastery, weaponDamageTypeForTool: () => 'sharp', currentWeaponKey: () => equipment.weapon, currentComboAbilityId: () => equipment.weapon === 'fishingspear' ? 'pokeCombo' : 'swingCombo' }, input: { abortAllPresses() {} }, cancelAllStaged() {} }, DialogueContent: { registerTreeProvider() {}, registerNodeEnterHandler() {}, registerActionHandler() {} }, SkillSystem: { level: () => combatLevel }, dispatchEvent() {}, __hobunjiPlayerProfile: { characterId: 'test' } }; // Production modules attach to this namespace.
  const context = vm.createContext({ window, document, console, performance: { now: () => clock }, localStorage: { getItem: key => learned[key] || null, setItem: (key, value) => { learned[key] = value; } }, requestAnimationFrame: fn => fn(), CustomEvent: function () {}, Event: function () {}, MutationObserver: function () { this.observe = () => {}; } }); // Runtime API shims for the existing unlock module.
  vm.runInContext(fs.readFileSync('docs/js/dialogue-templates.js', 'utf8'), context);
  const rangedSource = fs.readFileSync('docs/js/combat/ranged-weapons.js', 'utf8'); // Real ammo choices feed generated preview stages.
  vm.runInContext(rangedSource.slice(rangedSource.indexOf('  const BASIC_AMMO_EFFECTS'), rangedSource.indexOf('  const AUTHORED_FIRE_POSE')) + ';window.RangedWeapons = { BASIC_AMMO_EFFECTS, SPECIAL_AMMO_TYPES };', context);
  for (const path of ['combat-loadout', 'technique-scrolls', 'combat-progression', 'combat-tutorial-content', 'combat-tutorial-mastery', 'combat-tutorial']) vm.runInContext(fs.readFileSync(`docs/js/combat/${path}.js`, 'utf8'), context, { filename: path });
  for (const [id, category] of Object.entries({ swingCombo: 'combo', pokeCombo: 'combo', opportunistJab: 'quickAttack', exhaustCutter: 'quickAttack', mercySpike: 'quickAttack', backstabFlick: 'quickAttack', chargedBreaker: 'offensiveHold', acceleratingFlurry: 'offensiveHold', counterShield: 'defensiveHold', blinkDodge: 'defensiveHold' })) window.Combat.abilities.register(id, { category, slotFamily: category === 'combo' || category === 'quickAttack' ? 'tap' : 'hold', label: id });
  const api = window.CombatTutorial; // Actual controller under test.
  api.init({ getQuestProgress: () => progress, getArea: () => area, getGear: () => gear, equipment, toolDefs: { hatchet: { label: 'Test Hatchet', slots: ['weapon'], dmgType: 'sharp' }, crossbow: { label: 'Test Crossbow', slots: ['ranged'] } }, mastery: () => mastery, save: () => { saves++; }, getWalker: () => walker, closeDialogue: () => { dialogue = false; }, openDialogue: async () => { dialogue = true; dialogueCount++; }, dialogueOpen: () => dialogue, toast() {}, capture: () => ({ equipmentSlots: { ...equipment }, activeTool: 'weapon' }), restore: original => { Object.assign(equipment, original.equipmentSlots); restores++; }, enterArena: async () => { if (failTravel) throw new Error('map unavailable'); area = window.CombatTutorialContent.ARENA; }, exitArena: async () => { area = 'map_i_watchhouse'; }, resetPractice() {}, equip: (key, slot) => { equipment[slot] = key; }, spawnTarget: lesson => { target = { lesson }; return spawnWait ? spawnWait.then(() => target) : target; }, removeTarget: () => { target = null; }, maintainTarget() {} });
  return { setSpawnWait(value) { spawnWait = value; }, advance(ms) { for (let remaining = ms; remaining > 0; remaining -= 100) { clock += Math.min(100, remaining); api.update(); } }, get dialogueCount() { return dialogueCount; }, closeDialogue() { dialogue = false; }, document, api, window, progress, gear, equipment, walker, body, setLevel: value => { combatLevel = value; }, setMastery: value => { mastery = value; }, setFailTravel: value => { failTravel = value; }, setArea: value => { area = value; }, get saves() { return saves; }, get restores() { return restores; }, get target() { return target; }, explain() { api.onNode({ combatTutorialPractice: true }, {}); dialogue = false; api.update(); }, finishStep() { const lesson = api.debugSnapshot().steps.find(s => s.id === api.debugSnapshot().step); this.explain(); for (let i = 0; i < (lesson.count || 1); i++) api.observe(lesson.check, { target, abilityId: lesson.ability, ammoId: lesson.preview?.kind === 'specialAmmo' ? lesson.preview.optionId : 'basic' }); return api.next(); } };
}
(async () => {
  const h = harness(); // First-time player with no unlocked techniques and no Mastery.
  assert.equal(h.api.gate(h.window.CombatTutorialContent.quests[0]), '');
  assert.equal(await h.api.start('spearhead_openings', h.walker), false, 'prerequisite cannot be bypassed');
  assert.equal(await h.api.start('not_a_quest', h.walker), false);
  assert.equal(await h.api.start('spearhead_basics', h.walker), true);
  assert.equal(h.progress.spearhead_basics.status, 'active');
  assert.equal(h.walker.area, 'map_i_watchhouse_arena');
  assert.equal(await h.api.next(), false, 'cannot skip the explanation');
  await h.finishStep();
  assert.equal(h.api.debugSnapshot().step, 'swing');
  h.explain();
  h.api.hit({}, { abilityId: 'swingCombo' });
  h.api.hit(h.target, { abilityId: 'pokeCombo' });
  assert.equal(h.api.debugSnapshot().hits, 0, 'unrelated targets and wrong attacks do not count');
  h.api.hit(h.target, { abilityId: 'swingCombo' });
  assert.equal(await h.api.next(), false, 'one hit is not three');
  h.api.hit(h.target, { abilityId: 'swingCombo' }); h.api.hit(h.target, { abilityId: 'swingCombo' });
  assert.equal(await h.api.next(), true);
  assert.equal(h.equipment.weapon, 'fishingspear');
  assert.equal(h.gear.tools.fishingspear, undefined, 'loan is not owned');
  assert.equal(h.api.originalEquipment().equipmentSlots.weapon, 'hatchet', 'save adapter sees original equipment');
  await h.api.leave(true);
  assert.equal(h.equipment.weapon, 'hatchet');
  assert.equal(h.walker.area, 'map_i_watchhouse');
  assert.equal(h.progress.spearhead_basics.step, 2, 'cancellation preserves completed exercises');
  assert.equal(await h.api.start('spearhead_basics', h.walker), true);
  assert.equal(h.api.debugSnapshot().step, 'poke');
  while (h.api.debugSnapshot().step) {
    if (h.api.debugSnapshot().step === 'breaker') {
      assert.equal(h.window.Combat.loadout.getSlot('hold1'), 'chargedBreaker', 'real dispatch borrows the locked technique');
      assert.equal(h.window.TechniqueScrolls.isUnlocked('chargedBreaker'), false, 'loan does not teach it');
      assert.equal(h.window.Combat.loadout.serialize().fishingspear, undefined, 'loan does not save a per-weapon loadout');
      assert.equal(h.window.Combat.loadout.setSlot('hold1', 'chargedBreaker'), false, 'loan is not an ownership bypass');
    }
    await h.finishStep();
  }
  assert.equal(await h.api.finish('mercySpike'), false, 'cannot claim an untried ability');
  assert.equal(await h.api.finish(), false, 'cannot bypass an available reward');
  assert.equal(await h.api.finish('chargedBreaker'), true);
  assert.equal(h.window.TechniqueScrolls.isUnlocked('chargedBreaker'), true);
  assert.equal(h.window.TechniqueScrolls.isUnlocked('acceleratingFlurry'), false);
  assert.equal(h.progress.spearhead_basics.status, 'completed');
  assert.equal(h.equipment.weapon, 'hatchet');
  assert.equal(h.window.Combat.loadout.getSlot('hold1'), null, 'original empty loadout restored after reward');
  assert.equal(await h.api.finish('counterShield'), false, 'double claiming cannot grant another reward');
  assert.match(h.api.gate(h.window.CombatTutorialContent.quests.find(q => q.id === 'spearhead_openings')), /Combat level 2/);
  h.setLevel(2);
  assert.equal(await h.api.start('spearhead_openings', h.walker), true);
  await h.finishStep(); h.explain();
  h.api.hit(h.target, { abilityId: 'opportunistJab', conditionBonusUsed: false });
  assert.equal(h.api.debugSnapshot().hits, 0, 'ordinary jab cannot satisfy the conditional practice');
  h.api.hit(h.target, { abilityId: 'opportunistJab', conditionBonusUsed: true });
  assert.equal(h.api.debugSnapshot().hits, 1);
  await h.api.leave();
  h.setMastery(1);
  assert.equal(h.api.gate(h.window.CombatTutorialContent.masteryQuestTemplate(1)), '');
  assert.match(h.api.gate(h.window.CombatTutorialContent.masteryQuestTemplate(2)), /Complete/);
  assert.equal(await h.api.start(h.window.CombatTutorialContent.masteryQuestTemplate(1, { ranged: true }), h.walker), true);
  h.api.loanAmmo().specialAmmo = 0;
  assert.equal(h.gear.specialAmmo, 2, 'borrowed ammo never spends the real charges');
  await h.finishStep(); h.explain();
  assert.equal(h.api.loanAmmo().rangedAmmoLoadouts.crossbow.basicEffects[1], 'bleedingHealth');
  assert.equal(h.gear.rangedAmmoLoadouts.crossbow, undefined, 'ammo preview leaves saved weapon configuration untouched');
  h.api.hit(h.target, { abilityId: 'swingCombo' });
  assert.equal(h.api.debugSnapshot().hits, 0);
  h.api.hit(h.target, { ranged: true, ammoId: 'basic' });
  assert.equal(h.api.debugSnapshot().hits, 1, 'confirmed projectile hit completes ranged practice');
  h.setArea('town'); h.api.update();
  assert.equal(h.api.active(), false);
  assert.equal(h.api.originalEquipment(), null, 'unexpected travel cleans loans');
  assert.equal(h.equipment.ranged, 'crossbow');
  h.setFailTravel(true);
  assert.equal(await h.api.start('spearhead_basics', h.walker), false);
  assert.equal(h.api.originalEquipment(), null, 'failed map loads clean loans');
  assert.match(h.api.diagnosticsText(), /map unavailable/);

  h.setFailTravel(false); h.setArea('map_i_watchhouse');
  h.equipment.weapon = null;
  assert.match(h.api.gate(h.window.CombatTutorialContent.masteryQuestTemplate(1)), /Equip/, 'owned but unequipped mastery is insufficient');
  h.equipment.weapon = 'hatchet';
  assert.equal(await h.api.start(h.window.CombatTutorialContent.masteryQuestTemplate(1), h.walker), true);
  assert.equal(h.api.debugSnapshot().weapon, 'hatchet');
  assert.match(h.api.selectTree().nodes[0].text, /Test Hatchet/);
  await h.finishStep();
  const trial = h.api.debugSnapshot().preview; // Real progression API should expose the first choice without teaching or saving it.
  assert.equal(trial.kind, 'melee');
  assert.equal(h.window.CombatProgression.getChosenOption('hatchet', trial.ability, 1), null);
  assert.ok(Object.keys(h.window.CombatProgression.getEffects('hatchet', trial.ability).afflictions).length);
  await h.finishStep();
  const alternate = h.api.debugSnapshot().preview; // The next exercise swaps to the alternative at the same rank.
  assert.equal(alternate.index, 1);
  assert.equal(h.window.CombatProgression.getChosenOption('hatchet', alternate.ability, 1), null);
  await h.api.leave();
  assert.equal(Object.keys(h.window.CombatProgression.getEffects('hatchet', alternate.ability).afflictions).length, 0, 'preview effects disappear on exit');
  h.equipment.ranged = null;
  assert.match(h.api.gate(h.window.CombatTutorialContent.masteryQuestTemplate(1, { ranged: true })), /Equip/);
  h.equipment.ranged = 'crossbow';

  h.progress.spearhead_ranged_1.status = 'completed'; h.setMastery(2);
  assert.equal(await h.api.start(h.window.CombatTutorialContent.masteryQuestTemplate(2, { ranged: true }), h.walker), true);
  await h.finishStep(); h.explain();
  assert.equal(h.api.loanAmmo().rangedAmmoLoadouts.crossbow.activeAmmo, 'shrapnel');
  h.api.hit(h.target, { ranged: true, ammoId: 'basic' });
  assert.equal(h.api.debugSnapshot().hits, 0, 'special-ammo trial requires the previewed ammunition');
  h.api.hit(h.target, { ranged: true, ammoId: 'shrapnel' });
  assert.equal(h.api.debugSnapshot().hits, 1);
  await h.api.next();
  assert.equal(h.api.loanAmmo().rangedAmmoLoadouts.crossbow.activeAmmo, 'concussive');
  await h.api.leave();
  assert.equal(h.gear.rangedAmmoLoadouts.crossbow, undefined);

  const automatic = harness(); // Sequential training should never require the removed Next lesson button.
  await automatic.api.start('spearhead_basics', automatic.walker);
  automatic.explain(); automatic.advance(800); await new Promise(resolve => setImmediate(resolve));
  assert.equal(automatic.api.debugSnapshot().step, 'swing', 'read dialogue automatically leads into the first exercise');
  automatic.explain();
  const partner = automatic.target; // The same combatant persists across all lessons.
  automatic.api.hit(partner, { abilityId: 'swingCombo' });
  const conversations = automatic.dialogueCount; // No-progress coaching must repeat instructions without discarding the first hit.
  automatic.advance(45100); await new Promise(resolve => setImmediate(resolve));
  assert.equal(automatic.dialogueCount, conversations + 1, 'Spearhead automatically coaches after 45 seconds without progress');
  assert.equal(automatic.api.debugSnapshot().hits, 1);
  automatic.explain();
  automatic.api.hit(partner, { abilityId: 'swingCombo' });
  automatic.api.hit(partner, { abilityId: 'swingCombo' });
  automatic.advance(400); automatic.api.hit(partner, { abilityId: 'swingCombo' });
  automatic.advance(400); await new Promise(resolve => setImmediate(resolve));
  assert.equal(automatic.api.debugSnapshot().step, 'poke', 'required hits automatically trigger the next dialogue');
  assert.equal(automatic.target, partner, 'Oddclaw stays in the arena across lessons');
  assert.equal(automatic.equipment.weapon, 'fishingspear', 'melee lessons explicitly equip the weapon slot');
  assert.equal(automatic.equipment.ranged, 'crossbow', 'melee loans do not overwrite ranged equipment');
  automatic.explain();
  const beforeBackground = automatic.dialogueCount; // Hidden tabs must not be mistaken for struggling.
  automatic.document.hidden = true; automatic.advance(60000);
  automatic.document.hidden = false; automatic.advance(1000);
  assert.equal(automatic.dialogueCount, beforeBackground);
  for (let i = 0; i < 4; i++) automatic.api.hit(partner, { abilityId: 'swingCombo' });
  automatic.advance(8000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(automatic.dialogueCount, beforeBackground + 1, 'repeated wrong attacks trigger an earlier reminder');
  assert.match(automatic.api.selectTree().nodes[0].text, /^That was swingCombo\. This exercise needs pokeCombo\. Once more: /, 'the reminder names the wrong technique');
  automatic.closeDialogue(); automatic.advance(1600);
  assert.equal(automatic.api.debugSnapshot().phase, 'practice', 'closing an explanation early starts practice instead of reopening it');
  assert.equal(automatic.dialogueCount, beforeBackground + 1);
  await automatic.api.leave();

  const menu = harness(); // Mastery comparison sessions are no longer menu lessons; the Afflictions lesson is.
  const menuLabels = () => menu.api.selectTree().nodes.flatMap(node => node.choices.map(choice => choice.label));
  assert.equal(menu.api.selectTree().nodes.length, 1, 'every offered lesson fits on one page');
  assert.ok(!menuLabels().some(label => /Mastery/.test(label)), 'Mastery lessons are not offered in the menu');
  assert.ok(menuLabels().some(label => /^Afflictions /.test(label)), 'the Afflictions lesson is offered');

  const afflictionLesson = harness(); // Demonstrations preview a real upgrade on a borrowed weapon without any earned Mastery.
  afflictionLesson.progress.spearhead_basics = { status: 'completed', progress: {} };
  assert.equal(await afflictionLesson.api.start('spearhead_afflictions', afflictionLesson.walker), true);
  await afflictionLesson.finishStep();
  assert.equal(afflictionLesson.api.debugSnapshot().step, 'aff_bleed');
  assert.equal(afflictionLesson.api.debugSnapshot().preview.demonstration, true);
  assert.ok((afflictionLesson.window.CombatProgression.getEffects('hatchet', 'swingCombo').afflictions || {}).bleedingHealth > 0, 'Bleeding demonstration applies with zero Mastery');
  assert.equal(afflictionLesson.window.CombatProgression.getChosenOption('hatchet', 'swingCombo', 1), null, 'demonstration never saves the upgrade');
  await afflictionLesson.api.leave();
  assert.equal(Object.keys(afflictionLesson.window.CombatProgression.getEffects('hatchet', 'swingCombo').afflictions || {}).length, 0, 'demonstration preview ends with the lesson');

  const talking = harness(); // Walking up to Spearhead mid-exercise is a request for help, not a finished step.
  await talking.api.start('spearhead_basics', talking.walker);
  await talking.finishStep(); talking.explain();
  talking.api.hit(talking.target, { abilityId: 'swingCombo' });
  assert.match(talking.api.selectTree().nodes[0].text, /^Of course\. /);
  assert.equal(talking.api.debugSnapshot().phase, 'explain', 'talking pauses the exercise');
  assert.equal(talking.api.debugSnapshot().hits, 1, 'talking keeps verified progress');
  talking.explain();
  talking.api.hit(talking.target, { abilityId: 'opportunistJab' });
  talking.advance(100);
  assert.match(talking.body.children[0].children.map(child => child.children?.map(line => line.textContent).join('|')).join(''), /That was opportunistJab\. This exercise needs swingCombo\./, 'the objective card names a wrong technique immediately');
  await talking.api.leave();

  const travelling = harness(); // A slow avatar build must not strand borrowed state after the player walks out.
  let finishSpawn; // Resolves the deferred spawn after the area has changed.
  travelling.setSpawnWait(new Promise(resolve => { finishSpawn = resolve; }));
  const startingTravel = travelling.api.start('spearhead_basics', travelling.walker); // Start setup, but hold the asynchronous partner build.
  await new Promise(resolve => setImmediate(resolve));
  travelling.setArea('town');
  finishSpawn();
  assert.equal(await startingTravel, false);
  assert.equal(travelling.api.originalEquipment(), null);
  assert.equal(travelling.target, null);
  assert.equal(travelling.walker.area, 'map_i_watchhouse');

  const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Execute the production humanoid adapter with the rendering boundary stubbed.
  const adapterStart = gameSource.indexOf('        spawnTarget: async () => {'); // Limits the VM to the injected arena partner callbacks.
  const adapterSource = gameSource.slice(adapterStart, gameSource.indexOf('\n      });', adapterStart)); // Keeps spawn, pause, reset, maintain and removal together.
  const oddclaw = { rec: JSON.parse(fs.readFileSync('docs/config/npcs/hobunji-starter-npc-database.json')).npcs.find(npc => npc.id === 'oddclaw_unumanuk'), root: { visible: true } }; // Authored identity, appearance, and dyes must reach the shared combat renderer intact.
  const partnerWindow = {}; // The extracted partner module supplies pause/reset/maintain to the adapter.
  vm.runInNewContext(fs.readFileSync('docs/js/combat/combat-tutorial-partner.js', 'utf8'), { window: partnerWindow });
  const partnerModule = partnerWindow.CombatTutorialPartner;
  partnerModule.init({ TILE: 32 });
  const hostiles = new Set(); // Registration and cleanup use the ordinary combat collection.
  let spawnOptions, disposed = false, cancelled = 0; // Capture rendering/combat boundary effects without replacing adapter behavior.
  const adapter = vm.runInNewContext('({' + adapterSource + '})', {
    npcWalkers: [oddclaw], scheduledNpcRecords: new Map(), TILE: 32, structuredClone,
    hostileObjects: hostiles, despawnCreature() { disposed = true; },
    window: { CombatTutorialPartner: partnerModule, BanditCombat: { loadGangConfig: async () => ({}), makeEntity: async (config, rank, tier, x, y, options) => { spawnOptions = options; return { x, y, maxHealth: 10000, maxStamina: 100, ...options.extra }; } } },
  }); // The live game supplies the actual bandit mesh, collision, animation, and combat executor.
  const sparring = await adapter.spawnTarget(); // Spawn exactly one named humanoid, not an animal with a renamed label.
  assert.equal(spawnOptions.rosterOverride.id, 'oddclaw_unumanuk');
  assert.deepEqual(spawnOptions.rosterOverride.appearance, oddclaw.rec.appearance);
  assert.equal(spawnOptions.enemyClass, 'sparring-partner');
  assert.equal(spawnOptions.defOverride.banditAbilityLoadout.tap1, 'pokeCombo');
  assert.equal(spawnOptions.defOverride.weaponKey, 'fishingspear');
  assert.equal(oddclaw.combatTutorialSuspended, true);
  assert.equal(oddclaw.root.visible, false, 'ordinary NPC cannot duplicate his combat rig');
  sparring._banditAction = { cancel() { cancelled++; } };
  adapter.pauseTarget(sparring);
  assert.equal(cancelled, 1, 'dialogue cancels outstanding staged attacks');
  adapter.resetTarget(sparring);
  assert.equal(sparring.x, 10.5 * 32);
  adapter.maintainTarget(sparring, { condition: 'lowHealth' });
  assert.equal(sparring.health, 2000, 'Mercy Spike receives the real low-health condition');
  sparring.health = 72; sparring.afflictions = { bleedingHealth: 4 }; sparring.knockbackT = 0.2;
  adapter.maintainTarget(sparring, { preview: { kind: 'melee' } });
  assert.equal(sparring.health, 72, 'preview damage remains visible');
  assert.equal(sparring.afflictions.bleedingHealth, 4, 'preview afflictions are not cleared each frame');
  assert.equal(sparring.knockbackT, 0.2, 'preview knockback uses normal movement instead of being cancelled');
  adapter.removeTarget(sparring);
  assert.equal(hostiles.size, 0);
  assert.equal(disposed, true);
  assert.equal(oddclaw.combatTutorialSuspended, false);
  assert.equal(oddclaw.root.visible, true, 'leaving restores the ordinary named NPC');

  const master = { x: 0, y: 0, angle: 0 }; // Player identity for the actual companion synchronization function.
  const companions = new Set([{ master, stableRole: 'companion' }, { master: {}, stableRole: 'companion' }]); // Other owners must retain their companions.
  let training = true, attackCancels = 0; // Exercise suppression and automatic restoration with the stable selection unchanged.
  const syncStart = gameSource.indexOf('      function syncCompanionFromWhistle('); // Extract the real synchronization boundary.
  const syncEnd = gameSource.indexOf('      // Mount ride logic', syncStart); // Next top-level section delimits the existing function.
  const sync = vm.runInNewContext(gameSource.slice(syncStart, syncEnd) + '\nsyncCompanionFromWhistle', {
    player: master, companionObjects: companions, cutscenePreviewActive: false, TILE: 32, currentArea: 'arena',
    stable: [{ id: 'pet', kind: 'gar-wolf', name: 'My Hound' }], CREATURE_DB: { 'gar-wolf': {} }, equipmentSlots: {}, gearInventory: {},
    despawnCompanions(owner, role) { for (const entity of companions) if (entity.master === owner && entity.stableRole === role) companions.delete(entity); },
    makeCreatureEntity(kind, x, y, extra) { return { creatureKey: kind, areaId: 'arena', ...extra }; },
    window: { CombatTutorial: { originalEquipment: () => training ? {} : null }, FarmPanel: { activeStableIdForRole: role => role === 'companion' ? 'pet' : null }, Combat: { animalAttacks: { cancel() { attackCancels++; } } } },
  });
  sync();
  assert.equal(companions.size, 1, 'only the player combat companion is suppressed');
  assert.equal(attackCancels, 1, 'pending animal attacks are cancelled');
  sync(); assert.equal(companions.size, 1, 'stable/whistle sync cannot respawn the companion during training');
  training = false; sync();
  assert.equal([...companions].find(entity => entity.master === master).name, 'My Hound', 'the original stable choice returns after training');

  const bountySource = fs.readFileSync('docs/js/bounty-board.js', 'utf8'); // Tests the naming wrapper that previously overwrote Oddclaw.
  const namingStart = bountySource.indexOf('  function _applyOrdinaryBanditCulturalName('); // Function is reused intact beneath a stub cultural-name forge.
  const namingEnd = bountySource.indexOf('  // Installs the shared', namingStart);
  const preserveName = vm.runInNewContext(bountySource.slice(namingStart, namingEnd) + '\n_applyOrdinaryBanditCulturalName'); // No forge call should occur for an authored NPC.
  const named = { name: 'Oddclaw', npcId: 'oddclaw_unumanuk' }; // Distinct from unnamed generated bandits.
  preserveName(named, 'grunt', { rosterOverride: {} }, { generateCulturalIdentity() { throw new Error('must not rename authored NPC'); } });
  assert.equal(named.name, 'Oddclaw');
  const rangedSource = fs.readFileSync('docs/js/combat/ranged-weapons.js', 'utf8'); // Uses the actual target-label renderer.
  const labelStart = rangedSource.indexOf('  function updateBanditAimLabel()');
  const labelEnd = rangedSource.indexOf('  function update(dt)', labelStart);
  let aimLabel = ''; // Captures the in-game text presented over the sparring partner.
  vm.runInNewContext(rangedSource.slice(labelStart, labelEnd) + '\nupdateBanditAimLabel();', {
    deps: { isWeaponAiming: () => true }, focusedHostile: () => ({ candidate: { data: { isBandit: true, name: 'Oddclaw', combatRoleLabel: 'Sparring Partner', avatarRef: { group: {} } } } }),
    window: { WorldPopupText: { setAimLabel(group, text) { aimLabel = text; } } },
  });
  assert.equal(aimLabel, 'Oddclaw - Sparring Partner');

  const watch = JSON.parse(fs.readFileSync('docs/config/maps/map_i_watchhouse.json')); // Authored floor connectivity and reciprocal exits.
  const arena = JSON.parse(fs.readFileSync('docs/config/maps/map_i_watchhouse_arena.json'));
  assert.equal(watch.exits.find(exit => exit.id === 'exit_watch_training_stairs').targetMap, arena.id);
  assert.equal(arena.exits[0].targetMap, watch.id);
  for (const map of [watch, arena]) {
    const cells = new Set(map.floor.map(cell => cell.join(','))); // Flood fill proves stairs and all arena practice positions are reachable.
    const seen = new Set();
    const queue = [[10, 13]];
    while (queue.length) {
      const [x, y] = queue.pop();
      const key = `${x},${y}`;
      if (!cells.has(key) || seen.has(key)) continue;
      seen.add(key); queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    for (const exit of map.exits) for (const tile of exit.tiles) assert.ok(seen.has(tile.join(',')), `${map.id}: exit is reachable`);
  }
  console.log('Combat tutorial: real unlock/loadout isolation, prerequisites, verified practice, resume, rewards, cancellation, ammo loans, map failure and connected exits passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
