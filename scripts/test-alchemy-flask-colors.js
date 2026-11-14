#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

global.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
global.document = { getElementById: () => null, querySelector: () => null, dispatchEvent: () => {}, addEventListener: () => {} };
global.window = {};

require(path.join(root, 'docs/js/color-fill.js'));
require(path.join(root, 'docs/js/sprite-recolor.js'));
require(path.join(root, 'docs/js/alchemy-system.js'));
require(path.join(root, 'docs/js/object-sprite-catalog.js')); // Pack catalog must not overwrite a brewed narcotic's authored bottle art.

const ITEM_DEFS = {};
const inventory = {}; // Shared authoritative bag count for provenance tests.
window.InventoryStacks = { MAX_TOTAL: 9999 }; // Matches the shipped stack limit for overflow cases.
window.AlchemySystem.init({ ITEM_DEFS, inventory });
const A = window.AlchemySystem;

// Every found potion uses a real, authored triple which actually produces its type.
const foundColors = new Set(); // Tracks sampled standard-recipe pigments (not an arbitrary palette).
for (const recipeId of Object.keys(A.RECIPE_DEFS)) {
  const standard = A.standardRecipeFor(recipeId); // Reagent source for shop/treasure/default-loaded bottles.
  assert.equal(standard.length, 3, recipeId + ' has a complete standard recipe');
  assert(A.enumerateRecipes(standard).some(outcome => outcome.recipeId === recipeId), recipeId + ' standard trio really brews this recipe');
  const tint = A.recipeSpriteColor(recipeId); // Uses existing reagent RGB mixing, not hard-coded color tables.
  assert.equal(tint, average(standard), recipeId + ' derives its color from the three reagent pigments');
  assert.notEqual(tint, 0x8a5fb0, recipeId + ' must not use the previous universal purple');
  assert(!foundColors.has(tint), recipeId + ' standard visual should be distinct from other found potions');
  foundColors.add(tint);
  const key = A.ensureRecipeItemDef(recipeId, 0); // No ingredient history on found/shop registration.
  const authoredSprite = ITEM_DEFS[key].spriteIcon; // Alchemy authored this icon, which must survive the generic object resolver.
  const authoredColor = ITEM_DEFS[key].spriteColor; // The catalog must not recolor tagged narcotics as powders.
  window.ObjectSpriteCatalog.ensure(key, ITEM_DEFS[key]);
  assert.equal(ITEM_DEFS[key].spriteIcon, authoredSprite, recipeId + ' retains its authored bottle/flask shape through Pack art classification');
  assert.equal(ITEM_DEFS[key].spriteColor, authoredColor, recipeId + ' retains its ingredient-derived color through Pack art classification');
  assert.equal(ITEM_DEFS[key].spriteColor, A.RECIPE_DEFS[recipeId].useMode === 'throw'
    ? A.throwingFlaskColors(standard).primaryColor : tint, recipeId + ' registration has the standard recipe tint');
}
assert.equal(foundColors.size, Object.keys(A.RECIPE_DEFS).length, 'all existing potions have authored distinct standard pigments');
const ordinaryPowder = { label: 'Ground Narcotic Powder', cat: 'processed', tags: ['Narcotic'] }; // Unrelated dry items still use the shared powder art.
window.ObjectSpriteCatalog.ensure('groundNarcotic', ordinaryPowder);
assert.equal(ordinaryPowder.spriteIcon, 'powder.png', 'non-alchemy narcotic powders still use the generic powder art');
assert.equal(A.recipeSpriteColor('unmappedLegacy'), A.recipeSpriteColor('unmappedLegacy'), 'older unknown potion fallback stays deterministic');
const legacyA = A.ensurePotionItemDef(['regeneration', 'clarity']); // Old effect combinations are still supported.
const legacyB = A.ensurePotionItemDef(['speed', 'clarity']);
assert.notEqual(ITEM_DEFS[legacyA].spriteColor, ITEM_DEFS[legacyB].spriteColor, 'legacy bottles do not all share a tint');
ITEM_DEFS[legacyA].spriteColor = 0x8a5fb0; // Simulate old item metadata.
A.ensurePotionItemDef(['clarity', 'regeneration']);
assert.equal(ITEM_DEFS[legacyA].spriteColor, A.recipeSpriteColor(legacyA), 'legacy metadata is repaired');

