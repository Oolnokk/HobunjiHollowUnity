#!/usr/bin/env node
'use strict';
// Exercise the shipping/Gorkunash valuation against the same real source
// modules and data the browser loads; no console/devtools required to diagnose.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const window={};
const context=vm.createContext({window,self:window,console,Math,Set,Map,WeakMap});
const load=name=>vm.runInContext(fs.readFileSync('docs/js/'+name+'.js','utf8'),context,{filename:name+'.js'});
window.RuinSites={treasureHoleChance:()=>.06,debugSnapshot:()=>({zones:{
  northwest:Array.from({length:8},(_,i)=>({id:'site'+i})),
  southeast:Array.from({length:7},(_,i)=>({id:'site'+(i+8)}))}})};
window.WildernessMapGenerator={zoneMapIds:()=>['northwest','southeast']};
window.DevRandomRuinDungeonChests={snapshot:()=>[]};
window.TownMine={getTownValue:()=>1};
window.FARM_SPECIALIZATIONS_CONFIG={buildings:{seedMakerSmall:{family:'seedMaker',daysPerInput:2}}};
window.HobunjiCookingData={items:{}};
const rawPools=JSON.parse(fs.readFileSync('docs/config/loot/loot-pools.json','utf8')).pools;
const pools={...rawPools,
  dungeonChest_tier4:{...rawPools.dungeonChest_tier4,entries:[
    {itemKey:'commonSource',chance:.9,min:1,max:1,conditions:{}},
    {itemKey:'rareSource',chance:.01,min:1,max:1,conditions:{}},
  ]},
};
window.LootRolling={getLootPools:()=>pools,getShopStock:()=>({})};
load('ruin-layer-plan');
load('crop-varieties');
load('item-acquisition-rarity');
load('festival-potluck-contest');
const rarity=window.ItemAcquisitionRarity;
const crops=window.CropVarieties;
const contest=window.FestivalPotluckContest;
assert.equal(rarity.VERSION,1,'rarity version is saved with cooked dishes');
const ruin=rarity.ruinContext();
assert.equal(ruin.tiers.lich.floors,4,'reads playable ruin floors');
assert.equal(ruin.tiers.lich.wings,5,'reads playable ruin wings');
assert.equal(ruin.tiers.lich.rooms,19,'counts shaft floor rooms and wing rooms');
assert.equal(ruin.guardianShare,3/15,'three guardian tombs among fifteen observed sites');
assert.equal(ruin.buriedRuinChance,.06,'reads existing buried-ruin probability');
const defs={
  commonSource:{cat:'material',sellPrice:50,cookingProcessingTier:'raw'},
  rareSource:{cat:'material',sellPrice:50,cookingProcessingTier:'raw'},
  unknownSource:{cat:'material',sellPrice:50,cookingProcessingTier:'raw'},
  alreadyPriced:{cat:'food',sellPrice:100,rarityPriced:true},
  heftroot:{cat:'crop',sellPrice:12,cookingProcessingTier:'raw'},
};
const common=rarity.evaluate('commonSource',{defs});
const rare=rarity.evaluate('rareSource',{defs});
assert(common.known&&rare.known,'different known chest drops have computable acquisition sources');
assert(rare.score>common.score,'rare chest drop outranks common one');
assert(rare.sources.some(source=>source.ruinKind==='lich'&&source.floors===4&&source.rooms===19&&source.chestTier===4),'chest source carries actual ruin and chest context');
assert(rare.priceMultiplier>common.priceMultiplier,'price scarcity responds to chance, not a hard-coded item label');
assert(rarity.sellPrice('rareSource',50,{defs})>=50,'source price never undercuts the existing authored price');
assert(rarity.sellPrice('rareSource',50,{defs})<=68,'rarity price uplift is bounded at 35 percent');
assert.equal(rarity.sellPrice('unknownSource',50,{defs}),50,'unknown source stays at authored price');
assert.equal(rarity.sellPrice('alreadyPriced',100,{defs}),100,'crafted ingredient value is not priced twice');
assert.equal(rarity.evaluate('',{defs}).known,false,'blank item keys never gain fake acquisition data');
assert.equal(Number.isFinite(rarity.evaluate('rareSource',{defs}).score),true,'ratings remain numeric');
assert(contest.ingredientPoints('rareSource',4,defs)>contest.ingredientPoints('commonSource',4,defs),'Gorkunash uses real source rarity');
const snapshot=rarity.contestMultiplier('rareSource',{defs});
const savedIngredients=[{key:'rareSource',stars:4,rarityMultiplier:snapshot,
  rarityScore:rare.score,raritySource:rare.sourceLabel,rarityCertainty:rare.uncertainty}]; // Saved cooking records carry both the frozen score and its source explanation.
assert.equal(contest.scoreIngredients(savedIngredients,defs),contest.ingredientPoints('rareSource',4,defs,snapshot),
  'saved meal snapshots reproduce their exact points');
const meal=contest.ingredientBreakdown(savedIngredients,defs)[0];
assert.equal(meal.points,contest.scoreIngredients(savedIngredients,defs),'Gorkunash inspector agrees with judging');
assert(meal.raritySource && meal.rarityScore>0,'inspector exposes provenance and its quality uncertainty');

