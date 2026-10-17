#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

global.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
global.document = { getElementById: () => null, querySelector: () => null, dispatchEvent: () => {}, addEventListener: () => {} };
global.addEventListener = () => {}; // Browser load-hook stand-in used by alchemy-flasks.js's optional UI bootstraps.
global.window = { InventoryStacks: require('./lib/inventory-stacks'), SCRATCHBONES_CONFIG: { game: { combat: { resourceSystem: {} } } } };
require(path.join(root, 'docs/js/combat/resource-system.js'));

const player = { health: 20, maxHealth: 100, stamina: 40, maxStamina: 100, footing: 50, maxFooting: 100 };
window.ResourceSystem.initEntity(player);
window.Combat = { deps: { player } };
let alchemyLevel = 0;
let alchemyXp = 0;
window.SkillSystem = {
  level: key => key === 'alchemy' ? alchemyLevel : 0,
  XP_GAINS: { alchemyBrew: 8, alchemyDiscovery: 18, alchemyTarget: 5 },
  award: (key, amount) => { if (key === 'alchemy') alchemyXp += amount; },
};
window.EffectBuffBar = { registerProvider: () => {}, refresh: () => {} };
require(path.join(root, 'docs/js/alchemy-system.js'));

const inventory = {};
const ITEM_DEFS = {};
window.AlchemySystem.init({
  ITEM_DEFS, inventory, getPlayer: () => player, random: () => 0.25,
  clampInventoryStack: key => { if ((inventory[key] || 0) <= 0) delete inventory[key]; },
  refreshItemScroll: () => {}, buildInventoryGrid: () => {}, refreshActionBar: () => {},
  showToast: () => {}, saveMemberWorldData: () => {}, getInCombat: () => true,
});

const A = window.AlchemySystem;
const R = window.ResourceSystem;
const reagentEntries = Object.entries(A.REAGENT_DEFS);
assert.strictEqual(reagentEntries.length, 20, 'all twenty existing reagents must remain');
for (const [key, definition] of reagentEntries) {
  assert.deepStrictEqual(Object.keys(definition.traits).sort(), ['drive', 'humour', 'magnetism'], `${key} must have exactly three trait categories`);
  assert.ok(A.validateTraits(definition.traits), `${key} must use valid trait values`);
  assert.ok(A.nativeRecipeForReagent(key), `${key}'s native trio must be authored`);
  assert.ok(['waterEdge','treeRoots','cliffBase','rockEdge','shrubEdge'].includes(definition.habitat), `${key} must declare a terrain sub-habitat`);
}
assert.strictEqual(Object.keys(A.RECIPE_DEFS).length, 35, 'only the explicitly authored reactions should exist');
assert.strictEqual(A.RECIPE_BY_TRAITS['senses.lighten.fire'], undefined, 'undefined permutations must remain invalid');

function combinations(values, size, start = 0, prefix = [], out = []) {
  if (!size) { out.push(prefix); return out; }
  for (let i = start; i <= values.length - size; i++) combinations(values, size - 1, i + 1, [...prefix, values[i]], out);
  return out;
}
const reagentKeys = reagentEntries.map(([key]) => key);
const validTriple = combinations(reagentKeys, 3).find(keys => A.enumerateRecipes(keys).length);
assert.ok(validTriple, 'the authored reagent set must support three-reagent brewing');
for (const keys of combinations(reagentKeys, 2)) {
  assert.strictEqual(A.enumerateRecipes(keys).length, 0, 'two reagents must never constitute a brewable reaction');
}
for (const assignment of A.enumerateRecipes(validTriple).flatMap(outcome => outcome.assignments)) {
  assert.ok(validTriple.every(key => assignment.contributes[key].length === 1), 'every three-reagent assignment must use each reagent exactly once');
}
const completablePair = combinations(reagentKeys, 2).find(keys => A.canCompleteSelection(keys));
assert.ok(completablePair, 'partial ingredient selection must remain usable when a legal third reagent exists');
for (const candidate of reagentKeys.filter(key => !completablePair.includes(key))) {
  assert.strictEqual(A.canAddReagent(completablePair, candidate), A.enumerateRecipes([...completablePair, candidate]).length > 0, 'ingredient graying must validate exact three-reagent completions');
}

