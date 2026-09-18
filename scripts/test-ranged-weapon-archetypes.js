const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let now = 1000; // Deterministic clock used to verify thrown hold/release duration.
let activeTool = 'weapon'; // Used by the dual-role animStyle getter to emulate weapon/ranged slot changes.
let equippedRanged = 'kylie_copper'; // Current ranged-slot item used by the slot-aware style bridge and profile-aware mastery options.
const loaded = new Map(); // Captures synthetic loaded-state changes made by the ranged archetype bridge.
const baseStarts = []; // Captures calls that reach the original ranged action state machine.
const intervalCallbacks = []; // Defers bootstrap intervals until both modules have been evaluated.
const baseEffectSelections = []; // Captures mastery selections that pass the archetype-specific validation wrapper.
const addedAfflictions = []; // Captures final affliction ids/amounts after Blowgun scaling aliases are resolved.
const rangedVisuals = []; // Captures thrown charge/release presentation options so authored Weapon Throw (Spin) poses can be checked.

const toolDefs = {
  kylie_copper: { label: 'Copper Kylie', sprite: 'assets/toolsprites/kylie.png', slots: ['weapon'], animStyle: 'sweep', shapeKey: 'kylie' },
  bshuakauitl_copper: { label: "Copper B'shuakauitl", sprite: "assets/toolsprites/b'shuakauitl.png", slots: ['weapon'], animStyle: 'sweep', shapeKey: 'bshuakauitl' },
  dagger_copper: { label: 'Copper Dagger', sprite: 'assets/toolsprites/dagger.png', slots: ['weapon'], animStyle: 'thrust', shapeKey: 'dagger' },
  fishingspear_copper: { label: 'Copper Fishing Spear', sprite: 'assets/toolsprites/harpoon_fishingspear.png', slots: ['weapon'], animStyle: 'sweep', shapeKey: 'fishingspear' },
  hatchet_copper: { label: 'Copper Hatchet', sprite: 'assets/toolsprites/axe_hatchet.png', slots: ['weapon'], animStyle: 'sweep', shapeKey: 'hatchet' },
  daggerSword_copper: { label: 'Copper Dagger-Sword', sprite: 'assets/toolsprites/dagger-sword.png', slots: ['weapon'], animStyle: 'thrust', shapeKey: 'daggerSword', rangedType: 'thrown' },
};

const afflictionIds = [
  'bleedingHealth', 'woundedStamina', 'congealedHealth', 'infectedStamina',
  'windedStamina', 'bruisedHealth', 'shatteredStamina', 'poisonedHealth',
];
const baseBasicEffects = [
  ...afflictionIds.map(id => ({ id, label: id, desc: `base ${id}`, afflictionId: id })),
  { id: 'knockback', label: 'Knockback Boost', desc: 'base knockback', knockbackMul: 0.25 },
];
const gear = { rangedAmmoLoadouts: {} };

