'use strict';
const assert = require('node:assert/strict');
const rarity = require('../docs/js/item-acquisition-rarity.js');

assert.equal(rarity.chain([{ label:'known', probability:.5 }, { label:'missing' }]).probability, null);
assert.equal(rarity.chain([{ label:'a', probability:.5 }, { label:'b', probability:.2 }]).probability, .1);
assert.equal(rarity.atLeastOne(1, 0), 0);
assert.equal(rarity.atLeastOne(1, 3), 1);
assert.equal(rarity.atLeastOne(.1, 2).toFixed(3), '0.190');
assert.equal(rarity.tierLayout('cave').rooms, 8);
assert.equal(rarity.tierLayout('hole').rooms, 15);
assert.equal(rarity.tierLayout('lich').rooms, 19);
assert.equal(rarity.ruinChest({tier:'hole'}).perChest.probability, null);
assert.equal(rarity.ruinChest({tier:'hole',chestsPerRoom:1,chestChance:1,lootChance:.1,siteChance:.5}).expectedItems, 1.5);
const imported = rarity.caravanSeed({townValue:1,targetFamily:'heftroot',targetRegion:3});
assert(Math.abs(imported.specificSeedChancePerCaravan - 4/55) < 1e-12);
assert(Math.abs(imported.specificSeedChancePerDay - .15*4/55) < 1e-12);
assert.equal(rarity.caravanSeed({townValue:0}).dailyCaravanChance, 0);
assert.equal(rarity.caravanSeed({townValue:99}).dailyCaravanChance, .7);
assert.equal(rarity.inheritance({parentA:'000000',parentB:'000000',target:'000000'}).probability, 1-.025+.025/6);
assert.equal(rarity.inheritance({parentA:'000000',parentB:'000000',target:'111111'}).probability, 0);
assert.equal(rarity.inheritance({parentA:'invalid',parentB:'000000',target:'000000'}), null);
assert.equal(rarity.source({stages:[{label:'rare',probability:.01}],baseSellPrice:100}).proposedSellPrice > 100,true);
assert.equal(rarity.source({stages:[{label:'unknown'}],baseSellPrice:100}).proposedSellPrice,null);
assert.equal(rarity.item('cv_heftroot_333333Seeds',{townValue:1,itemDefs:{cv_heftroot_333333Seeds:{sellPrice:10}}}).origin,'slagothim-import');
assert.equal(rarity.item('cv_heftroot_333330Seeds').origin,'crossbred-or-inherited');

