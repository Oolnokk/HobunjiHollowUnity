#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

global.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
global.document = { getElementById: () => null, querySelector: () => null, dispatchEvent: () => {}, addEventListener: () => {} };
global.window = { SCRATCHBONES_CONFIG: { game: { combat: { resourceSystem: {} } } } };
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
}
assert.strictEqual(Object.keys(A.RECIPE_DEFS).length, 35, 'only the explicitly authored reactions should exist');
assert.strictEqual(A.RECIPE_BY_TRAITS['senses.lighten.fire'], undefined, 'undefined permutations must remain invalid');

function combinations(values, size, start = 0, prefix = [], out = []) {
  if (!size) { out.push(prefix); return out; }
  for (let i = start; i <= values.length - size; i++) combinations(values, size - 1, i + 1, [...prefix, values[i]], out);
  return out;
}
const reagentKeys = reagentEntries.map(([key]) => key);
const validPair = combinations(reagentKeys, 2).find(keys => A.enumerateRecipes(keys).length);
const validTriple = combinations(reagentKeys, 3).find(keys => A.enumerateRecipes(keys).length);
assert.ok(validPair && validTriple, 'the authored reagent set must support both two- and three-reagent brewing');
for (const assignment of A.enumerateRecipes(validPair).flatMap(outcome => outcome.assignments)) {
  assert.ok(validPair.every(key => assignment.contributes[key].length), 'every two-reagent assignment must use both reagents');
}
for (const assignment of A.enumerateRecipes(validTriple).flatMap(outcome => outcome.assignments)) {
  assert.ok(validTriple.every(key => assignment.contributes[key].length === 1), 'every three-reagent assignment must use each reagent exactly once');
}
for (const candidate of reagentKeys.filter(key => !validPair.includes(key)).slice(0, 8)) {
  assert.strictEqual(A.canAddReagent(validPair, candidate), A.enumerateRecipes([...validPair, candidate]).length > 0, 'ingredient graying must call the exact enumerator');
}

const invalidPair = combinations(reagentKeys, 2).find(keys => !A.enumerateRecipes(keys).length);
inventory[invalidPair[0]] = 1; inventory[invalidPair[1]] = 1;
const invalidBefore = { ...inventory };
assert.strictEqual(A.brewFrom(invalidPair).ok, false, 'invalid selections must not brew');
assert.deepStrictEqual(inventory, invalidBefore, 'invalid selections must not consume ingredients');
for (const keys of combinations(reagentKeys, 2)) {
  const outcomes = A.enumerateRecipes(keys);
  if (outcomes.length) assert.ok(A.RECIPE_DEFS[A.chooseOutcome(outcomes, null, () => .999).recipeId], 'random brewing must never return an undefined recipe');
}
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

A.applyRecipeToEntity('potionOfStrength', 1, player);
const strength = A.activeEffects.find(effect => effect.recipeId === 'potionOfStrength');
A.applyRecipeToEntity('potionOfFury', 1, player);
const fury = A.activeEffects.find(effect => effect.recipeId === 'potionOfFury');
assert.ok(fury.magnitude > strength.magnitude * 2 && fury.durationS < strength.durationS / 3, 'Fire buffs must be much stronger and shorter');
assert.ok(A.RECIPE_DEFS.hemorrhageFlask.amount > A.RECIPE_DEFS.woundingFlask.amount, 'Fire flasks must apply greater immediate buildup');
assert.ok(!('lingerDuration' in A.RECIPE_DEFS.hemorrhageFlask), 'Fire flasks must not create lingering hazards');

player.footing = 80;
A.applyRecipeToEntity('rushNarcotic', 1, player);
assert.ok(A.activeEffects.some(effect => effect.recipeId === 'rushNarcotic'), 'narcotics must grant their authored buff');
assert.strictEqual(player.footing, 45, 'Rush must immediately apply its Footing drawback');