inventory[completablePair[0]] = 1; inventory[completablePair[1]] = 1;
const pairBefore = { ...inventory };
assert.strictEqual(A.brewFrom(completablePair).ok, false, 'two-reagent selections must not brew');
assert.deepStrictEqual(inventory, pairBefore, 'rejected two-reagent brews must not consume ingredients');

for (const key of validTriple) inventory[key] = Math.max(1, inventory[key] || 0);
const brewedTriple = A.brewFrom(validTriple, { random: () => .25 });
assert.ok(brewedTriple.ok, 'a valid three-reagent reaction must brew');
assert.strictEqual(brewedTriple.consumed.length, 3, 'every successful brew must consume three reagents');
for (const key of validTriple) assert.strictEqual(inventory[key] || 0, 0, `${key} must be consumed by the three-reagent brew`);

for (const keys of combinations(reagentKeys, 3)) {
  const outcomes = A.enumerateRecipes(keys);
  if (outcomes.length) assert.ok(A.RECIPE_DEFS[A.chooseOutcome(outcomes, null, () => .999).recipeId], 'random brewing must never return an undefined recipe');
}
const rarityTriple = combinations(reagentKeys, 3).find(keys => {
  const outcomes = A.enumerateRecipes(keys);
  return outcomes.some(outcome => outcome.recipeId === 'breedingGigantism') && outcomes.some(outcome => A.outcomeWeight(outcome) === 1);
});
assert.ok(rarityTriple, 'at least one ingredient trio must expose breeding Gigantism alongside a normal-weight reaction');
const rarityOutcomes = A.enumerateRecipes(rarityTriple);
const rareOutcome = rarityOutcomes.find(outcome => outcome.recipeId === 'breedingGigantism');
const commonOutcome = rarityOutcomes.find(outcome => A.outcomeWeight(outcome) === 1);
assert.strictEqual(A.outcomeWeight(rareOutcome), 0.1, 'breeding potions must use the authored 0.10 base reaction weight before targeting bonuses');
assert.strictEqual(A.RECIPE_DEFS.breedingPygmation.brewWeight, 0.1, 'Breeding Pygmation must use the same 0.10 base reaction weight before targeting bonuses');
assert.ok(A.outcomeWeight(rareOutcome) < A.outcomeWeight(commonOutcome), 'breeding potions must carry a lower natural reaction weight');
assert.ok(A.targetingProbability(20, rarityOutcomes, rareOutcome.recipeId) < A.targetingProbability(20, rarityOutcomes, commonOutcome.recipeId), 'rare reaction weight must also reduce targeting reliability');
const weightedCounts = Object.fromEntries(rarityOutcomes.map(outcome => [outcome.recipeId, 0]));
for (let i = 0; i < 1000; i++) weightedCounts[A.weightedOutcome(rarityOutcomes, () => (i + 0.5) / 1000).recipeId]++;
assert.ok(weightedCounts[rareOutcome.recipeId] < weightedCounts[commonOutcome.recipeId], 'untargeted brewing must naturally produce rare breeding reactions less often');

let previousChance = 0;
for (let level = 0; level <= 20; level++) {
  const chance = A.targetingProbability(level, 2);
  assert.ok(chance >= previousChance, 'target probability must rise monotonically');
  previousChance = chance;
}
assert.strictEqual(A.targetingProbability(0, 1), 1, 'a sole possible target must be automatic');

inventory.thistledownCap = 1;
player.health = 20;
const rawHealing = A.consumeRawReagent('thistledownCap');
assert.strictEqual(rawHealing.potencyFactor, .25, 'raw use must report quarter potency');
assert.strictEqual(player.health, 28, 'raw Healing reagent must restore one quarter of the brewed base amount');
assert.ok(A.isRecipeKnown('healingPotion'), 'raw use must discover its native recipe');
inventory.bogwortLeaf = 1;
const bruiseBefore = R.getAffliction(player, 'bruisedHealth');
A.consumeRawReagent('bogwortLeaf');
assert.strictEqual(R.getAffliction(player, 'bruisedHealth') - bruiseBefore, 8.5, 'harmful raw Afflict reagents must harm the consumer at quarter potency');