assert.equal(rarity.chain([{label:'unknown',probability:null}]).probability,null,'unknown must not become zero');
assert.equal(rarity.chain([{label:'unknown',probability:''}]).probability,null,'blank probabilities stay unknown');
const importedCrop = rarity.cultivarRarity('cv_heftroot_333333');
assert(Math.abs(importedCrop.probability - .15*(4/11)*(1/5)) < 1e-12);
assert(importedCrop.factor > 1 && importedCrop.factor <= 3.5);
assert.equal(importedCrop.origin,'slagothim-import');
assert.equal(rarity.cultivarRarity('cv_heftroot_333333Seeds').isSeed,true);
assert(rarity.cultivarSellPrice('cv_heftroot_333333Seeds',10) > rarity.cultivarSellPrice('cv_heftroot_333333',10),'imported seeds command higher rarity premium');
const crossbred = rarity.cultivarRarity('cv_heftroot_343443_ab56cd');
assert.equal(crossbred.probability,null,'crossbred ancestry is unknown without parents');
assert.equal(crossbred.origin,'crossbred-or-inherited');
assert.equal(rarity.foodRarity('plain',{plain:{}}).factor,1,'unquantified native raw ingredient stays neutral');
const foodDefs={ cv_heftroot_333333:{}, flour:{ingredientKeys:['cv_heftroot_333333']}, pie:{ingredientKeys:['plain','flour']}, plain:{} };
assert(Math.abs(rarity.foodRarity('flour',foodDefs).factor - importedCrop.factor) < 1e-12,'processing inherits source rarity');
assert(rarity.foodRarity('pie',foodDefs).factor > 1 && rarity.foodRarity('pie',foodDefs).factor < importedCrop.factor,'multiple ingredient rarity uses geometric average');
assert.equal(rarity.foodRarity('loop',{loop:{ingredientKeys:['loop']}}).factor,1,'cycle guard terminates');
const catalog={ARTIFACTS:{
  harlyaoCommon:{tier:1,weight:3},harlyaoRare:{tier:2,weight:1},
  hachutuCommon:{tier:1,weight:4}
},LOOT_TUNING:{countsByTier:[{min:1,max:2},{min:2,max:2},{min:2,max:3},{min:3,max:3}]}};
assert.equal(rarity.artifactChest('harlyaoRare',1,'harlyao',catalog).probability,0,'tier gate excludes inaccessible artifacts');
assert.equal(rarity.artifactChest('harlyaoRare',2,'harlyao',catalog).probability,1-Math.pow(3/4,2),'tier and weight model matches exact draw probability');
assert.equal(rarity.artifactChest('harlyaoRare',2,'hachutu',catalog).probability,0,'cultures do not cross-contaminate');
assert.equal(rarity.artifactChest('harlyaoCommon',1,'harlyao',catalog).probability,1,'only eligible artifact always draws');
const pools={sample:{entries:[{id:'one',itemKey:'thing',min:1,max:1,chance:.1,conditions:{}},{id:'two',itemKey:'thing',min:1,max:1,chance:.2,conditions:{}}]},conditional:{entries:[{itemKey:'thing',min:1,max:1,chance:.1,conditions:{seasons:['winter']}}]}};
assert(Math.abs(rarity.lootPoolItem('thing','sample',pools).probability-.28)<1e-12,'independent table entry odds combine via union');
assert.equal(rarity.lootPoolItem('thing','conditional',pools).probability,null,'world condition needs eligibility context');
const zoneDen=rarity.denOffspring({species:'nelk',denSpecies:['puktuk','nelk'],denCount:5,clutchMin:1,clutchMax:3,nestChance:1});
assert.equal(zoneDen.speciesDenCount,2,'extra den assigned to first species by authored tie-break');
assert.equal(zoneDen.probability,.4);
assert.equal(zoneDen.expectedOffspring,4);
const liveDen=rarity.liveDenOffspring('nelkBaby',{zoneId:'test_zone',census:[
  {denId:'1',species:'nelk',stage:'active'},{denId:'2',species:'puktuk',stage:'active'},
  {denId:'3',species:'nelk',stage:'collapsed'}],
  mothers:{nelk:{nestItemKey:'nelkBaby'},puktuk:{nestItemKey:'puktukBaby'}},
  clutch:{min:1,max:3}});