// A small Three.js stand-in exercises consumption, cancel, deterministic
// travel, self-splash, and ResourceSystem application without a browser.
class Vec { set(x, y, z) { this.x = x; this.y = y; this.z = z; } setScalar(v) { this.scalar = v; } }
class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.position = new Vec(); this.rotation = new Vec(); this.scale = new Vec(); this.parent = null; } }
class Geometry { dispose() {} }
class Material { constructor(options) { Object.assign(this, options); } dispose() {} }
const scene = { add(mesh) { mesh.parent = this; }, remove(mesh) { mesh.parent = null; } };
window.THREE = { Mesh, RingGeometry: Geometry, SphereGeometry: Geometry, MeshBasicMaterial: Material, DoubleSide: 2 };
require(path.join(root, 'docs/js/alchemy-flasks.js'));
const flaskKey = A.ensureRecipeItemDef('venomFlask', 0);
inventory[flaskKey] = 3;
let heldKey = flaskKey;
const victim = { health:100,maxHealth:100,stamina:100,maxStamina:100,footing:100,maxFooting:100 };
R.initEntity(victim);
let impactCount = 0;
window.AlchemyFlasks.init({
  THREE: window.THREE, TILE:64, inventory, getPlayer:() => player, getCurrentArea:() => 'farm', getActiveScene:() => scene,
  getAimAngle:() => 0, getGroundY:() => 0, getSelectedItemKey:() => heldKey,
  getHeldWorldPosition:() => ({x:player.x / 64 || 0,y:1,z:player.y / 64 || 0}),
  getSplashEntities:() => [player, victim], spawnImpactPresentation:() => { impactCount++; },
  clampInventoryStack:key => { if (inventory[key] <= 0) delete inventory[key]; }, refreshItemScroll:()=>{}, refreshActionBar:()=>{}, saveMemberWorldData:()=>{},
});
player.x = 0; player.y = 0;
assert.ok(window.AlchemyFlasks.beginAim(), 'first action must enter aim');
assert.strictEqual(inventory[flaskKey], 3, 'entering aim must consume nothing');
assert.ok(window.AlchemyFlasks.cancelAim(), 'cancel must exit aim');
assert.strictEqual(inventory[flaskKey], 3, 'cancel must consume zero flasks');
window.AlchemyFlasks.beginAim();
window.AlchemyFlasks.setTarget(128, 0);
window.AlchemyFlasks.confirmThrow();
window.AlchemyFlasks.update(.3);
assert.strictEqual(inventory[flaskKey], 2, 'release must consume exactly one flask');
window.AlchemyFlasks.update(.5);
assert.strictEqual(impactCount, 1, 'impact presentation must occur once without owning gameplay resolution');
assert.ok(R.getAffliction(player, 'poisonedHealth') > 0 && R.getAffliction(victim, 'poisonedHealth') > 0, 'splash must affect valid nearby entities including the thrower through ResourceSystem');
assert.strictEqual(window.AlchemyFlasks.diagnostics().lastImpact.radiusTiles, A.RECIPE_DEFS.venomFlask.splashRadius, 'splash must use the recipe radius');

// Breeding resolves normal genetics first, then applies one clamped pending
// class shift and consumes both parent modifiers.
const storedMeta = { characters: [] };
global.localStorage = { getItem: () => JSON.stringify(storedMeta), setItem: () => {} };
window.CreatureGenetics = {
  crossOffspring: (a, b) => ({ sizeClass:'medium', coat:a.coat, inherited:true }),
  defaultLivestockName: () => 'Baby',
};
require(path.join(root, 'docs/js/farm-animals.js'));
let worldLivestock = [
  { id:'a', kind:'uumkaoii', name:'A', genotype:{sizeClass:'small',coat:'blue'}, pendingOffspringSizeShift:1 },
  { id:'b', kind:'uumkaoii', name:'B', genotype:{sizeClass:'large',coat:'red'}, pendingOffspringSizeShift:1 },
];
let pairs = [{ parentA:{source:'world',id:'a'}, parentB:{source:'world',id:'b'}, readyDay:1 }];
window.FarmAnimals.init({
  calendar:{day:1}, loadWorldLivestock:() => worldLivestock, saveWorldLivestock:list => { worldLivestock = list; },
  _loadWorldBreedingPairs:() => pairs, _saveWorldBreedingPairs:value => { pairs = value; }, LIVESTOCK_RESOURCE_DEFS:{},
  showToast:()=>{},
});
window.FarmAnimals.tickBreeding();
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
pairs = [{ parentA:{source:'world',id:'c'}, parentB:{source:'world',id:'d'}, readyDay:1 }];
window.FarmAnimals.tickBreeding();
assert.strictEqual(worldLivestock[2].genotype.sizeClass, 'medium', 'opposing parental modifiers must cancel');