alchemyLevel = 10;
const storedKey = A.ensureRecipeItemDef('potionOfStrength', A.potencyTierForLevel());
alchemyLevel = 20;
assert.strictEqual(A.parseBrewedItemKey(storedKey).potencyTier, 2, 'stored potency must not change after later level-ups');

R.addAffliction(player, 'bleedingHealth', 20);
R.addAffliction(player, 'poisonedHealth', 20);
R.addAffliction(player, 'infectedStamina', 20);
A.applyRecipeToEntity('woundRemedy', 1, player);
assert.strictEqual(R.afflictionTotalByFamily(player, 'damage'), 12, 'family cleanse must remove a potency-scaled total across the family');
A.applyRecipeToEntity('antidote', 1, player);
assert.strictEqual(R.afflictionTotalByTag(player, 'toxin'), 0, 'tag cleanse must overlap families and clear toxin-tagged buildup');

const staminaPotionEntity = {
  health: 100, maxHealth: 100, stamina: 55, maxStamina: 100,
  footing: 100, maxFooting: 100, exhaustion: { active: true, blackStamina: 90 },
};
R.initEntity(staminaPotionEntity);
R.addAffliction(staminaPotionEntity, 'windedStamina', 30);
A.applyRecipeToEntity('staminaPotion', 1, staminaPotionEntity);
assert.strictEqual(staminaPotionEntity.exhaustion.active, false, 'Stamina Potion can finish Black Stamina recovery');
assert.strictEqual(staminaPotionEntity.exhaustion.blackStamina, 100);
assert.strictEqual(staminaPotionEntity.stamina, 0, 'Stamina Potion leaves normal Stamina at zero when it finishes Black Stamina recovery');
A.applyRecipeToEntity('staminaPotion', 1, staminaPotionEntity);
assert.strictEqual(staminaPotionEntity.stamina, 34, 'a later Stamina Potion restores the normal pool after Exhausted has cleared');
assert.ok(staminaPotionEntity.stamina <= R.getEffectiveMax(staminaPotionEntity, 'stamina'), 'normal potion restoration respects Winded Stamina effective max');

A.applyRecipeToEntity('potionOfStrength', 1, player);
const strength = A.activeEffects.find(effect => effect.recipeId === 'potionOfStrength');
A.applyRecipeToEntity('potionOfFury', 1, player);
const fury = A.activeEffects.find(effect => effect.recipeId === 'potionOfFury');
assert.ok(fury.magnitude >= strength.magnitude * 2 && fury.durationS < strength.durationS / 3, 'Fire buffs must be much stronger and shorter');
assert.ok(A.RECIPE_DEFS.hemorrhageFlask.amount > A.RECIPE_DEFS.woundingFlask.amount, 'Fire flasks must apply greater immediate buildup');
assert.ok(!('lingerDuration' in A.RECIPE_DEFS.hemorrhageFlask), 'Fire flasks must not create lingering hazards');

player.footing = 80;
A.applyRecipeToEntity('rushNarcotic', 1, player);
assert.ok(A.activeEffects.some(effect => effect.recipeId === 'rushNarcotic'), 'narcotics must grant their authored buff');
assert.strictEqual(player.footing, 45, 'Rush must immediately apply its Footing drawback');