assert.equal(liveDen.probability,1/3,'collapsed dens do not count as available offspring sources');
assert.equal(liveDen.potentialMeanOffspring,2);
assert.equal(liveDen.currentlyRecordedOffspring,null,'unknown remaining clutch cannot be invented');
assert.equal(rarity.liveDenOffspring('tzatzulEgg',{zoneId:'test_zone',census:[],mothers:{nelk:{nestItemKey:'nelkBaby'}},clutch:{min:1,max:3}}),null,'infertile Tzatzul eggs are not live den offspring');
const testFish=[
  {key:'common',rarity:'common',zones:['zone'],seasons:'any',timesOfDay:'any'},
  {key:'rare',rarity:'rare',zones:['zone'],seasons:['Coldmuck'],timesOfDay:['day']}
];
assert.equal(rarity.fishCatch('rare',{zone:'zone',season:'Coldmuck',timeOfDay:'day',entries:testFish}).probability,1/7,'fishing rarity weights match canonical 6:1');
assert.equal(rarity.fishCatch('rare',{zone:'zone',season:'Deadgrass',timeOfDay:'day',entries:testFish}).probability,0,'season mismatch excludes unavailable fish');
assert(rarity.fishRarity('rare',testFish).factor > rarity.fishRarity('common',testFish).factor,'rarer, shorter-window fish score higher');
const fs = require('node:fs'), vm = require('node:vm'); // Execute the production contest module rather than copying its scoring.
const host = {window:{ItemAcquisitionRarity:rarity}};
vm.runInNewContext(fs.readFileSync('docs/js/festival-potluck-contest.js','utf8'),host);
const contest=host.window.FestivalPotluckContest;
assert.equal(contest.ingredientPoints('plain',4,foodDefs),4,'unknown input sources retain legacy scores');
assert.equal(contest.ingredientPoints('flour',4,foodDefs),Math.round(8*importedCrop.factor*100)/100,'quality × processing × rarity, multiplicative');
const breakdown=contest.ingredientBreakdown([{key:'plain',stars:4},{key:'flour',stars:4}],foodDefs);
assert.equal(contest.scoreIngredients([{key:'plain',stars:4},{key:'flour',stars:4}],foodDefs),Math.round(breakdown.reduce((sum,entry)=>sum+entry.points,0)*100)/100,'Gorkunash inspector matches actual scoring to cents');
assert.equal(breakdown[1].processingMultiplier,2);
assert(breakdown[1].rarityMultiplier>1);


const cropHost={window:{ItemAcquisitionRarity:rarity,HobunjiCookingData:{items:{}},
  CookingSystem:{registerIngredientItems(){}}}}; // Live crop definitions are generated by the production module with the rarity engine present.
vm.runInNewContext(fs.readFileSync('docs/js/crop-varieties.js','utf8'),cropHost);
const nativeCrop={heftroot:{cropKey:'heftroot',seedKey:'heftrootSeeds',label:'Heftroot',growDays:4,idealMin:.2,idealMax:.5}};
const nativeDefs={heftroot:{sellPrice:34,cat:'crop'},heftrootSeeds:{sellPrice:5,cat:'seed'}};
const crops=cropHost.window.CropVarieties;
crops.attach({cropData:nativeCrop,ITEM_DEFS:nativeDefs,inventory:{},inventoryItems:[]});
const importedHeftroot=crops.ensure('cv_heftroot_333333');
assert(nativeDefs[importedHeftroot.id].sellPrice > Math.round(34*1.2),'real crop selling value includes scarcity');
assert(nativeDefs[importedHeftroot.seedKey].sellPrice > Math.round(5*1.4),'real seed selling value includes scarcity');
const childHeftroot=crops.breed(importedHeftroot.id,'heftroot',()=>.6);
assert.equal(crops.lastBreeding.offspring,childHeftroot.id,'last breeding reports real registered child');
assert.equal(crops.lastBreeding.parentA,importedHeftroot.id);
assert.equal(crops.lastBreeding.parentB,'heftroot');
assert(crops.lastBreeding.genotypeChance > 0 && crops.lastBreeding.genotypeChance <= 1,'exact parental chance is calculated');