const windowObject = {
  HeldActionAnimations: {
    throwFlask: {
      durationS: 0.62, windupFrac: 0.44, strikeFrac: 0.62, holdFrac: 0.68, releaseFrac: 0.62,
      poses: { neutral: { x: 0 }, windup: { x: 0.12 }, strike: { x: 0.18 } },
    },
    weaponThrowSpin: {
      name: 'Weapon Throw (Spin)', style: 'chop', sequence: 'attack',
      durationS: 1.04, windupFrac: 0.49, strikeFrac: 0.57, holdFrac: 0.82,
      poses: {
        neutral: { x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: 2, roll: -82, shoulderAim: { pitch: true, yaw: false, roll: true } },
        windup: { x: 0.41, y: 0.37, z: 0.42, pitch: -180, yaw: 139, bodyYaw: -152, roll: -92, shoulderAim: { pitch: false, yaw: false, roll: false } },
        strike: { x: -0.57, y: 0.33, z: 0.17, pitch: -25, yaw: -65, bodyYaw: 63, roll: -88, shoulderAim: { pitch: true, yaw: false, roll: false } },
      },
    },
    drink: { poses: { strike: { x: 0.4, y: 0.4, z: 0.22, pitch: -180, yaw: 21, roll: 4, bodyYaw: 0 } } },
  },
  Combat: {
    deps: {
      TOOL_ITEM_DEFS: toolDefs,
      getActiveTool: () => activeTool,
      getGearInventory: () => gear,
      saveGearInventory: () => {},
      triggerRangedWeaponVisual: (durationS, options) => { rangedVisuals.push({ durationS, options }); },
      refreshActionBar: () => {},
    },
  },
  ResourceSystem: {
    AFFLICTIONS: Object.fromEntries(afflictionIds.map(id => [id, { name: id, resource: id.includes('Stamina') ? 'stamina' : 'health' }])),
    addAffliction(entity, id, amount) { addedAfflictions.push({ entity, id, amount }); return amount; },
  },
  ResourceRings: { AFFLICTION_COLORS: Object.fromEntries(afflictionIds.map((id, index) => [id, index + 1])) },
  RangedWeapons: {
    config: {
      crossbow: { projectileCount: 1, spreadDeg: 0, damage: 16, speedPxS: 720, rangeTiles: 9, projectileRadiusPx: 7, knockbackPxS: 130, staminaCost: 10 },
    },
    BASIC_AMMO_EFFECTS: baseBasicEffects,
    setBasicEffect(itemKey, rank, effectId) { baseEffectSelections.push({ itemKey, rank, effectId }); return true; },
    setLoaded: (itemKey, value) => loaded.set(itemKey, !!value),
    startPlayerAction(itemKey) { baseStarts.push({ itemKey, loaded: loaded.get(itemKey) }); return true; },
    playerActionLabel: itemKey => `Base ${itemKey}`,
    cancelPlayerAction: () => {},
    equippedRangedKey: () => equippedRanged,
  },
  WeaponToolStances: { refreshDefinitions: () => {} },
  InputBindings: { getCurrentBindings: () => ({ desktop: { action1: 'KeyF' }, controller: { action1: 'Button0' } }) },
  __farmLog: () => {},
};
const windowListeners = {}; // Captures window-level listeners (e.g. 'blur') so the test can fire them directly.
windowObject.addEventListener = (type, listener) => { windowListeners[type] = listener; };
const documentListeners = {}; // Captures document-level listeners (e.g. 'visibilitychange') so the test can fire them directly.

const context = {
  window: windowObject,
  document: { readyState: 'complete', addEventListener: (type, listener) => { documentListeners[type] = listener; } },
  navigator: { getGamepads: () => [] },
  performance: { now: () => now },
  Date,
  console,
  requestAnimationFrame: () => 0,
  setInterval: callback => { intervalCallbacks.push(callback); return intervalCallbacks.length; },
  clearInterval: () => {},
};
vm.createContext(context);

for (const relative of [
  '../docs/js/combat/ranged-weapon-archetypes.js',
  '../docs/js/combat/ranged-dual-role-anim-style.js',
]) {
  const source = fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
  vm.runInContext(source, context, { filename: relative });
}
for (const callback of [...intervalCallbacks]) callback();

const rangedWeaponsSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/combat/ranged-weapons.js'), 'utf8'); // Pins the actual projectile-plane/spin implementation used by runtime.
const fishingSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/fishing-minigame.js'), 'utf8'); // Pins the shared fishing-mace outbound spin source.
const heldActionSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/held-action-animations.js'), 'utf8'); // Pins the user-authored shared throw animation source.
assert.match(heldActionSource, /name:\s*'Weapon Throw \(Spin\)'/, 'Shared held-action library must expose Weapon Throw (Spin).');
assert.match(heldActionSource, /durationS:\s*1\.04[\s\S]*windupFrac:\s*0\.49[\s\S]*strikeFrac:\s*0\.57[\s\S]*holdFrac:\s*0\.82/, 'Weapon Throw (Spin) must retain the supplied authored timing.');
assert.match(fishingSource, /projectileVisuals:\s*FISHING_PROJECTILE_VISUALS/, 'Fishing must expose its projectile visual tuning for combat reuse.');
assert.match(rangedWeaponsSource, /Fishing\?\.projectileVisuals\?\.maceSpinRateDeg/, 'Thrown spin must read Fishing\'s authored mace spin rate instead of inventing a separate rate.');
assert.match(rangedWeaponsSource, /loadedTexture\.image\?\.width[\s\S]*plane\.scale\.y = pendingAspect/, 'Spinning thrown weapon PNGs must preserve their source aspect ratio.');
assert.match(rangedWeaponsSource, /spinPivot\.rotation\.y = p\.spinRad/, 'Spinning thrown weapons must rotate on a dedicated sprite-normal pivot.');

assert.ok(toolDefs.kylie_copper.slots.includes('ranged'), 'Kylie should be equippable in the ranged slot.');
assert.ok(toolDefs.bshuakauitl_copper.slots.includes('ranged'), "B'shuakauitl should be equippable in the ranged slot.");
for (const key of ['dagger_copper', 'fishingspear_copper', 'hatchet_copper']) {
  assert.ok(toolDefs[key].slots.includes('ranged'), `${key} should be equippable in the ranged slot.`);
  assert.strictEqual(windowObject.RangedWeapons.config[key]?.rangedType, 'thrown', `${key} should use the shared thrown archetype.`);
}
for (const key of ['dagger_copper', 'hatchet_copper', 'kylie_copper']) {
  assert.strictEqual(windowObject.RangedWeapons.config[key]?.projectileVisualStyle, 'spinningWeapon', `${key} should use the spinning weapon projectile presentation.`);
  assert.strictEqual(windowObject.RangedWeapons.config[key]?.projectileSpinSource, 'fishingMace', `${key} should reuse the fishing-mace spin source.`);
  assert.strictEqual(windowObject.RangedWeapons.config[key]?.projectileSprite, toolDefs[key].sprite, `${key} projectile should use its actual weapon sprite.`);
}
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear_copper?.projectileVisualStyle, 'standard', 'Fishing spear should stay non-spinning.');
for (const key of ['kylie_copper', 'dagger_copper', 'fishingspear_copper', 'hatchet_copper']) {
  const cfg = windowObject.RangedWeapons.config[key];
  assert.ok(Math.abs(cfg.chargeWindupS - 0.5096) < 1e-9, `${key} must use Weapon Throw (Spin)'s 1.04s × 0.49 authored windup.`);
  assert.ok(Math.abs(cfg.fireDurationS - 0.5304) < 1e-9, `${key} release must use the remainder of Weapon Throw (Spin)'s authored duration.`);
}
assert.strictEqual(windowObject.RangedWeapons.config.hatchet_copper.chargePose.neutral.roll, -82, 'Hatchet uses Weapon Throw (Spin) exactly as authored.');
assert.strictEqual(windowObject.RangedWeapons.config.kylie_copper.firePose.strike.roll, -88, 'Kylie uses Weapon Throw (Spin) exactly as authored.');
for (const key of ['dagger_copper', 'fishingspear_copper']) {
  const cfg = windowObject.RangedWeapons.config[key];
  assert.strictEqual(cfg.chargePose.neutral.roll, 98, `${key} must turn the local weapon plane end-for-end at Neutral.`);
  assert.strictEqual(cfg.chargePose.windup.roll, 88, `${key} must keep the end-for-end local flip through Windup.`);
  assert.strictEqual(cfg.firePose.strike.roll, 92, `${key} must keep the end-for-end local flip through Strike.`);
}
assert.ok(!toolDefs.daggerSword_copper.slots.includes('ranged'), 'Dagger-swords must remain melee-only even if a stale definition claims rangedType=thrown.');
assert.strictEqual(windowObject.RangedWeapons.config.daggerSword_copper, undefined, 'Dagger-swords must never receive ranged projectile configuration.');
assert.strictEqual(windowObject.RangedWeapons.config.kylie_copper.rangedType, 'thrown');
assert.strictEqual(windowObject.RangedWeapons.config.bshuakauitl_copper.rangedType, 'blowgun');
assert.strictEqual(windowObject.RangedWeapons.config.bshuakauitl_copper.damage, 2, 'Blowgun should use deliberately tiny raw damage.');
assert.strictEqual(windowObject.RangedWeapons.config.bshuakauitl_copper.basicAfflictionScale, 40, 'Blowgun should heavily amplify mastery affliction buildup.');
assert.strictEqual(windowObject.RangedWeapons.config.bshuakauitl_copper.firePose.neutral.pitch, -180, 'Blowgun stance should copy Drink strike pitch.');