// Runtime crop registry matches FarmProduction's live crop registration shape.
const nativeCrops={};
const sourceItems={...defs};
for(const family of crops.FAMILIES){
  nativeCrops[family]={cropKey:family,seedKey:family+'Seeds',growDays:3,idealMin:.2,idealMax:.8,emoji:'🥕',label:family};
  sourceItems[family]||={cat:'crop',sellPrice:12};
  sourceItems[family+'Seeds']={cat:'seed',sellPrice:4};
}
crops.attach({cropData:nativeCrops,ITEM_DEFS:sourceItems,inventory:{},inventoryItems:[]});
assert(crops.rarityProfile('heftroot').native,'native produce recognized from installed crops');
assert.equal(rarity.sellPrice('heftroot',12,{defs:sourceItems}),12,'starter crop is exempt from source-price inflation');
const imported='cv_heftroot_111111Seeds';
const profile=crops.rarityProfile(imported);
assert(profile.pureImport,'six equal non-native genes mark a trader cultivar');
assert(Math.abs(profile.familyPickChance-4/11)<1e-12,'exact four-of-eleven family selection');
assert.equal(profile.regionPickChance,.2,'one of five imported regions');
assert(Math.abs(profile.chancePerCaravan-(4/11/5))<1e-12,'family and region probabilities multiply');
const importedRarity=rarity.evaluate(imported,{defs:sourceItems});
assert(importedRarity.sources.some(source=>source.kind==='import'&&Math.abs(source.caravanDailyChance-.15)<1e-10),
  'import acquisition combines caravan daily spawn with offered seed chance');
assert(importedRarity.score>0,'imported seed has source-aware scarcity');
window.TownMine.getTownValue=()=>5;
const later=rarity.evaluate(imported,{defs:sourceItems});
assert(later.score<importedRarity.score,'trade availability dynamically increases with Town Value');
window.TownMine.getTownValue=()=>1;
const sameChance=crops.breedingOutcomeChance('heftroot','heftroot','heftroot');
assert(Math.abs(sameChance-(.975+.025/6))<1e-10,'native cross chance includes mutation choosing the same allele');
const rareMutant='cv_heftroot_100000_f0d15a';
assert(Math.abs(crops.breedingOutcomeChance('heftroot','heftroot',rareMutant)-(.025/36))<1e-10,
 'mutant probability includes 1/6 locus and 1/6 new allele');
const sourcedChild=rarity.evaluate(rareMutant,{defs:sourceItems,breedingParents:['heftroot','heftroot']});
assert(sourcedChild.sources.some(source=>source.certainty==='exact-parent-genetics'&&Math.abs(source.probability-.025/36)<1e-6),
  'breeding source consumes actual parents, not a fabricated rarity tier');
assert.equal(crops.breedingOutcomeChance('heftroot','needlegrain',rareMutant),0,'different-family crosses have zero chance');


// Animal source odds share the live den species, clutch count, gestation and
// the canonical genetics API; special coats are modifiers, not free new routes.
sourceItems.wolfBaby={cat:'livestock',sellPrice:35,tags:['Baby']};
window.SCRATCHBONES_CONFIG={game:{wildlife:{denMothers:{wolf:{nestItemKey:'wolfBaby'}},
  nestClutch:{min:1,max:3}},livestock:{itemKinds:{wolfBaby:'wolf'}},
  creatureGenetics:{patternChances:{wolf:{stripe:.1,spot:.2}}}}};
window.FarmAnimals={GESTATION_DAYS:3};
let calledWith=null;
window.CreatureGenetics={PATTERN_DEFS:{wolf:['stripe','spot']},SPECIES_ALIAS:{},
  sellValueFor:(genotype,kind)=>{calledWith={genotype,kind};return {amount:450,tier:'Rare'};}};
const plainBaby=rarity.evaluate('wolfBaby',{defs:sourceItems});
const rareCoat={stripe:{enabled:true,copies:1},spot:{enabled:false,copies:0}};
const rareBaby=rarity.evaluate('wolfBaby',{defs:sourceItems,genotype:rareCoat});
assert.equal(calledWith.kind,'wolf','genetic valuation receives genotype first and species second');
assert.strictEqual(calledWith.genotype,rareCoat,'genetic inspection never mutates shared species definitions');
assert(rareBaby.score>plainBaby.score,'pattern scarcity raises rarity of a specific offspring');
assert(rareBaby.sources.some(source=>Math.abs(source.patternPresenceChance-.08)<1e-10
  && source.genotypeTier==='Rare' && source.genotypeValue===450),
  'independent species pattern chances combine with canonical coat valuation');
assert(!rareBaby.sources.some(source=>source.kind==='genotype'),'genetics is not an independently farmable duplicate acquisition route');

const uninitializedWindow={};
const early=vm.createContext({window:uninitializedWindow,Math,Set,Map,WeakMap});
vm.runInContext(fs.readFileSync('docs/js/item-acquisition-rarity.js','utf8'),early);
const before=uninitializedWindow.ItemAcquisitionRarity.evaluate('futureItem',{defs:{futureItem:{sellPrice:30}}});
assert.equal(before.known,false,'item definition alone is not evidence of rarity');
uninitializedWindow.LootRolling={getLootPools:()=>({dungeonChest_tier1:{entries:[{itemKey:'futureItem',chance:.2,min:1,max:1}]}})};
const after=uninitializedWindow.ItemAcquisitionRarity.evaluate('futureItem',{defs:{futureItem:{sellPrice:30}}});
assert(after.known,'loading new actual loot pools invalidates early no-source assessment');
console.log('Acquisition rarity, ruin geometry, chest rates, trader seeds, breeding mutation, price bounds and Gorkunash scoring passed.');