// A small Three.js stand-in exercises consumption, cancel, deterministic
// travel, self-splash, and ResourceSystem application without a browser.
class Vec { set(x, y, z) { this.x = x; this.y = y; this.z = z; } setScalar(v) { this.scalar = v; } copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; } }
class Object3D { constructor() { this.position = new Vec(); this.rotation = new Vec(); this.scale = new Vec(); this.parent = null; this.children = []; this.visible = true; this.userData = {}; } add(child) { child.parent = this; this.children.push(child); } }
class Group extends Object3D {}
class Mesh extends Object3D { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
class Points extends Mesh {}
class Geometry { constructor() { this.attributes = {}; } setAttribute(key, value) { this.attributes[key] = value; } dispose() {} }
class BufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.needsUpdate = false; } get count() { return this.array.length / this.itemSize; } getX(i) { return this.array[i * 3]; } getY(i) { return this.array[i * 3 + 1]; } setZ(i, z) { this.array[i * 3 + 2] = z; } }
class Material { constructor(options) { Object.assign(this, options); } dispose() {} }
class RingGeometry extends Geometry { constructor(inner, outer) { super(); this.innerRadius = inner; this.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, outer, 0, 0, 0, outer, 0]), 3)); } }
const scene = { children: [], add(mesh) { mesh.parent = this; this.children.push(mesh); }, remove(mesh) { mesh.parent = null; this.children = this.children.filter(child => child !== mesh); } };
window.THREE = { Group, Mesh, Points, BufferGeometry:Geometry, BufferAttribute, PointsMaterial:Material, RingGeometry, SphereGeometry: Geometry, MeshBasicMaterial: Material, DoubleSide: 2, AdditiveBlending:2 };
require(path.join(root, 'docs/js/alchemy-flasks.js'));
const flaskKey = A.ensureRecipeItemDef('venomFlask', 0);
inventory[flaskKey] = 3;
let heldKey = flaskKey;
const victim = { health:100,maxHealth:100,stamina:100,maxStamina:100,footing:100,maxFooting:100 };
R.initEntity(victim);
let terrainSlope = 0; // Enables raised-ground preview checks without changing the flat-ground gameplay fixtures.
let disposedFlasks = 0; // Verifies projectile sprite ownership ends at impact.
let impactCount = 0;
let shoulderView = false; // Switches the harness between legacy cursor aim and centered shoulder-ray aim.
const flaskSfxCues = []; // Captures semantic audio placeholders without requiring AudioSystem or media files.
window.AlchemyFlasks.init({
  THREE: window.THREE, TILE:64, inventory, getPlayer:() => player, getCurrentArea:() => 'farm', getActiveScene:() => scene,
  getAimAngle:() => 0, getGroundY:() => 0, getGroundYAtWorld:(x) => x * terrainSlope, getSelectedItemKey:() => heldKey,
  isShoulderView:() => shoulderView,
  makeFlaskProjectile:() => new Mesh(new Geometry(), new Material({ map: 'authored-flask-sprite' })),
  disposeFlaskProjectile:() => { disposedFlasks++; },
  getPlayerInteractionRay:() => ({ origin:{x:0,y:5,z:-2}, direction:{x:0,y:-0.2,z:1} }),
  getHeldWorldPosition:() => ({x:player.x / 64 || 0,y:1,z:player.y / 64 || 0}),
  getSplashEntities:() => [player, victim], spawnImpactPresentation:() => { impactCount++; },
  emitSfxCue:cue => flaskSfxCues.push(cue.cueId),
  clampInventoryStack:key => { if (inventory[key] <= 0) delete inventory[key]; }, refreshItemScroll:()=>{}, refreshActionBar:()=>{}, saveMemberWorldData:()=>{},
});
player.x = 0; player.y = 0;
assert.ok(window.AlchemyFlasks.beginAim(), 'first action must enter aim');
const preview = scene.children.find(mesh => mesh.geometry?.innerRadius === 0); // Filled splash plane created by the actual owner.
assert.ok(preview, 'flask reticle must fill the AoE rather than only mark its edge');
window.PerkSystem = { rank: () => 2 };
terrainSlope = 0.3;
window.AlchemyFlasks.setTarget(128, 0);
assert.equal(window.AlchemyFlasks.setTarget(NaN, 0), false, 'invalid target input must not poison aim');
assert.equal(preview.scale.scalar, A.RECIPE_DEFS.venomFlask.splashRadius * 1.2, 'preview must include Empower Flasks radius');
assert.ok(Math.abs(preview.geometry.attributes.position.array[5] - terrainSlope) < 0.00001, 'plane edge height must conform to target terrain');
assert.ok(Math.abs(preview.position.y - (2 * terrainSlope + 0.035)) < 0.00001, 'preview uses landing terrain rather than player ground');
terrainSlope = 0;
delete window.PerkSystem;
assert.strictEqual(inventory[flaskKey], 3, 'entering aim must consume nothing');
assert.ok(window.AlchemyFlasks.cancelAim(), 'cancel must exit aim');
assert.strictEqual(inventory[flaskKey], 3, 'cancel must consume zero flasks');
shoulderView = true;
window.AlchemyFlasks.beginAim();
assert.ok(Math.abs(window.AlchemyFlasks.diagnostics().target.y - 14 * 64) < 0.001, 'shoulder aim must follow the centered interaction ray out to the extended clamp');
window.AlchemyFlasks.cancelAim();
shoulderView = false;
window.AlchemyFlasks.beginAim();
window.AlchemyFlasks.setTarget(128, 0);
window.AlchemyFlasks.confirmThrow();
window.AlchemyFlasks.update(.3);
assert.deepEqual(window.AlchemyFlasks.diagnostics().projectileVisuals, ['authored-flask'], 'flight must show the flask sprite instead of a particle core');
assert.strictEqual(inventory[flaskKey], 2, 'release must consume exactly one flask');
window.AlchemyFlasks.update(.5);
assert.strictEqual(impactCount, 1, 'impact presentation must occur once without owning gameplay resolution');
assert.ok(R.getAffliction(player, 'poisonedHealth') > 0 && R.getAffliction(victim, 'poisonedHealth') > 0, 'splash must affect valid nearby entities including the thrower through ResourceSystem');
assert.equal(disposedFlasks, 1, 'the rendered flask must release its sprite at impact');
assert.strictEqual(window.AlchemyFlasks.diagnostics().lastImpact.radiusTiles, A.RECIPE_DEFS.venomFlask.splashRadius, 'splash must use the recipe radius');
assert.ok(flaskSfxCues.includes('flask_throw_release') && flaskSfxCues.includes('flask_impact'), 'release and impact must emit decoupled semantic SFX placeholders');
// Landing-shadow cue: a fixed disc at the splash radius that fades in quickly
// and contracts over the flight to half the player's shadow footprint.
const shadowCfg = { radiusX:0.34, radiusZ:0.22, opacity:0.28 };
class ShadowGeometry extends Geometry { constructor() { super(); const array = new Float32Array([0,0,0, 1,0,0, 0,0,1]); this.setAttribute('position', Object.assign(new BufferAttribute(array, 3), { getZ(i) { return this.array[i * 3 + 2]; }, setY(i, y) { this.array[i * 3 + 1] = y; } })); } }
window.CharacterGroundShadow = { config:() => shadowCfg, surfaceOffset:() => 0.018, make:name => Object.assign(new Mesh(new ShadowGeometry(), new Material({ opacity:shadowCfg.opacity })), { name }) };
window.AlchemyFlasks.beginAim();
window.AlchemyFlasks.setTarget(128, 0);
window.AlchemyFlasks.confirmThrow();
window.AlchemyFlasks.update(.27);
window.AlchemyFlasks.update(.02); // Crosses the release delay and starts the flight 0.01s in.
const landingShadow = scene.children.find(mesh => mesh.name === 'flask_landing_shadow');
assert.ok(landingShadow, 'a released flask must place a ground cue at its landing point');
assert.ok(landingShadow.material.opacity > 0 && landingShadow.material.opacity < shadowCfg.opacity, 'cue fades in rather than popping');
assert.ok(Math.abs(landingShadow.scale.x - A.RECIPE_DEFS.venomFlask.splashRadius) < 0.1, 'cue starts at the splash radius');
assert.ok(Math.abs(landingShadow.position.x - 2) < 0.00001 && Math.abs(landingShadow.position.z) < 0.00001, 'cue is fixed on the landing point');
window.AlchemyFlasks.update(.1);
assert.ok(Math.abs(landingShadow.material.opacity - shadowCfg.opacity) < 0.00001, 'cue reaches full shadow opacity quickly');
const shrinkingScale = landingShadow.scale.x;
window.AlchemyFlasks.update(.05);
assert.ok(landingShadow.scale.x < shrinkingScale, 'cue contracts during flight');
window.AlchemyFlasks.update(1);
assert.ok(!scene.children.includes(landingShadow), 'cue is removed at impact');
assert.ok(Math.abs(landingShadow.scale.x - shadowCfg.radiusX * 0.5) < 0.00001 && Math.abs(landingShadow.scale.z - shadowCfg.radiusZ * 0.5) < 0.00001, 'cue ends at half the player shadow footprint');
delete window.CharacterGroundShadow;
const npcSource = { id:'flasker-test', x:-128, y:0, areaId:'farm' }; // Enemy source proves throwFromEntity does not depend on player inventory.
const inventoryBeforeNpcThrow = inventory[flaskKey] || 0;
const npcPoisonBefore = R.getAffliction(victim, 'poisonedHealth');
assert.ok(window.AlchemyFlasks.throwFromEntity(npcSource, 'venomFlask', 1, 128, 0), 'NPCs can launch authored throwable recipes through the shared flask projectile owner');
window.AlchemyFlasks.update(1.2);
assert.strictEqual(inventory[flaskKey] || 0, inventoryBeforeNpcThrow, 'NPC flask throws are infinite-use and never consume the player inventory stack');
assert.ok(R.getAffliction(victim, 'poisonedHealth') > npcPoisonBefore, 'NPC flask projectiles resolve the same splash affliction gameplay');
assert.strictEqual(window.AlchemyFlasks.diagnostics().lastNpcThrow.recipeId, 'venomFlask', 'NPC throw diagnostics expose the launched loadout type');