const kylieChoices = windowObject.RangedWeapons.basicAmmoEffectsFor('kylie_copper').map(effect => effect.id);
assert.deepStrictEqual(kylieChoices, ['congealedHealth', 'windedStamina', 'bruisedHealth', 'shatteredStamina', 'knockback'], 'Kylie ranged mastery should expose only blunt-family buildup plus knockback, preserving source ordering.');
const blowgunChoices = windowObject.RangedWeapons.basicAmmoEffectsFor('bshuakauitl_copper').map(effect => effect.id);
assert.deepStrictEqual(blowgunChoices, afflictionIds, 'Blowgun ranged mastery should expose the full affliction set.');
assert.strictEqual(windowObject.RangedWeapons.setBasicEffect('kylie_copper', 1, 'bleedingHealth'), false, 'Kylie should reject sharp-style Bleeding Health mastery.');
assert.strictEqual(windowObject.RangedWeapons.setBasicEffect('kylie_copper', 1, 'bruisedHealth'), true, 'Kylie should accept Bruised Health mastery.');
assert.strictEqual(windowObject.RangedWeapons.setBasicEffect('bshuakauitl_copper', 1, 'poisonedHealth'), true, 'Blowgun should accept Poisoned Health mastery.');
assert.deepStrictEqual(baseEffectSelections.map(entry => entry.effectId), ['bruisedHealth', 'poisonedHealth']);

// The closure-private ranged payload builder still sees the original effect objects.
// While a Blowgun is equipped, their afflictionId getter emits a projectile-carried
// alias. ResourceSystem resolves that alias at impact and multiplies the normal 0.15
// amount by 40 without increasing the dart's raw damage.
equippedRanged = 'bshuakauitl_copper';
const poisonAlias = baseBasicEffects.find(effect => effect.id === 'poisonedHealth').afflictionId;
assert.match(poisonAlias, /^__ranged_blowgun_40x_poisonedHealth$/);
windowObject.ResourceSystem.addAffliction({}, poisonAlias, 0.3); // 2 raw damage × the ranged system's normal 0.15 mastery multiplier.
assert.strictEqual(addedAfflictions.at(-1).id, 'poisonedHealth');
assert.strictEqual(addedAfflictions.at(-1).amount, 12, 'A 2-damage Blowgun dart should build 12 affliction per selected mastery rank (effective 6.0x).');

equippedRanged = 'kylie_copper';
assert.strictEqual(baseBasicEffects.find(effect => effect.id === 'bruisedHealth').afflictionId, 'bruisedHealth', 'Kylie should use normal ranged buildup multipliers rather than Blowgun scaling aliases.');