assert.equal(rarity.source({stages:[{label:'known',probability:.5}]}).proposedSellPrice,null,'missing base price never becomes an invented one-ganang price');
assert.equal(rarity.atLeastOne(.5,null),null,'missing opportunity count cannot become zero');
assert.equal(rarity.expected(.5,null),null,'missing expectation opportunities stay unknown');
assert.equal(rarity.chain([{label:'invalid',probability:1.5}]).probability,null,'out of range probability is unknown, not clamped to certainty');
assert.equal(rarity.chain([{label:'invalid',probability:-.5}]).probability,null,'negative probability is unknown, not zero');
assert.equal(rarity.inheritance({parentA:'000000',parentB:'000000',target:'000000',mutationChance:1.2}),null,'invalid mutation probability cannot produce false offspring odds');
assert.equal(rarity.inheritance({parentA:'000000',parentB:'000000',target:'000000',alleleCount:3}),null,'canonical crop breeder has exactly six loci');
assert.equal(rarity.caravanSeed({townValue:2,targetFamily:'heftroot',targetRegion:0}).probability,0,'native seeds cannot be offered as imported stock');
assert.equal(rarity.caravanSeed({townValue:2,targetFamily:'heftroot',targetRegion:2,caravanEligible:false}).probability,0,'known caravan route restriction is zero, not unknown');
assert.equal(rarity.denOffspring({species:'nelk',denSpecies:['puktuk','nelk'],clutchMin:1,clutchMax:3}).expectedOffspring,null,'unknown den count is not zero dens');
assert.equal(rarity.denOffspring({species:'nelk',denSpecies:['puktuk','nelk'],denCount:5,clutchMin:1,clutchMax:3}).probability,null,'unknown nest viability cannot be assumed certain');
assert.equal(rarity.ruinChest({tier:'hole',chestsPerRoom:-1,chestChance:1,lootChance:.5}).expectedItems,null,'invalid chest opportunities are unknown');
const quantityPools={
  zero:{entries:[{id:'nothing',itemKey:'zero',min:0,max:0,chance:1}]},
  variable:{entries:[{id:'random amount',itemKey:'drop',min:0,max:3,chance:.2}]},
  stepped:{entries:[{id:'stepped',itemKey:'material',min:0,max:4,step:2,chance:1}]},
  mixed:{kind:'mixed',rolls:1,sourcePools:[{poolId:'variable',weight:1}]},
  exclusive:{kind:'exclusive',entries:[{itemKey:'rare',weight:1},{itemKey:'common',weight:3}]},
};
assert.equal(rarity.lootPoolItem('zero','zero',quantityPools).probability,0,'100% table selection with zero quantity is not a drop');
assert(Math.abs(rarity.lootPoolItem('drop','variable',quantityPools).probability-.15)<1e-12,'min 0 max 3 yields 75% positive chance');
assert(Math.abs(rarity.lootPoolItem('drop','variable',quantityPools).expectedQuantity-.3)<1e-12,'expected drop count includes zero rolls');
assert.equal(rarity.lootPoolItem('material','stepped',quantityPools).probability,2/3,'step quantization includes zero outcome');
assert.equal(rarity.lootPoolItem('rare','exclusive',quantityPools).probability,.25,'exclusive tables draw one item by configured weight');
assert.equal(rarity.lootPoolItem('drop','mixed',quantityPools).probability,null,'nested source pool probability must never be claimed as impossible');
assert.equal(rarity.scoreCooked,undefined,'rarity module does not duplicate the festival judging owner');
assert.equal(contest.scoreCooked({festivalContestScore:5.75},2,foodDefs),5.75,'saved cooked rarity fractions must not be truncated');
assert.equal(contest.ingredientPoints('cv_heftroot_333333',4,foodDefs,1.1),4.4,'archived source multiplier overrides changed current rarity');
assert.equal(contest.scoreIngredients([{key:'cv_heftroot_333333',stars:4,rarityMultiplier:1.1}],foodDefs),4.4,'frozen contest multiplier controls judgement');
assert.equal(contest.ingredientBreakdown([{key:'cv_heftroot_333333',stars:4,rarityMultiplier:1.1}],foodDefs)[0].points,4.4,'inspector uses the same archived source multiplier');
const fishHost={window:{}};
vm.runInNewContext(fs.readFileSync('docs/js/fish-catalog.js','utf8'),fishHost);
const actualFish=fishHost.window.FishCatalog.entries;
const tawny=rarity.fishRarity('gurumahi_tawny',actualFish);
assert.equal(tawny.availableSeasons.length,3,'actual fish seasonal strings parse into three localized seasons');
assert.equal(tawny.availableSeasons.includes('Coldmuck'),false,'winter/Coldmuck restrictions are preserved');
assert.equal(rarity.fishCatch('gurumahi_tawny',{zone:'town',season:'Coldmuck',timeOfDay:'day',entries:actualFish}).probability,0,'seasonal exclusion matches the real fishing pool');
assert(rarity.fishCatch('rockscale_ironvein',{zone:'westernSlope',season:'Coldmuck',timeOfDay:'day',entries:actualFish}).probability>0,'Western Slope uses northern-cliffs fish entries');
assert.equal(rarity.fishCatch('gurumahi_tawny',{zone:'town',season:'Deadgrass',timeOfDay:'day',allowAmphibious:false,entries:actualFish}).probability,0,'dry-land casting excludes amphibious fish');
assert.equal(rarity.fishCatch('gurumahi_tawny',{zone:'town',season:'Deadgrass',timeOfDay:'day',allowAmphibious:true,entries:actualFish}).probability>0,true,'water casting can select amphibious fish');
assert.equal(rarity.item('cv_heftroot_333333Seeds',{itemDefs:nativeDefs}).proposedSellPrice,nativeDefs.cv_heftroot_333333Seeds.sellPrice,'diagnostic price never compounds its already adjusted sale price');
assert.equal(rarity.item('cv_heftroot_333333Seeds',{itemDefs:nativeDefs}).actualSellPrice,nativeDefs.cv_heftroot_333333Seeds.sellPrice,'diagnostic report shows actual configured resale');