function average(keys) {
  const colors = keys.map(key => A.REAGENT_DEFS[key].color);
  const channel = shift => Math.round(colors.reduce((sum, color) => sum + (color >> shift & 255), 0) / colors.length);
  return channel(16) << 16 | channel(8) << 8 | channel(0);
}

const oneAfflict = ['bogwortLeaf', 'graniteThistle', 'palehartLichen'];
const oneColors = A.throwingFlaskColors(oneAfflict);
assert.deepEqual(oneColors.afflictKeys, ['bogwortLeaf'], 'one Afflict reagent alone owns the secondary flask color');
assert.deepEqual(oneColors.otherKeys, ['graniteThistle', 'palehartLichen'], 'the original bottle region excludes the Afflict reagent');
assert.equal(oneColors.afflictColor, A.REAGENT_DEFS.bogwortLeaf.color);
assert.equal(oneColors.primaryColor, average(['graniteThistle', 'palehartLichen']));

const twoAfflict = ['bogwortLeaf', 'sporeclusterCap', 'graniteThistle'];
const twoColors = A.throwingFlaskColors(twoAfflict);
assert.equal(twoColors.afflictColor, average(['bogwortLeaf', 'sporeclusterCap']), 'two Afflict reagent colors mix into the secondary region');
assert.equal(twoColors.primaryColor, A.REAGENT_DEFS.graniteThistle.color, 'the lone non-Afflict reagent owns the original region');

const allAfflict = ['bogwortLeaf', 'sporeclusterCap', 'weepingReed'];
const allColors = A.throwingFlaskColors(allAfflict);
assert.equal(allColors.primaryColor, average(allAfflict), 'all-Afflict brews fall back to their shared average for the original region');
assert.equal(allColors.afflictColor, average(allAfflict), 'all-Afflict brews use the same truthful shared average for the secondary region');

const standardVenom = A.standardRecipeFor('venomFlask'); // The authored found flask ingredients, including its Afflict component.
const standardVenomColors = A.throwingFlaskColors(standardVenom);
const flaskKey = A.ensureRecipeItemDef('venomFlask', 0, standardVenom);
const flaskDef = ITEM_DEFS[flaskKey];
assert.equal(flaskDef.spriteIcon, 'throwing_flask.png', 'throwable Afflict recipes use the authored throwing flask sprite');
assert.equal(flaskDef.spriteColor, standardVenomColors.primaryColor, 'found flask mixes its non-Afflict ingredients');
assert.equal(flaskDef.spriteSecondaryColor, standardVenomColors.afflictColor, 'found flask mixes its Afflict ingredients separately');
assert.equal(flaskDef.spriteMode, `dual-keyed:${standardVenomColors.afflictColor.toString(16).padStart(6, '0')}`);
assert.equal(flaskDef.alchemyFlaskColorSource, 'ingredients-preview');

const potionKey = A.ensureRecipeItemDef('healingPotion', 0);
assert.equal(ITEM_DEFS[potionKey].spriteIcon, 'bottle_potion.png', 'ordinary potions keep the regular bottle sprite');
assert.equal(ITEM_DEFS[potionKey].spriteMode, 'keyed', 'ordinary potions keep the one-color keyed recolor path');
assert.equal(ITEM_DEFS[potionKey].spriteColor, A.recipeSpriteColor('healingPotion'), 'found potion defaults to the real standard trio');
const usual = A.standardRecipeFor('healingPotion'); // Standard found bottles mixed into the same key as home-brewed ones.
const alternate = ['frostcapMoss', 'thistledownCap', 'mireLotusBud']; // Distinct valid three-reagent healing recipe.
assert(A.enumerateRecipes(alternate).some(outcome => outcome.recipeId === 'healingPotion'), 'alternate really brews healing potion');
inventory[potionKey] = 4;
A.recordPotionAcquisition(potionKey, 4); // Four found bottles with the standard recipe.
inventory[potionKey] = 6;
A.recordPotionAcquisition(potionKey, 2, alternate); // Two bottles cannot overpower four.
assert.equal(A.potionStackDiagnostics(potionKey).majority.count, 4);
assert.equal(ITEM_DEFS[potionKey].spriteColor, average(usual));
inventory[potionKey] = 9;
A.recordPotionAcquisition(potionKey, 3, alternate); // Now five of nine share the crafted trio.
assert.equal(A.potionStackDiagnostics(potionKey).majority.count, 5, 'the five matching bottles take visual precedence');
assert.equal(ITEM_DEFS[potionKey].spriteColor, average(alternate), 'the liquid turns the actual dominant brew color');
const savedBatches = JSON.parse(JSON.stringify(A.serializePotionBatches())); // Plain world-member JSON round trip.
delete ITEM_DEFS[potionKey]; // Game reconstructs each session's dynamic item defs from inventory.
A.restorePotionBatches(savedBatches, inventory);
A.ensureRecipeItemDef('healingPotion', 0); // Loading a save must repaint the already-cached provenance on the fresh def.
assert.equal(ITEM_DEFS[potionKey].spriteColor, average(alternate), 'saved majority survives re-registration');
inventory[potionKey] = 8;
A.syncPotionStack(potionKey); // Consumes from visible winner: now four of each (tie).
assert.equal(ITEM_DEFS[potionKey].spriteColor, average(alternate), 'ties retain the previous visible majority');
inventory[potionKey] = 7;
A.syncPotionStack(potionKey); // Three alternate vs four found = color changes back.
assert.equal(ITEM_DEFS[potionKey].spriteColor, average(usual), 'consumption can change the most numerous recipe');
inventory[potionKey] = 10;
A.recordPotionAcquisition(potionKey, 3); // New found bottles contribute standard ingredients rather than purple.
assert.equal(A.potionStackDiagnostics(potionKey).total, 10);
assert.equal(ITEM_DEFS[potionKey].spriteColor, average(usual));
A.restorePotionBatches(null, inventory); // Older saves have no provenance sidecar.
A.ensureRecipeItemDef('healingPotion', 0);
assert.equal(ITEM_DEFS[potionKey].spriteColor, average(usual), 'legacy inventory defaults all untracked bottles to the standard recipe');

