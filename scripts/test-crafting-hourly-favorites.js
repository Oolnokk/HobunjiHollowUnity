'use strict';
// Exact assembled favorites, quality policies, cumulative stages and hour deadlines.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let day = 6; // Simulated civil day drives the manual processing clock.
let hour = 12; // Simulated in-game hour drives the manual processing clock.
const window = {
  HobunjiCookingData: {
    categoryLabels: {}, itemNameTokenOverrides: {}, identityNameRules: {duo:{pattern:'{left} duo'}}, effectPrefixVariants: {}, processingTiers: {raw: {multiplier:1}, quick: {multiplier:1.4}},
    items: {
      fruitA: {id:'fruitA',name:'Fruit A',categories:['fruit'],primaryEffect:'speed',baseBoost:1,quality:2},
      fruitB: {id:'fruitB',name:'Fruit B',categories:['fruit'],primaryEffect:'speed',baseBoost:1,quality:2},
    },
    recipes: [{id:'duo',name:'Duo',description:'Test',outputTags:[],
      slots:[{id:'left',label:'One',accepts:['fruit'],required:true},
             {id:'right',label:'Two',accepts:['fruit'],required:true},
             {id:'extra',label:'Optional fruit',accepts:['fruit']}]}],
  },
  CalendarSystem: {getAbsoluteGameHour:()=>day*24+hour},
  InventoryStacks: {MAX_TOTAL:999},
  EffectBuffBar: {registerProvider(){},refresh(){}},
};
let finishBatch = null; // The test advances the normal cook timer after changing the selected favorite.
let cookClick = null; // The normal button event starts a batch through the production UI handler.
const cookButton = {addEventListener(_type, callback) { cookClick = callback; }};
const detail = {
  innerHTML:'',
  querySelector(selector){return selector==='[data-cook-now]' ? cookButton : null;},
  querySelectorAll(){return [];},
};
const layer = {querySelector(){return null;},classList:{add(){}},setAttribute(){}};
const document = {
  getElementById(id) { return id==='hobunjiCookingLayer' ? layer : null; },
  querySelector(selector){return selector==='[data-recipe-detail]' ? detail : null;},
  addEventListener(){},dispatchEvent(){},
};
const context = vm.createContext({window,document,console,performance:{now:()=>0},
  setTimeout(callback){finishBatch=callback;return 1;},clearTimeout(){finishBatch=null;},
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options?.detail;}}});
for (const name of ['item-processing.js','cooking-system.js','alchemy-system.js']) {
  vm.runInContext(fs.readFileSync('docs/js/'+name,'utf8'),context,{filename:name});
}
const inventory = {fruitA:2,fruitB:1}; // Shared inventory tests both station selection policies.
const ITEM_DEFS = {}; // Shared definitions are registered and processed by the actual systems.
const deps = {inventory,ITEM_DEFS,inventoryItems:[],cropData:{},PROCESSING_METHODS:[],
  clampInventoryStack(){},saveMemberWorldData(){},showToast(){},
  refreshItemScroll(){},buildInventoryGrid(){},refreshActionBar(){},random:()=>0.3};
window.ItemProcessing.init(deps);
window.CookingSystem.init(deps);
window.AlchemySystem.init(deps);

const reagentKeys = Object.keys(window.AlchemySystem.REAGENT_DEFS); // Choose a real valid authored reaction.
let keys = null; // First legal trio is used to test alchemy favorite recall.
for (let a=0;a<reagentKeys.length&&!keys;a++) for(let b=a+1;b<reagentKeys.length&&!keys;b++)
  for(let c=b+1;c<reagentKeys.length;c++){
    const trio=[reagentKeys[a],reagentKeys[b],reagentKeys[c]];
    if(window.AlchemySystem.enumerateRecipes(trio).length){keys=trio;break;}
  }
assert.ok(keys,'at least one real mixed-source alchemy reaction exists');
for(const key of keys){inventory[key]=2;ITEM_DEFS[key] ||= {label:key,cookingDefaultStars:3};}
const qualityBuckets={fruitA:{5:1,2:1},fruitB:{4:1},
  ...Object.fromEntries(keys.map(key=>[key,{5:1,1:1}]))};
window.CookingSystem.restore({qualityBuckets,
  favoriteRecipes:[{recipeId:'duo',ingredients:{left:'fruitA',right:'fruitA'}}]});
const recipe=window.HobunjiCookingData.recipes[0]; // Test recipe has two slots allowing the same key.
const chosen=window.CookingSystem.bestAvailableSelection(recipe,{left:'fruitA',right:'fruitA'});
assert.equal(chosen.left.stars,5);
assert.equal(chosen.right.stars,2,'cannot assign the same 5-star unit twice');
assert.equal(window.CookingSystem.bestAvailableSelection(recipe).right.stars,4);
assert.equal(window.CookingSystem.serialize().favoriteRecipes[0].ingredients.right,'fruitA');