const oldArtifactCatalog = globalThis.ArtifactCollection; // Integration probe supplies the same loaded artifact table the browser exposes.
globalThis.ArtifactCollection = catalog;
const sourceCount = rarity.ruinArtifactOpportunity('hachutuCommon',{chests:[{tier:1,culture:'harlyao'},{tier:1,culture:'hachutu'}]});
assert.equal(sourceCount.chestCount,1,'generated ruin census filters real Hachutu vs Harlyao chest cultures');
assert.equal(sourceCount.conditionalChancePerRuin,1,'one eligible chest with a single eligible artifact must contain that artifact');
assert.equal(rarity.ruinArtifactOpportunity('harlyaoRare',{chests:[{tier:1,culture:'harlyao'}]}).conditionalChancePerRuin,0,'ineligible chest tier cannot generate a higher-tier relic');
if (oldArtifactCatalog === undefined) delete globalThis.ArtifactCollection;
else globalThis.ArtifactCollection = oldArtifactCatalog;
assert.equal(rarity.lootPoolItem('rare','puzzleCave',{puzzleCave:{kind:'exclusive',entries:[{itemKey:'rare',weight:1}]}}).probability,null,
  'without reward tier, trinket-gated cave odds remain unknown');
const festivalSource = fs.readFileSync('docs/js/festival-system.js','utf8');
const ingredientStart = festivalSource.indexOf('  function contestIngredients(');
const ingredientEnd = festivalSource.indexOf('  function contestData()',ingredientStart);
assert(ingredientStart >= 0 && ingredientEnd > ingredientStart,'real festival source exposes source-preserving contestIngredients');
const contestIngredients = vm.runInNewContext('(function(){'+festivalSource.slice(ingredientStart,ingredientEnd)+
  '; return contestIngredients; })()', {window:{HobunjiCookingData:{recipes:[]}}});
const snap=contestIngredients({festivalIngredientQuality:[{key:'cv_heftroot_333333',stars:4,rarityMultiplier:1.234,
  slotId:'main',contributesEffects:true}]},4);
assert.equal(snap.ingredients[0].rarityMultiplier,1.234,'festival recovery retains a cooked ingredient\'s exact historical rarity factor');
assert.equal(contest.scoreIngredients(snap.ingredients,foodDefs),4.94,'judge scores the exact retained source multiplier');
assert.equal(contestIngredients({festivalIngredientQuality:[{key:'plain',stars:4}]},4).ingredients[0].rarityMultiplier,undefined,
  'legacy ingredient without a snapshot is not fabricated into a saved certainty');