ITEM_DEFS[potionKey].spriteColor = 0x8a5fb0; // Prior all-purple metadata should be repaired even when count is unchanged.
A.ensureRecipeItemDef('healingPotion', 0);
assert.equal(ITEM_DEFS[potionKey].spriteColor, average(usual), 're-registration repaints the stack even with a warm count cache');

// Storage and Shipping Box transfers must retain the real crafted ingredient
// batches instead of turning all returned bottles into standard found ones.
const storedKey = A.ensureRecipeItemDef('healingPotion', 1); // Separate potency key isolates transfer tests from earlier stack tests.
const worldStorage = {}; // Serialized world storage uses this sidecar next to ordinary item totals.
inventory[storedKey] = 6;
A.recordPotionAcquisition(storedKey, 6, alternate); // Six home-brewed bottles have a nonstandard liquid tint.
assert(A.movePotionProvenance(storedKey, 4, 'deposit', worldStorage, 0), 'four bottles can enter storage');
inventory[storedKey] -= 4;
A.syncPotionStack(storedKey);
assert.equal(A.potionStackDiagnostics(storedKey).total, 2, 'bag keeps its two remaining crafted bottles');
assert.equal(worldStorage[storedKey].groups[0].count, 4, 'storage retains the exact crafted recipe');
const travelSave = JSON.parse(JSON.stringify({ storage: worldStorage, bag: A.serializePotionBatches() })); // Real JSON round trip of both world and member records.
A.restorePotionBatches(travelSave.bag, inventory);
assert(A.movePotionProvenance(storedKey, 3, 'withdraw', travelSave.storage, 4), 'three bottles can return from storage');
inventory[storedKey] += 3;
A.syncPotionStack(storedKey);
assert.equal(ITEM_DEFS[storedKey].spriteColor, average(alternate), 'withdrawn crafted potions retain their original mixture');
assert.equal(travelSave.storage[storedKey].groups[0].count, 1, 'stored provenance is decremented with the items');
assert.equal(A.potionStackDiagnostics(storedKey).total, 5, 'bag counts remain conserved across round trips');
assert.equal(A.movePotionProvenance(storedKey, 6, 'deposit', travelSave.storage, 1), false, 'cannot transfer more bottles than the bag owns');
const oldStorage = {}; // Older farms had no ingredient records for their saved inventory.
inventory[storedKey] = 0;
A.syncPotionStack(storedKey);
assert(A.movePotionProvenance(storedKey, 2, 'withdraw', oldStorage, 2), 'an old world-storage count receives the standard found recipe');
inventory[storedKey] = 2;
A.syncPotionStack(storedKey);
assert.equal(ITEM_DEFS[storedKey].spriteColor, average(usual), 'legacy stored bottles use their valid standard recipe');
const hugeStorage = { [storedKey]: { leader: alternate.slice().sort().join('|'), groups: [{ keys: alternate.slice().sort(), count: 12000 }] } }; // Shipping/farm storage has no bag capacity ceiling.
inventory[storedKey] = 0;
A.syncPotionStack(storedKey);
assert(A.movePotionProvenance(storedKey, 1, 'withdraw', hugeStorage, 12000));
inventory[storedKey] = 1;
A.syncPotionStack(storedKey);
assert.equal(hugeStorage[storedKey].groups[0].count, 11999, 'large external stocks preserve their full batch history');
const shippingLedger = { [storedKey]: { leader: alternate.slice().sort().join('|'), groups: [
  { keys: alternate.slice().sort(), count: 5 },
  { keys: usual.slice().sort(), count: 3 },
] } }; // Shipping sales must remove bottles using the same leading-batch policy as bag consumption.
assert(A.reconcilePotionContainer(storedKey, shippingLedger, 4), 'midnight sale reconciles shipping provenance');
assert.equal(shippingLedger[storedKey].groups.find(g => g.keys.join('|') === alternate.slice().sort().join('|')).count, 1, 'sale removed four from the previous majority');
assert.equal(shippingLedger[storedKey].groups.find(g => g.keys.join('|') === usual.slice().sort().join('|')).count, 3, 'minority recipe bottles remain after sale');
assert.equal(shippingLedger[storedKey].leader, usual.slice().sort().join('|'), 'shipping ledger switches to its new dominant batch');