// Breeding resolves normal genetics first, then applies one clamped pending
// class shift and consumes both parent modifiers.
const storedMeta = { characters: [] };
global.localStorage = { getItem: () => JSON.stringify(storedMeta), setItem: () => {} };
window.CreatureGenetics = {
  crossOffspring: (a, b) => ({ sizeClass:'medium', coat:a.coat, inherited:true }),
  defaultLivestockName: () => 'Baby',
};
require(path.join(root, 'docs/js/creature-texture-cache.js'));
require(path.join(root, 'docs/js/farm-animals.js'));
let worldLivestock = [
  { id:'a', kind:'uumkaoii', name:'A', genotype:{sizeClass:'small',coat:'blue'}, pendingOffspringSizeShift:1 },
  { id:'b', kind:'uumkaoii', name:'B', genotype:{sizeClass:'large',coat:'red'}, pendingOffspringSizeShift:1 },
];
let pairs = [{ parentA:{source:'world',id:'a'}, parentB:{source:'world',id:'b'}, startedDay:0, progress:.99 }];
window.FarmAnimals.init({
  calendar:{day:1}, loadWorldLivestock:() => worldLivestock, saveWorldLivestock:list => { worldLivestock = list; },
  _loadWorldBreedingPairs:() => pairs, _saveWorldBreedingPairs:value => { pairs = value; }, LIVESTOCK_RESOURCE_DEFS:{},
  showToast:()=>{},
});
window.FarmAnimals.tickBreedingProgress(1);
assert.strictEqual(worldLivestock[2].genotype.sizeClass, 'large', 'matching parental Gigantism must apply one class step');
assert.strictEqual(worldLivestock[2].genotype.coat, 'blue', 'existing genetics must remain intact');
assert.strictEqual(worldLivestock[0].pendingOffspringSizeShift, 0, 'parent A modifier must be consumed');
assert.strictEqual(worldLivestock[1].pendingOffspringSizeShift, 0, 'parent B modifier must be consumed');
assert.strictEqual(window.FarmAnimals.shiftedSizeClass('large', 1), 'large', 'size shifts must clamp high');
assert.strictEqual(window.FarmAnimals.shiftedSizeClass('small', -1), 'small', 'size shifts must clamp low');
worldLivestock = [
  { id:'c', kind:'uumkaoii', genotype:{sizeClass:'medium',coat:'green'}, pendingOffspringSizeShift:1 },
  { id:'d', kind:'uumkaoii', genotype:{sizeClass:'medium',coat:'gold'}, pendingOffspringSizeShift:-1 },
];
pairs = [{ parentA:{source:'world',id:'c'}, parentB:{source:'world',id:'d'}, startedDay:0, progress:.99 }];
window.FarmAnimals.tickBreedingProgress(1);
assert.strictEqual(worldLivestock[2].genotype.sizeClass, 'medium', 'opposing parental modifiers must cancel');