const game = read('docs/game.js');
const style = read('docs/style.css');
const proceduralTasks = read('docs/js/procedural-tasks.js');
const treasure = read('docs/js/wild-treasure.js');
assert.doesNotMatch(game + read('docs/js/alchemy-system.js'), /weaponCoating|coatingState|alchemyCoat/i, 'no weapon-coating state may remain');
assert.match(proceduralTasks, /SkillSystem\?\.level\?\.\('alchemy'\)/, 'procedural tasks must use real Alchemy skill');
assert.match(treasure, /Object\.values\(window\.AlchemySystem\.RECIPE_DEFS\)/, 'treasure must choose only authored recipes');
assert.match(game, /window\.SharedSelectionArch = window\._desktopSelectionArc/, 'special ammo and potion selectors must use the shared arch');
assert.doesNotMatch(game + read('docs/index.html') + style, /toolWheelOverlay|toolWheelEl|tw-spoke|special-ammo-inner/i, 'obsolete parallel tool/ammo radial implementations must be removed');
assert.match(game, /\['shoot', 'ammo_select', 'potion_select'\]/, 'ranged weapons must expose Tool Action 3 Potions');
assert.match(game, /\['cut', 'slash', 'potion_select'\]/, 'melee weapons must expose Tool Action 3 Potions');
assert.match(game, /id:'medicine'[\s\S]*id:'utility'/, 'potion root must expose Medicine left and Utility right');
assert.match(game, /id:'healing'[\s\S]*id:'medicine'[\s\S]*id:'cures'/, 'Medicine must unfold into Healing and Cures');
assert.match(game, /id:'buffs'[\s\S]*id:'utility'[\s\S]*id:'flasks'/, 'Utility must unfold into Buffs and Flasks');
assert.match(game, /recallLastTool\(\)/, 'all Tool Select adapters must share last-tool recall');
assert.match(game, /entryMenuOpen\(\)[\s\S]*toolMenuOpen\(\)/, 'shared arches must expose common keyboard/controller navigation state');
assert.match(game, /_arcBd\.addEventListener\('pointermove'[\s\S]*_arcMove/, 'shared entry arches must support mouse/touch drag navigation');
assert.match(game, /onSelect:\(\) => _selectHeldInventoryKey\(entry\.itemKey\)/, 'potion/flask selection must only put the item in hand');
assert.match(game, /potionAction3Press[\s\S]*openPotions\(\)[\s\S]*releaseSelection\(\)/, 'potion selection must open on hold and commit from the original input release');
assert.match(game, /potionAction3Press\.down[\s\S]*scrollEntries\(-dir\)/, 'desktop potion selection must navigate with the scroll wheel while held');
assert.match(game, /beginHeldSelection\?\.\(_selectorKind\)[\s\S]*heldSelectionKind\?\.\(\)/, 'pointer-held potion and ammo buttons must share their ownership state with the wheel adapter');
assert.match(game, /heldEntrySelectorKind === 'potions'[\s\S]*scrollEntries\(-dir\)/, 'a wheel over a pointer-held potion action must navigate instead of zooming');
assert.match(game, /id:`cancel-\$\{category\}`[\s\S]*label:'Cancel'[\s\S]*active:true[\s\S]*onSelect:\(\) => _clearArc\(\)/, 'the focused category must be replaced by a selected Cancel entry that closes on release');
assert.match(game, /category === 'healing' \|\| category === 'buffs'[\s\S]*unshift\(cancelEntry\)[\s\S]*push\(cancelEntry\)/, 'Cancel must occupy the same left/right edge angle as the category it replaces');
assert.match(game, /_arcMove\(px, py\); \/\/ Re-evaluate the same continuous drag/, 'one continuous drag must traverse a newly populated potion hierarchy without a second press');
assert.match(game, /_openPotionItems\(category\.id\);[\s\S]*_arcMove\(px, py\); \/\/ The replacement Cancel button/, 'continuous drag must focus the replacement Cancel without another pointer event');
assert.match(game, /entries:potion-items-[\s\S]*Math\.max\(0, Math\.min\(_arcSlots\.length - 1, nextIndex\)\)/, 'final potion lists must clamp so repeated wheel events cannot wrap past Cancel');
assert.match(game, /potionAction3Press\.held = true; \/\/ Potion Select is exclusively[\s\S]*openPotions\(\)/, 'held potion input must display Medicine and Utility immediately rather than waiting for wheel movement');
assert.match(game, /_selectorArcOpen = true; \/\/ These actions have no tap behavior[\s\S]*openPotions\(\)/, 'pointer-held potion input must also display its root options immediately');
assert.match(style, /\.arc-slot\.potion-cancel[\s\S]*\.arc-slot\.potion-cancel\.arc-active/, 'Cancel must have readable idle and selected presentation');
assert.match(game, /_openPotionRoot\(\)[\s\S]*_outerR\(\)[\s\S]*function _openPotionBranch[\s\S]*_outerR\(\)[\s\S]*function _openPotionItems[\s\S]*_outerR\(\)/, 'all potion hierarchy levels must use the ordinary tool/item arch radius');
assert.doesNotMatch(game, /_openPotion(?:Root|Branch|Items)[\s\S]{0,1400}_innerR\(/, 'potion selectors must not use the smaller inner-ring radius');
assert.match(read('docs/js/alchemy-system.js'), /alchemy:\{level:alchemyLevel\(\),xp:/, 'Alchemy diagnostics must expose both level and XP');
assert.match(game, /setTarget\(_mouseWorld\.x \* TILE/, 'mouse must control the flask ground cursor');
assert.match(game, /setTargetFromVector\(rx, ry/, 'controller right stick must control the flask ground cursor');
assert.match(game, /setTargetFromVector\(dx, dy/, 'mobile Action 1 drag must control the flask ground cursor');
assert.match(game, /flask-cancel-hover[\s\S]*cancelAim/, 'mobile drag-over Action 2 must cancel continuously');
assert.match(style, /cure-family-grid[\s\S]*grid-template-columns:1fr 1fr/, 'Cures must display four compact family indicators');

console.log('trait alchemy refactor tests passed');