const ColorFill = window.ColorFill;
const keyed = new Uint8ClampedArray([0x9E, 0xD7, 0x75, 177, 0x44, 0x4B, 0x6F, 203]); // Liquid plus untouched bottle detail.
window.SpriteRecolor.recolorImageData(keyed, A.recipeSpriteColor('healingPotion'), 'keyed');
const liquidHue = ColorFill.rgbToHsv(keyed[0], keyed[1], keyed[2]).h; // Rendered pigment, not just item metadata.
const expectedColor = average(usual); // Healing's real standard ingredient pigments.
const healingHue = ColorFill.rgbToHsv(expectedColor >> 16 & 255, expectedColor >> 8 & 255, expectedColor & 255).h;
assert.ok(ColorFill.hueDistance(liquidHue, healingHue) < 1, 'keyed bottle liquid adopts its recipe-specific hue');
assert.equal(keyed[3], 177, 'liquid alpha is preserved');
assert.deepEqual(Array.from(keyed.slice(4)), [0x44, 0x4B, 0x6F, 203], 'bottle glass is not recolored');
const pixels = new Uint8ClampedArray([
  0x9E, 0xD7, 0x75, 255,
  0x69, 0x8F, 0x4E, 180,
  0xE6, 0xDD, 0x2C, 255,
  0xC0, 0x9C, 0x09, 180,
  0x44, 0x4B, 0x6F, 203,
]);
const sourceValues = [0, 4, 8, 12].map(index => ColorFill.rgbToHsv(pixels[index], pixels[index + 1], pixels[index + 2]).v);
const primaryTarget = 0x3366CC;
const secondaryTarget = 0xCC3344;
window.SpriteRecolor.recolorImageData(pixels, primaryTarget, 'dual-keyed:cc3344');
const primaryHue = ColorFill.rgbToHsv(0x33, 0x66, 0xCC).h;
const secondaryHue = ColorFill.rgbToHsv(0xCC, 0x33, 0x44).h;
for (const [index, targetHue, sourceValue] of [[0, primaryHue, sourceValues[0]], [4, primaryHue, sourceValues[1]], [8, secondaryHue, sourceValues[2]], [12, secondaryHue, sourceValues[3]]]) {
  const recolored = ColorFill.rgbToHsv(pixels[index], pixels[index + 1], pixels[index + 2]);
  assert.ok(ColorFill.hueDistance(recolored.h, targetHue) < 1, `pixel ${index / 4} must use its assigned target hue`);
  assert.ok(Math.abs(recolored.v - sourceValue) < 0.01, `pixel ${index / 4} must preserve authored light/shade value`);
}
assert.deepEqual(Array.from(pixels.slice(16, 20)), [0x44, 0x4B, 0x6F, 203], 'non-keyed bottle detail remains untouched');

console.log('ok: 49 standard recipes, stack majorities, world save/loading, storage/shipping provenance, old saves, flask pigments, keyed pixels');