const game = read('docs/game.js');
const style = read('docs/style.css');
const proceduralTasks = read('docs/js/procedural-tasks.js');
const treasure = read('docs/js/wild-treasure.js');
const actionArcUi = read('docs/js/action-arc-ui.js');
assert.doesNotMatch(game + read('docs/js/alchemy-system.js'), /weaponCoating|coatingState|alchemyCoat/i, 'no weapon-coating state may remain');
assert.match(proceduralTasks, /SkillSystem\?\.level\?\.\('alchemy'\)/, 'procedural tasks must use real Alchemy skill');
assert.match(treasure, /Object\.values\(window\.AlchemySystem\.RECIPE_DEFS\)/, 'treasure must choose only authored recipes');
assert.match(actionArcUi, /window\.SharedSelectionArch = window\._desktopSelectionArc/, 'special ammo and potion selectors must use the shared arch');
assert.doesNotMatch(game + read('docs/index.html') + style, /toolWheelOverlay|toolWheelEl|tw-spoke|special-ammo-inner/i, 'obsolete parallel tool/ammo radial implementations must be removed');
assert.match(game, /\['shoot', 'ammo_select', 'potion_select'\]/, 'ranged weapons must expose Tool Action 3 Potions');
assert.match(game, /\['cut', 'slash', 'potion_select'\]/, 'melee weapons must expose Tool Action 3 Potions');
assert.match(actionArcUi, /id:'medicine'[\s\S]*id:'utility'/, 'potion root must expose Medicine left and Utility right');
assert.match(actionArcUi, /id:'healing'[\s\S]*id:'medicine'[\s\S]*id:'cures'/, 'Medicine must unfold into Healing and Cures');
assert.match(actionArcUi, /id:'buffs'[\s\S]*id:'utility'[\s\S]*id:'flasks'/, 'Utility must unfold into Buffs and Flasks');
assert.match(actionArcUi, /recallLastTool\(\)/, 'all Tool Select adapters must share last-tool recall');
assert.match(actionArcUi, /entryMenuOpen\(\)[\s\S]*toolMenuOpen\(\)/, 'shared arches must expose common keyboard/controller navigation state');
assert.match(actionArcUi, /_arcBd\.addEventListener\('pointermove'[\s\S]*_arcMove/, 'shared entry arches must support mouse/touch drag navigation');
assert.match(actionArcUi, /onSelect:\(\) => _selectHeldInventoryKey\(entry\.itemKey\)/, 'potion/flask selection must only put the item in hand');
assert.match(game, /potionAction3Press[\s\S]*openPotions\(\)[\s\S]*releaseSelection\(\)/, 'potion selection must open on hold and commit from the original input release');
assert.match(game, /potionAction3Press\.down[\s\S]*scrollEntries\(-dir\)/, 'desktop potion selection must navigate with the scroll wheel while held');
assert.match(game, /beginHeldSelection\?\.\(_selectorKind\)[\s\S]*heldSelectionKind\?\.\(\)/, 'pointer-held potion and ammo buttons must share their ownership state with the wheel adapter');
assert.match(game, /heldEntrySelectorKind === 'potions'[\s\S]*scrollEntries\(-dir\)/, 'a wheel over a pointer-held potion action must navigate instead of zooming');
assert.match(actionArcUi, /id:`cancel-\$\{category\}`[\s\S]*label:'Cancel'[\s\S]*active:true[\s\S]*onSelect:\(\) => _clearArc\(\)/, 'the focused category must be replaced by a selected Cancel entry that closes on release');
assert.match(actionArcUi, /category === 'healing' \|\| category === 'buffs'[\s\S]*unshift\(cancelEntry\)[\s\S]*push\(cancelEntry\)/, 'Cancel must occupy the same left/right edge angle as the category it replaces');
assert.match(actionArcUi, /_arcMove\(px, py\); \/\/ Re-evaluate the same continuous drag/, 'one continuous drag must traverse a newly populated potion hierarchy without a second press');
assert.match(actionArcUi, /_openPotionItems\(category\.id\);[\s\S]*_arcMove\(px, py\); \/\/ The replacement Cancel button/, 'continuous drag must focus the replacement Cancel without another pointer event');
assert.match(actionArcUi, /entries:potion-items-[\s\S]*Math\.max\(0, Math\.min\(_arcSlots\.length - 1, nextIndex\)\)/, 'final potion lists must clamp so repeated wheel events cannot wrap past Cancel');
assert.match(game, /potionAction3Press\.held = true; \/\/ Potion Select is exclusively[\s\S]*openPotions\(\)/, 'held potion input must display Medicine and Utility immediately rather than waiting for wheel movement');
assert.match(game, /_selectorArcOpen = true; \/\/ Show choices immediately[\s\S]*openPotions\(\)/, 'pointer-held potion input must also display its root options immediately');
assert.match(game, /_selectorDownX = ev\.clientX; _selectorDownY = ev\.clientY; _selectorMoved = false;/, 'mobile potion/ammo selector gestures must remember the true touch-down point');
assert.match(game, /selectorTravel = Math\.hypot\(ev\.clientX - _selectorDownX, ev\.clientY - _selectorDownY\)[\s\S]*selectorTravel > DRAG_THRESH[\s\S]*_selectorArcOpen && _selectorMoved[\s\S]*movePointer/, 'mobile selector pointer jitter must not move the arch until the touch exceeds the deliberate drag threshold');
assert.match(style, /\.arc-slot\.potion-cancel[\s\S]*\.arc-slot\.potion-cancel\.arc-active/, 'Cancel must have readable idle and selected presentation');
assert.match(actionArcUi, /_openPotionRoot\(\)[\s\S]*_outerR\(\)[\s\S]*function _openPotionBranch[\s\S]*_outerR\(\)[\s\S]*function _openPotionItems[\s\S]*_outerR\(\)/, 'all potion hierarchy levels must use the ordinary tool/item arch radius');
assert.doesNotMatch(actionArcUi, /_openPotion(?:Root|Branch|Items)[\s\S]{0,1400}_innerR\(/, 'potion selectors must not use the smaller inner-ring radius');
assert.match(read('docs/js/alchemy-system.js'), /alchemy:\{level:alchemyLevel\(\),xp:/, 'Alchemy diagnostics must expose both level and XP');
assert.match(game, /setTarget\(_mouseWorld\.x \* TILE/, 'mouse must control the flask ground cursor');
assert.match(game, /rightStickOwner = 'flask aim'/, 'controller flask aim must share camera-stick ownership');
assert.match(game, /setMobileArchCombatAim\(ev.pointerId, dx, dy, _sockR, el.dataset.action\); \/\/ Same camera-stick aiming as thrown weapons/, 'mobile flask drag uses thrown-weapon camera aiming');
assert.match(game, /flask-cancel-hover[\s\S]*cancelAim/, 'mobile drag-over Action 2 must cancel continuously');
assert.match(style, /cure-family-grid[\s\S]*grid-template-columns:1fr 1fr/, 'Cures must display four compact family indicators');

console.log('trait alchemy refactor tests passed');

// Load the actual rest integration against the actual alchemy owner.
let wellRested = false; // Toggles the effect without recreating or mutating saved potions.
window.TemplePrayerRestBlessings = { isWellRested:()=>wellRested };
window.setInterval = () => 1; // No installation polling is needed in this synchronous fixture.
require(path.join(root,'docs/js/devotion-rest-buffs.js'));
A.restoreActiveEffects([{recipeId:'potionOfStrength',remainingS:90,magnitude:.5,potencyTier:2}]);
assert.equal(A.getWorkSpeedMultiplier(),1.75,'Strength work bonus survives rest-module installation');
assert.equal(A.getFootingDamageMultiplier(),1.75,'Strength Footing bonus survives rest-module installation');
wellRested = true;
assert.equal(A.getWorkSpeedMultiplier(),2,'rested tier scaling applies to Strength secondary work bonus');
assert.equal(A.getFootingDamageMultiplier(),2,'rested tier scaling applies to Strength secondary Footing bonus');
assert(Math.abs(A.getOutgoingDamageMultiplier()-(1+2/3))<1e-12);
assert.equal(A.activeEffects[0].magnitude,.5,'stored potion potency stays unchanged');
wellRested = false;
assert.equal(A.getWorkSpeedMultiplier(),1.75,'rest expiry restores original magnitude');
A.restoreActiveEffects([{recipeId:'thickbloodPotion',remainingS:90,magnitude:2,potencyTier:2}]);
assert.equal(A.getIncomingDamageAfflictionMultiplier(),.15,'existing Thickblood cap remains authoritative');