const cookingSource = fs.readFileSync('docs/js/cooking-system.js','utf8');
assert(cookingSource.includes('festivalIngredientQuality:contestIngredients') &&
  cookingSource.includes('scoreIngredients?.(contestIngredients,deps.ITEM_DEFS)'),
  'newly cooked meals save exactly the ingredient data used to compute the contest score');
const bootstrapSource = fs.readFileSync('docs/js/dev-random-ruin-bootstrap.js','utf8');
const chestsSource = fs.readFileSync('docs/js/dev-random-ruin-dungeon-chests.js','utf8');
assert(bootstrapSource.match(/dev-random-ruin-dungeon-chests\.js\?v=[A-Za-z0-9_-]+/) &&
  chestsSource.includes('culture:chest.culture'),'actual browser ruin chest loader and snapshot both include culture-aware rarity');
const indexSource = fs.readFileSync('docs/index.html','utf8');
for (const name of ['item-acquisition-rarity','crop-varieties','cooking-system','festival-potluck-contest','festival-system','festival-ui'])
  assert(indexSource.includes('js/'+name+'.js?v='),'all modified critical browser scripts carry a versioned loader entry');
const childPrice = rarity.item('cv_heftroot_333333Seeds',{itemDefs:nativeDefs});
assert.equal(childPrice.actualSellPrice,childPrice.proposedSellPrice,'priced cultivar diagnostics apply scarcity only once');

assert.equal(rarity.foodRarity('malformed',{malformed:{ingredientKeys:'not-an-array'}}).factor,1,'legacy string provenance metadata is safely ignored');
const traced=rarity.item('flour',{itemDefs:foodDefs});
assert.equal(traced.foodRaritySources[0].key,'cv_heftroot_333333','food rarity debug reports the actual imported ancestor');
assert.equal(traced.foodSourceCount,1,'food rarity breakdown counts its actual source chain');
assert.equal(rarity.item('unknown',{itemDefs:{unknown:{sellPrice:5}}}).foodRarity,1,'unsupported categories remain neutral');
const shippingSource=fs.readFileSync('docs/js/shipping-panel.js','utf8');
assert(shippingSource.includes('selectedItemRarity: standaloneDebugVisible && shippingSelected.key') &&
  shippingSource.includes('selectedItemBaseSellPrice: standaloneDebugVisible && shippingSelected.key'),
  'existing mobile Shipping debug view exposes source rarity and actual price only when requested');
assert(indexSource.includes('js/shipping-panel.js?v='),'browser cache refresh reaches on-device Shipping rarity diagnostics');
crops.attach({cropData:{...nativeCrop},ITEM_DEFS:{...nativeDefs},inventory:{},inventoryItems:[]});
assert.equal(crops.lastBreeding,null,'switching worlds clears previous-world parent/offspring debug state');


const spice = rarity.importedSpice('cloudSaffron',{townValue:1});
assert(Math.abs(spice.stockChancePerCaravan-.5)<1e-12,'one or two spices from three gives one-half listing probability');
assert(Math.abs(spice.probability-.075)<1e-12,'Slagothim spice opportunity accounts for 15% daily arrival');
assert.equal(spice.meanQuantityPerListing,2,'stock roll yields 1–3 spices, averaging two');
assert(Math.abs(rarity.importedSpice('starpepper',{townValue:4}).specificSpiceChancePerDay-.165)<1e-12,'Town Value changes the daily spice frequency');
assert.equal(rarity.importedSpice('not-a-spice'),null,'other items are not mislabeled imported seasonings');
assert(rarity.foodRarity('cloudSaffron',{cloudSaffron:{}}).factor>1,'imported seasonings affect raw Gorkunash ingredients');
assert(rarity.foodRarity('spicedFood',{spicedFood:{ingredientKeys:['cloudSaffron']}}).factor>1,'processed seasonings pass scarcity through cooked ancestry');
const sourcePools = {
  bandit_rare:{entries:[{itemKey:'rareLoot',min:1,max:1,chance:.02,conditions:{}}]},
  bandit_common:{entries:[{itemKey:'commonLoot',min:1,max:1,chance:1,conditions:{}}]},
  bandit_conditional:{entries:[{itemKey:'conditionalLoot',min:1,max:1,chance:.02,conditions:{seasons:['Coldmuck']}}]}
};
const priceDefs={rareLoot:{cat:'material',sellPrice:100},commonLoot:{cat:'material',sellPrice:100},
  conditionalLoot:{cat:'material',sellPrice:100}, cloudSaffron:{cat:'spice',sellPrice:100},
  cookedRare:{cat:'processed',sellPrice:100,ingredientKeys:['rareLoot']},
  rareBaby:{cat:'livestock',sellPrice:100},
  rePriced:{cat:'food',rarityBaseSellPrice:100,sellPrice:135},
  scarceShopItem:{cat:'material',sellPrice:100}};