assert.strictEqual(toolDefs.kylie_copper.animStyle, 'sweep', 'Kylie must keep its melee sweep style in the weapon slot.');
assert.strictEqual(toolDefs.dagger_copper.animStyle, 'thrust', 'Dagger must keep thrust style in the weapon slot.');
assert.strictEqual(toolDefs.fishingspear_copper.animStyle, 'sweep', 'Fishing spear must keep sweep style in the weapon slot.');
assert.strictEqual(toolDefs.hatchet_copper.animStyle, 'sweep', 'Hatchet must keep sweep style in the weapon slot.');
activeTool = 'ranged';
for (const key of ['kylie_copper', 'dagger_copper', 'fishingspear_copper', 'hatchet_copper']) {
  equippedRanged = key;
  assert.strictEqual(toolDefs[key].animStyle, 'ranged', `${key} must report ranged style while active in the ranged slot.`);
}
activeTool = 'weapon';
assert.strictEqual(toolDefs.kylie_copper.animStyle, 'sweep', 'Returning to melee must restore Kylie sweep style.');
assert.strictEqual(toolDefs.dagger_copper.animStyle, 'thrust', 'Returning to melee must restore Dagger thrust style.');
assert.strictEqual(toolDefs.fishingspear_copper.animStyle, 'sweep', 'Returning to melee must restore Fishing Spear sweep style.');
assert.strictEqual(toolDefs.hatchet_copper.animStyle, 'sweep', 'Returning to melee must restore Hatchet sweep style.');
equippedRanged = 'kylie_copper';

assert.strictEqual(windowObject.RangedWeapons.startPlayerAction('kylie_copper'), true, 'Kylie press should begin a thrown hold.');
assert.match(windowObject.RangedWeapons.playerActionLabel('kylie_copper'), /^Release /);
assert.strictEqual(rangedVisuals.at(-1).options.pose.windup.roll, -92, 'Thrown hold visual must use Weapon Throw (Spin) Windup rather than the old flask throw.');
now += 450;
assert.strictEqual(windowObject.HobunjiRangedWeaponArchetypes.releaseThrownCharge('test'), true, 'Kylie release should enter the existing ranged fire state machine.');
assert.deepStrictEqual(baseStarts, [{ itemKey: 'kylie_copper', loaded: true }]);

assert.strictEqual(windowObject.RangedWeapons.startPlayerAction('bshuakauitl_copper'), true, 'Blowgun should retain ordinary load/fire start behavior.');
assert.strictEqual(baseStarts.at(-1).itemKey, 'bshuakauitl_copper');

// A lost release (alt-tab, app switch) must not leave the player parked in the
// charging windup pose forever -- regression guard for a missing blur/visibilitychange
// handler that could otherwise strand thrownCharge indefinitely (see combat-input.js's
// own abortAllPresses convention for the same class of bug on melee holds).
assert.ok(windowListeners.blur, 'installInputBridge must register a window blur handler for thrown charges.');
assert.ok(documentListeners.visibilitychange, 'installInputBridge must register a document visibilitychange handler for thrown charges.');
assert.strictEqual(windowObject.RangedWeapons.startPlayerAction('kylie_copper'), true, 'Kylie press should begin a thrown hold.');
assert.ok(windowObject.HobunjiRangedWeaponArchetypes.debugSnapshot().thrownCharge, 'a charge must be active before simulating focus loss.');
windowListeners.blur();
let snapshot = windowObject.HobunjiRangedWeaponArchetypes.debugSnapshot();
assert.strictEqual(snapshot.thrownCharge, null, 'window blur must cancel an in-progress thrown charge.');
assert.strictEqual(snapshot.lastRelease.type, 'cancelled', 'window blur must report the charge as cancelled, not released.');

assert.strictEqual(windowObject.RangedWeapons.startPlayerAction('kylie_copper'), true, 'Kylie press should begin another thrown hold.');
context.document.hidden = true;
documentListeners.visibilitychange();
snapshot = windowObject.HobunjiRangedWeaponArchetypes.debugSnapshot();
assert.strictEqual(snapshot.thrownCharge, null, 'tab hide (document.hidden) must cancel an in-progress thrown charge.');
assert.strictEqual(snapshot.lastRelease.type, 'cancelled', 'tab hide must report the charge as cancelled, not released.');

console.log('PASS ranged weapon archetypes');