const first=window.ItemProcessing.enrichOutputs('mashing','fruitA',[{
  key:'jamA',label:'Jam A',cat:'processed',cookingCategories:['fruit'],
  cookingPrimaryEffect:'speed',cookingBaseBoost:1,cookingProcessingTier:'medium'}])[0];
window.ItemProcessing.ensureProcessedItemDef(first);
const second=window.ItemProcessing.enrichOutputs('drying','jamA',[{
  key:'driedJamA',label:'Dried Jam A',cat:'processed',cookingCategories:['fruit'],
  cookingPrimaryEffect:'speed',cookingBaseBoost:1,cookingProcessingTier:'quick'}])[0];
const compound=window.ItemProcessing.processBuffMultiplier('mashing')
  *window.ItemProcessing.processBuffMultiplier('drying');
assert.ok(Math.abs(second.cookingProcessMultiplier-compound)<1e-9);
assert.equal(second.cookingProcessSteps.length,2);
assert.equal(window.CookingSystem.ingredientEffectTotals(second,5).speed,Math.ceil(Math.ceil(3*window.ItemProcessing.processBuffMultiplier('mashing'))*window.ItemProcessing.processBuffMultiplier('drying')), 'each stage rounds before the following multiplier');
assert.ok(window.ItemProcessing.baseProcessHours('barrelAging')>window.ItemProcessing.baseProcessHours('smoking'));
assert.ok(window.ItemProcessing.processBuffMultiplier('barrelAging')>window.ItemProcessing.processBuffMultiplier('smoking'));

// Missing bookmarked optional slots cannot quietly turn into a different dish.
window.CookingSystem.restore({qualityBuckets,favoriteRecipes:[
  {recipeId:'duo',ingredients:{left:'fruitA',right:'fruitA',extra:'unavailableFruit'}},
  {recipeId:'duo',ingredients:{left:'fruitA',right:'fruitA'}},
  {recipeId:'duo',ingredients:{left:'fruitB',right:'fruitA'}},
]});
const [missingFavorite,originalFavorite,otherFavorite]=window.CookingSystem.favoriteRecipes;
window.CookingSystem.loadFavorite(missingFavorite.id);
window.CookingSystem.openAtHearth();
assert.match(detail.innerHTML,/data-cook-now disabled/);
cookClick();
assert.equal(finishBatch,null);
window.CookingSystem.loadFavorite(originalFavorite.id);
window.CookingSystem.openAtHearth();
cookClick();
assert.equal(typeof finishBatch,'function');
window.CookingSystem.loadFavorite(otherFavorite.id);
finishBatch();
const finished = window.CookingSystem.listCookedInventory()[0].definition;
assert.deepEqual([...finished.ingredientKeys],['fruitA','fruitA']);
assert.equal(finished.label,'Fruit A duo');
assert.equal(inventory.fruitA,0);
assert.equal(inventory.fruitB,1);

const target=window.AlchemySystem.enumerateRecipes(keys)[0].recipeId; // Known reaction used as the saved target.
window.AlchemySystem.restoreKnownRecipes([target]);
window.AlchemySystem.restoreFavorites([{keys,targetRecipeId:target}]);
assert.equal(window.AlchemySystem.serializeFavorites().length,1);
assert.equal(window.AlchemySystem.loadFavorite(keys.slice().sort().join('|')+'::'+target),true);
const brewed=window.AlchemySystem.brew();
assert.equal(brewed.ok,true);
for(const key of keys){
  assert.equal(inventory[key],1);
  assert.equal(window.CookingSystem.availableQualityEntries(key)[0].stars,1,
    'recalling a favorite consumes its highest-star ingredient first');
}

const firstHour=window.ItemProcessing.gameHour(); // Read calendar units, not real-time elapsed seconds.
hour=13;
assert.equal(window.ItemProcessing.gameHour(),firstHour+1);
day++;
hour=1;
assert.equal(window.ItemProcessing.gameHour(),firstHour+13);

const game=fs.readFileSync('docs/game.js','utf8'); // Confirm the production runtime schedules and persists the same clock.
assert.ok(game.includes('readyAtGameHour: now + durationHours'));
assert.ok(game.includes('function jobRemainingHours()'));
assert.match(game,/member\.alchemyFavoriteRecipes\s*=\s*window\.AlchemySystem\.serializeFavorites(?:\?\.)?\(/);
assert.match(game,/window\.AlchemySystem\.restoreFavorites(?:\?\.)?\(playerData\.alchemyFavoriteRecipes\)/);
console.log('crafting hourly favorites ok');
