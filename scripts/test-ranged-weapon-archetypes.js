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

const toolDefs = {
  kylie_copper: { label: 'Copper Kylie', sprite: 'assets/toolsprites/kylie.png', slots: ['weapon'], animStyle: 'sweep', shapeKey: 'kylie' },
  bshuakauitl_copper: { label: "Copper B'shuakauitl", sprite: "assets/toolsprites/b'shuakauitl.png", slots: ['weapon'], animStyle: 'sweep', shapeKey: 'bshuakauitl' },
  dagger_copper: { label: 'Copper Dagger', slots: ['weapon'], animStyle: 'thrust', shapeKey: 'dagger' },
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
    drink: { poses: { strike: { x: 0.4, y: 0.4, z: 0.22, pitch: -180, yaw: 21, roll: 4, bodyYaw: 0 } } },
  },
  Combat: {
    deps: {
      TOOL_ITEM_DEFS: toolDefs,
      getActiveTool: () => activeTool,
      getGearInventory: () => gear,
      saveGearInventory: () => {},
      triggerRangedWeaponVisual: () => {},
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

assert.ok(toolDefs.kylie_copper.slots.includes('ranged'), 'Kylie should be equippable in the ranged slot.');
assert.ok(toolDefs.bshuakauitl_copper.slots.includes('ranged'), "B'shuakauitl should be equippable in the ranged slot.");
assert.ok(!toolDefs.dagger_copper.slots.includes('ranged'), 'Unrelated melee weapons must remain melee-only.');
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
activeTool = 'ranged';
assert.strictEqual(toolDefs.kylie_copper.animStyle, 'ranged', 'Kylie must report ranged style while active in the ranged slot.');
activeTool = 'weapon';
assert.strictEqual(toolDefs.kylie_copper.animStyle, 'sweep', 'Returning to melee must restore Kylie sweep style.');

assert.strictEqual(windowObject.RangedWeapons.startPlayerAction('kylie_copper'), true, 'Kylie press should begin a thrown hold.');
assert.match(windowObject.RangedWeapons.playerActionLabel('kylie_copper'), /^Release /);
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