const q={itemDefs:priceDefs,lootPools:sourcePools,shopStock:{}};
assert.equal(rarity.priceQuote('rareLoot',100,q).price,135,'very rare conditional loot receives at most 35% authorized uplift');
assert.equal(rarity.sellPrice('rareLoot',100,q),135,'shipping uses the same one-pass appraisal');
assert.equal(rarity.sellPrice('commonLoot',100,q),100,'guaranteed corpse loot retains authored price');
assert.equal(rarity.sellPrice('conditionalLoot',100,q),100,'unresolved seasonal loot cannot gain a fabricated premium');
assert.equal(rarity.sellPrice('noSource',100,q),100,'unsourced valuables retain their economy baseline');
assert(rarity.sellPrice('cloudSaffron',100,q)>100,'imported spice availability can influence shipping sale price');
assert.equal(rarity.sellPrice('cookedRare',100,q),100,'processed recipes do not receive a second premium on top of their input prices');
assert.equal(rarity.sellPrice('rareBaby',100,q),100,'livestock inherited genotype/breeding pricing is protected');
assert.equal(rarity.sellPrice('rePriced',135,q),135,'existing rarity-priced items never get a second uplift');
assert.equal(rarity.sellPrice('rareLoot',100,{...q,shopStock:{generalStore:{goods:[{gives:{rareLoot:1},price:130}]}}}),100,
  'authored staple shop route prevents unearned corpse rarity premium');
assert.equal(rarity.shopListings('rareLoot',{generalStore:{goods:[{gives:{rareLoot:1},price:130}]}})[0].price,130,
  'regular shop listings use real authored item quantities and purchase prices');
assert(rarity.acquisitionSources('rareLoot',q).some(entry=>entry.sourceId==='bandit_rare'),'direct item pool indexed for diagnostics');
assert(rarity.item('noSource',{...q}).appraisal.reason.includes('no comparable'),'unsourced item reports why it is unchanged');
assert.equal(rarity.item('cloudSaffron',{...q}).kind,'imported-spice','daily Slagothim spice stock is a first-class acquisition source');
assert.equal(rarity.lootPoolIdsForItem('rareLoot',sourcePools).length,1,'one corpse pool source indexed for its item');
assert.equal(rarity.lootPoolIdsForItem('none',sourcePools).length,0,'unknown loot item has no spurious indexes');
assert.equal(rarity.lootPoolIdsForItem('rareLoot',{different:{entries:[]}}).length,0,'source index is invalidated on pool map reload');
assert.equal(rarity.priceQuote('rareLoot',null,q).price,null,'missing base price does not turn into a fabricated ganang value');
const shippingTradeCode=fs.readFileSync('docs/js/shipping-panel.js','utf8');
assert(shippingTradeCode.includes('ItemAcquisitionRarity?.sellPrice?.(key,authored'), 'shipping uses one source-aware price accessor');
const traderCode=fs.readFileSync('docs/js/slagothim-traders.js','utf8');
assert(traderCode.includes('const IMPORTED_SPICES') && traderCode.includes('shuffled(rng, IMPORTED_SPICES)'),
  'stock listing and rarity analysis share one authoritative spice roster');

console.log('Item acquisition rarity tests passed.');
