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
assert(Math.abs(rarity.lootPoolItem('drop','mixed',quantityPools).probability-.15)<1e-12,'one-source mixed pool inherits the source’s exact positive-quantity chance');
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
const testedRuin=rarity.ruinArtifactOpportunity('harlyaoCommon',{chests:[
  {tier:1,culture:'harlyao',opened:true,loot:{harlyaoCommon:2}},
  {tier:2,culture:'harlyao',opened:false,loot:null},
  {tier:1,culture:'hachutu',opened:false,loot:null},
]});
assert.equal(testedRuin.chestCount,2,'Hachutu chests are excluded from a Harlyao opportunity count');
assert.equal(testedRuin.openedChestCount,1,'already opened Harlyao chest is not a future roll');
assert.equal(testedRuin.unopenedChestCount,1,'only one unopened chest remains available');
assert.equal(testedRuin.alreadyLootedCopies,2,'real recovered copies remain visible without being rerolled');
assert(Math.abs(testedRuin.conditionalChancePerRuin - rarity.artifactChest('harlyaoCommon',2,'harlyao',catalog).probability)<1e-12,
  'remaining chance matches only the unopened eligible chest tier');
assert.equal(rarity.item('harlyaoRare').acquisition,null,'no unspecified default tier-4 artifact probability');
assert(rarity.item('harlyaoRare').acquisitionRoutes.some(route=>route.kind==='artifact'),
  'artifact diagnostics enumerate eligible tiers rather than pretending one tier is universal');
assert.equal(rarity.item('harlyaoRare',{chestTier:2}).acquisition.chestTier,2,
  'explicit artifact tier restores exact conditional chest probability');
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
const priceDefs={noSource:{cat:'material',sellPrice:100},rareLoot:{cat:'material',sellPrice:100},commonLoot:{cat:'material',sellPrice:100},
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


const noHeartCycle = rarity.farmBreeding({averageParentHearts:0,gestationDays:3,heartMax:5,baseMutationChance:.05});
assert.equal(noHeartCycle.speedMultiplier,.6,'zero-heart farm pair proceeds at 0.6× gestation speed');
assert.equal(noHeartCycle.remainingWakingDays,5,'three gestation days at 0.6× takes five waking days');
assert.equal(noHeartCycle.mutationChance,.05,'unhappy pair retains the base mutation chance');
const happyCycle = rarity.farmBreeding({averageParentHearts:5,gestationDays:3,heartMax:5,baseMutationChance:.05});
assert.equal(happyCycle.speedMultiplier,1.5,'five-heart pair progresses at 1.5× speed');
assert.equal(happyCycle.remainingWakingDays,2,'three authored days finish in two at five hearts');
assert(Math.abs(happyCycle.mutationChance-.15)<1e-12,'happy pair has threefold mutation chance');
assert.equal(happyCycle.remainingWakingHours,32,'waking-hour progress uses FarmAnimals hourly scale');
assert.equal(rarity.farmBreeding({averageParentHearts:6,gestationDays:3,heartMax:5}),null,'invalid heart values are rejected');
assert(rarity.farmBreeding({averageParentHearts:null,gestationDays:3,heartMax:5}).remainingWakingDays===null,
  'unknown parent happiness does not turn into a made-up gestation duration');
assert(happyCycle.possibleOutcome.includes('not one inventory'),'farm breeding creates world livestock, not an inventory egg or baby item');
const oldFarmAnimals=globalThis.FarmAnimals,oldScratchbones=globalThis.SCRATCHBONES_CONFIG,oldGenetics=globalThis.CreatureGenetics;
globalThis.FarmAnimals={GESTATION_DAYS:3,GESTATION_HOURS_PER_DAY:16,HEART_MAX:5};
globalThis.SCRATCHBONES_CONFIG={game:{livestock:{itemKinds:{nelkBaby:'nelk'}}}};
globalThis.CreatureGenetics={MUTATION_CHANCE:.05};
const breedingRoute=rarity.acquisitionSources('nelkBaby',{hasBreedingPair:true,averageParentHearts:4,shopStock:{},lootPools:{}});
assert(breedingRoute.some(entry=>entry.kind==='breeding' && entry.probability===null),
  'valid pair completion time is described without assigning a false item-drop probability');
assert(breedingRoute.find(entry=>entry.kind==='breeding').detail.possibleOutcome.includes('not one inventory'),
  'breeding source explicitly explains it produces a livestock record');
if(oldFarmAnimals === undefined)delete globalThis.FarmAnimals;else globalThis.FarmAnimals=oldFarmAnimals;
if(oldScratchbones === undefined)delete globalThis.SCRATCHBONES_CONFIG;else globalThis.SCRATCHBONES_CONFIG=oldScratchbones;
if(oldGenetics === undefined)delete globalThis.CreatureGenetics;else globalThis.CreatureGenetics=oldGenetics;
const orePools={mineRare:{entries:[{itemKey:'ore_gold',min:1,max:1,chance:.001}]},
  chestRare:{entries:[{itemKey:'rareTrinket',min:1,max:1,chance:.001}]}};
assert.equal(rarity.sellPrice('ore_gold',7,{itemDefs:{ore_gold:{cat:'material',sellPrice:7}},lootPools:orePools,shopStock:{}}),7,
  'gold/bronze lore floors cannot be overwritten by loot rarity');
assert.equal(rarity.sellPrice('rareTrinket',200,{itemDefs:{rareTrinket:{cat:'gear',tags:['Trinket']}},lootPools:orePools,shopStock:{}}),200,
  'trinket-specific authored gear progression is protected');
const oldTownMine=globalThis.TownMine;
globalThis.TownMine={getTownValue:()=>0};
const spiceZeroTown=rarity.foodRarity('cloudSaffron',{});
globalThis.TownMine={getTownValue:()=>8};
const spiceHighTown=rarity.foodRarity('cloudSaffron',{});
assert.equal(spiceHighTown.factor,spiceZeroTown.factor,
  'historical festival scores use baseline spice acquisition difficulty, not the character’s current Town Value');
if(oldTownMine===undefined)delete globalThis.TownMine;else globalThis.TownMine=oldTownMine;


const mixSources={
  sourceA:{entries:[{itemKey:'rare',chance:.5,min:1,max:1}]},
  sourceB:{entries:[{itemKey:'common',chance:1,min:1,max:1}]},
  weighted:{kind:'mixed',rolls:2,sourcePools:[{poolId:'sourceA',weight:1},{poolId:'sourceB',weight:3}]},
  gated:{entries:[{itemKey:'rare',chance:.5,min:1,max:1,conditions:{weather:['rain']}}]},
  unsafeMix:{kind:'mixed',rolls:2,sourcePools:[{poolId:'sourceA',weight:1},{poolId:'gated',weight:1}]},
  nested:{kind:'mixed',rolls:1,sourcePools:[{poolId:'weighted',weight:1}]},
  cycleA:{kind:'mixed',rolls:1,sourcePools:[{poolId:'cycleB',weight:1}]},
  cycleB:{kind:'mixed',rolls:1,sourcePools:[{poolId:'cycleA',weight:1}]},
};
assert.equal(rarity.lootPoolItem('rare','weighted',mixSources).probability,1-Math.pow(1-.125,2),
  'independent weighted mixed draws combine over two rolls without summing chances');
assert.equal(rarity.lootPoolItem('rare','weighted',mixSources).expectedQuantity,.25,
  'two draws × 1/4 source weight × 1/2 item chance gives one-quarter expected item');
assert.equal(rarity.lootPoolItem('rare','unsafeMix',mixSources).probability,null,
  'any unresolved child condition leaves the entire mixed chance unknown');
assert.equal(rarity.lootPoolItem('rare','nested',mixSources).probability,1-Math.pow(1-.125,2),
  'nested mixed source recursion retains the same underlying per-roll result');
assert.equal(rarity.lootPoolItem('rare','cycleA',mixSources).probability,null,
  'cyclic edited mixed pools cannot recurse forever or invent a drop probability');
const authoredPuzzle={
  kind:'exclusive',entries:[
    {itemKey:'trinket_unstableBalance',weight:1,tier:1},
    {itemKey:'trinket_ironAnchor',weight:1,tier:1},
    {itemKey:'trinket_leadKnuckles',weight:1,tier:2},
  ],
};
const triDefs={unstableBalance:{},ironAnchor:{},leadKnuckles:{}};
assert.equal(rarity.lootPoolItem('trinket_unstableBalance','puzzleCave',{puzzleCave:authoredPuzzle},
  {rewardTier:1,trinketDefinitions:triDefs}).probability,.5,
  'tier-one puzzle cave rewards pick one of the two eligible loaded trinkets');
assert.equal(rarity.lootPoolItem('trinket_unstableBalance','puzzleCave',{puzzleCave:authoredPuzzle},
  {rewardTier:2,trinketDefinitions:triDefs}).probability,0,
  'puzzle caves of another reward tier cannot award the selected trinket');
assert.equal(rarity.lootPoolItem('trinket_unstableBalance','puzzleCave',{puzzleCave:authoredPuzzle},
  {trinketDefinitions:triDefs}).probability,1/3,
  'mixed cave source without explicit reward tier chooses among all loaded trinkets');
const mixedPuzzle={...mixSources,puzzleCave:authoredPuzzle,
  mixed:{kind:'mixed',rolls:2,sourcePools:[{poolId:'sourceA',weight:1},{poolId:'puzzleCave',weight:1}]}};
assert(Math.abs(rarity.lootPoolItem('trinket_unstableBalance','mixed',mixedPuzzle,
  {trinketDefinitions:triDefs}).probability-(1-Math.pow(1-1/6,2))) < 1e-12,
  'a tierless nested puzzle source contributes its correctly weighted trinket chance');


const berryHost={window:{}};
vm.runInNewContext(fs.readFileSync('docs/js/wild-berries.js','utf8'),berryHost);
const owner=berryHost.window.WildBerries;
const nativeBerryZone='map_northern_cliffs';
owner.init({cropData:{redberries:{seedKey:'redberrySeeds'}},
  _zoneBerryPersist:new Map([[nativeBerryZone,{day:4,placements:[]}]]),
  _zoneBerryObjects:new Map([[nativeBerryZone,new Map([
    ['1,1',{berryKey:'redberries',col:1,row:1,reserved:false}],
    ['2,2',{berryKey:'redberries',col:2,row:2,reserved:false}],
  ])]])});
const previousBerries=globalThis.WildBerries;
globalThis.WildBerries=owner;
const bush=rarity.wildBerrySource('redberries');
const wildSeed=rarity.wildBerrySource('redberrySeeds');
assert.equal(bush.perBushChance,1,'the live berry bush guarantees its primary fruit harvest');
assert.equal(bush.observedBushes,2,'source readback counts exactly two live registered native bushes');
assert.equal(wildSeed.perBushChance,.2,'a native berry seed has an independent 20% chance per harvested bush');
assert.equal(wildSeed.chancePerRandomZoneBush,.2,'Northern Cliffs has one wild berry species, so random-bush chance equals seed roll');
assert.equal(rarity.wildBerrySource('yellowberries').speciesChancePerGeneratedZoneBush,.5,
  'Yellowberries and Whiteberries share the Western Slope wild berry spawn pool');
assert.equal(rarity.wildBerrySource('yellowberries').chancePerRandomZoneBush,.5,
  'a random Western Slope berry bush is Yellowberries exactly half the time');
assert(Math.abs(wildSeed.atLeastOne-.36)<1e-12,'two 20% seed opportunities combine to 36%');
assert.equal(wildSeed.expectedYield,.4,'two bush visits yield .4 seeds in expectation');
assert.equal(rarity.foodRarity('redberries',{redberries:{}}).factor,1,'native berry source does not invent a rare food premium');
assert(rarity.acquisitionSources('redberrySeeds',{lootPools:{},shopStock:{}}).some(x=>x.kind==='foraging'),
  'wild berry seeds are represented as actual wilderness acquisition sources');
assert.equal(rarity.wildBerrySource('heftroot'),null,'nonberry crops are not given invented wild berry bushes');
const unreached=rarity.wildBerrySource('blueberries');
assert.equal(unreached.observedBushes,null,'an ungenerated biome is unknown, not zero berry bushes');
const persistedOnlyZone='map_western_slope';
owner.init({cropData:{yellowberries:{seedKey:'yellowberrySeeds'}},
  _zoneBerryPersist:new Map([[persistedOnlyZone,{day:4,placements:[{col:2,row:2,key:'yellowberries'}]}]]),
  _zoneBerryObjects:new Map()});
assert.equal(rarity.wildBerrySource('yellowberries').observedBushes,null,
  'an unloaded zone with persisted placements is not misreported as zero live berries');
assert.equal(unreached.atLeastOne,null,'unknown biome count does not fabricate a negative or positive seed availability');
if(previousBerries===undefined)delete globalThis.WildBerries;else globalThis.WildBerries=previousBerries;


const worldMetadata={worlds:[{id:'worldA'},{id:'worldB'}]};
let worldJson=JSON.stringify(worldMetadata),rejectWorldSave=false;
const worldStoreContext={window:{},localStorage:{
  getItem:()=>worldJson,
  setItem:(_key,value)=>{if(rejectWorldSave)throw Error('simulated disk full');worldJson=String(value);},
},performance:{now:()=>0}};
vm.runInNewContext(fs.readFileSync('docs/js/world-meta-store.js','utf8'),worldStoreContext);
const sharedStore=worldStoreContext.window.WorldMetaStore;
cropHost.window.WorldMetaStore=sharedStore;
cropHost.window.__hobunjiPlayerProfile={worldId:'worldA'};
const originalGlobalCrop=globalThis.CropVarieties;
globalThis.CropVarieties=crops; // Engine observes the same production CropVarieties owner it would see in a browser.
crops.attach({cropData:{...nativeCrop},ITEM_DEFS:{...nativeDefs},inventory:{},inventoryItems:[]});
const ancestor=crops.ensure('cv_heftroot_333333');
const coloredAncestor=crops.ensure('cv_heftroot_333333_aabbcc');
const offspringA=crops.breed(ancestor.id,coloredAncestor.id,()=>.6);
const offspringB=crops.breed(coloredAncestor.id,ancestor.id,()=>.6);
assert.equal(offspringA.id,offspringB.id,'distinct parent directions can produce the same genetically identical child key');
const savedPedigree=crops.provenanceFor(offspringA.id);
assert.equal(savedPedigree.totalObserved,2,'two actual breeding events are recorded for a child genotype');
assert.equal(savedPedigree.routes.length,2,'separate observed parent pairs are retained rather than overwritten');
assert.equal(crops.provenanceFor(offspringA.seedKey).key,offspringA.id,'seed and produce refer to the same recorded genotype lineage');
assert.equal(sharedStore.loadCropProvenance('worldA').records[offspringA.id].routes.length,2,
  'canonical world metadata saves the actual parent routes for folder/cloud recovery');
const lineageEstimate=rarity.cultivarRarity(offspringA.id);
assert.equal(lineageEstimate.origin,'observed-parentage','rarity model reads the saved parent evidence');
assert.equal(lineageEstimate.probability,null,'conditional genotype probability is not a universal world acquisition rate');
assert.equal(lineageEstimate.knownParentRoutes,2,'rarity diagnostics preserve both observed parent pathways');
assert(lineageEstimate.conditionalGenotypeChance>0,'recorded source exposes mathematically exact per-attempt odds');
assert(rarity.foodRarity(offspringA.id).factor>1,'Gorkunash derives multigeneration rarity from observed parents');
cropHost.window.__hobunjiPlayerProfile={worldId:'worldB'};
crops.attach({cropData:{...nativeCrop},ITEM_DEFS:{...nativeDefs},inventory:{},inventoryItems:[]});
assert.equal(crops.provenanceFor(offspringA.id),null,'changing active world clears the previous world’s observed genealogy');
assert.equal(rarity.cultivarRarity(offspringA.id).origin,'crossbred-or-inherited',
  'an identical saved genotype in a different world does not inherit foreign-world parent evidence');
cropHost.window.__hobunjiPlayerProfile={worldId:'worldA'};
crops.attach({cropData:{...nativeCrop},ITEM_DEFS:{...nativeDefs},inventory:{},inventoryItems:[]});
assert.equal(crops.provenanceFor(offspringA.id).totalObserved,2,
  'switching back restores all recorded paths directly from canonical saved world metadata');
assert.equal(rarity.cultivarRarity(offspringA.id).origin,'observed-parentage',
  'rarity resumes source-aware calculations after world reload');
const persistedBeforeFailure=JSON.stringify(sharedStore.loadCropProvenance('worldA'));
rejectWorldSave=true;
crops.breed(ancestor.id,coloredAncestor.id,()=>.6);
assert.equal(crops.lastBreeding.provenanceSaved,false,'a failed save is visible in mobile breeding diagnostics');
assert.equal(JSON.stringify(sharedStore.loadCropProvenance('worldA')),persistedBeforeFailure,
  'failed persistence cannot silently report extra saved breeding observations');
rejectWorldSave=false;
if(originalGlobalCrop===undefined)delete globalThis.CropVarieties;else globalThis.CropVarieties=originalGlobalCrop;


const sourceZone='map_northern_cliffs';
const reagentDefs={
  frostcapMoss:{zone:sourceZone,habitat:'waterEdge'},
  graniteThistle:{zone:sourceZone,habitat:'cliffBase'}};
const alchemySource={REAGENT_DEFS:reagentDefs,reagentsForZone:()=>Object.keys(reagentDefs)};
const reagentHost={window:{AlchemySystem:alchemySource}};
vm.runInNewContext(fs.readFileSync('docs/js/reagent-plants.js','utf8'),reagentHost);
const reagents=reagentHost.window.ReagentPlants;
const currentReagentState={version:2,day:10,placements:[
  {col:1,row:2,key:'frostcapMoss',harvested:false},
  {col:2,row:3,key:'frostcapMoss',harvested:true},
  {col:3,row:3,key:'graniteThistle',harvested:false},
]};
reagents.init({_zoneReagentPersist:new Map([[sourceZone,currentReagentState]]),
  _zoneScenes:new Map([[sourceZone,{cols:20,rows:20}]]),calendar:{day:10}});
const forageCensus=reagents.sourceCensus(sourceZone);
assert.equal(forageCensus.known,true,'real daily reagent persistence counts as a measured scatter');
assert.equal(forageCensus.generatedTotal,3,'real source roster includes picked and unpicked plants');
assert.equal(forageCensus.remainingTotal,2,'harvested plants are removed from available opportunities');
assert.equal(forageCensus.bySpecies.frostcapMoss.generated,2,'habitat eligibility controls species-specific generated totals');
assert.equal(forageCensus.bySpecies.frostcapMoss.remaining,1,'only one frostcap remains to gather');
assert.equal(forageCensus.generatedMapTiles,400,'the generated zone has a measured area denominator');
assert(Math.abs(forageCensus.generatedPlantsPerMapTile-3/400)<1e-12,
  'tile density uses the real map area, not a guessed global spawn frequency');
const ruinHost={window:{THREE:{},RuinSiteLocales:{CATEGORY:'ruin_entrance',hashString:()=>5},
  AuthoredFurniture:{load:()=>null}},localStorage:{getItem:()=>null,setItem:()=>{}}};
vm.runInNewContext(fs.readFileSync('docs/js/ruin-sites.js','utf8'),ruinHost);
const ruins=ruinHost.window.RuinSites;
const testSites=['test_gate_a','test_gate_b'].map(localeId=>({localeId,category:'ruin_entrance',
  objects:[{kind:'ruinDoor',x:2,y:2,w:2,h:2}]}));
ruins.registerWorkspace(sourceZone,{localeInstances:testSites});
const ruinsCensus=ruins.sourceCensus();
assert.equal(ruinsCensus.registeredCliffSites,2,'exact cliff-entrance count comes from live workspace registration');
assert.equal(ruinsCensus.registeredZoneCount,1,'unregistered wilderness zones never count as zero ruin sites');
assert.equal(ruinsCensus.byTier.undetermined,2,'unvisited ruin guardian tiers cannot be guessed');
assert.equal(Object.values(ruinsCensus.byTheme).reduce((a,b)=>a+b,0),2,
  'each actually registered ruin belongs to exactly one deterministic tradition');
assert.equal(ruinsCensus.buriedHoleChancePerTreasureLocation,.06,'buried-ruin odds remain conditional on a treasure location');
const wildlifeHost={window:{WildernessMapGenerator:{makeRng:()=>()=>.25}}};
vm.runInNewContext(fs.readFileSync('docs/js/wildlife-spawn.js','utf8'),wildlifeHost);
const wildlife=wildlifeHost.window.WildlifeSpawn;
const wildlifeConfig={denSpecies:['puktuk','nelk'],roamingHerdCount:4,roamingHerdSpecies:['voorg-ass','moot']};
wildlife.init({zoneLayouts:new Map([[sourceZone,{cols:20,rows:20,
  dens:[{id:'den1',x:1,y:1},{id:'den2',x:5,y:5}]}]]),
  EXTERIOR_ZONES:{[sourceZone]:wildlifeConfig},hostileObjects:new Set(),
  getCurrentArea:()=>sourceZone});
const ecology=wildlife.ecologyCensus(sourceZone);
assert.equal(ecology.known,true,'den source enumerates the current generated wilderness zone');
assert.equal(ecology.animalDens,2,'exact real den roster contains two allocated dens');
assert.equal(ecology.bySpecies.nelk.total,1,'balanced den allocation gives one Nelk den');
assert.equal(ecology.bySpecies.puktuk.total,1,'balanced den allocation gives one Puktuk den');
assert.equal(ecology.roamingSpeciesChancePerSlot.moot,.5,'surface-herd selection is equal-weight between two configured species');
assert.equal(ecology.roamingHerdSlots,4,'encounter denominator uses configured herd slot count');
const priorSources={AlchemySystem:globalThis.AlchemySystem,ReagentPlants:globalThis.ReagentPlants,
  RuinSites:globalThis.RuinSites,WildlifeSpawn:globalThis.WildlifeSpawn,
  SCRATCHBONES_CONFIG:globalThis.SCRATCHBONES_CONFIG};
globalThis.AlchemySystem=alchemySource;globalThis.ReagentPlants=reagents;
globalThis.RuinSites=ruins;globalThis.WildlifeSpawn=wildlife;
globalThis.SCRATCHBONES_CONFIG={game:{livestock:{itemKinds:{nelkBaby:'nelk'}}}};
const forageFrequency=rarity.itemSourceFrequency('frostcapMoss');
assert.equal(forageFrequency.sourceKind,'habitat-reagent','foraged reagent lookup uses AlchemySystem species/habitat owner');
assert.equal(forageFrequency.exactGeneratedSpeciesSites,2,'item rarity reads exact generated habitat sites');
assert.equal(forageFrequency.remainingSites,1,'item rarity uses the unharvested actual repertoire');
assert.equal(forageFrequency.chancePerRandomGeneratedReagent,2/3,
  'species fraction is conditional on a generated habitat-correct reagent plant');
assert.equal(forageFrequency.chancePerRandomRemainingReagent,.5,
  'available plant odds recalculate after harvesting one of the species');
const nestFrequency=rarity.itemSourceFrequency('nelkBaby',{zoneId:sourceZone});
assert.equal(nestFrequency.denSites,1,'baby acquisition knows actual matching resident den count');
assert.equal(nestFrequency.chancePerGeneratedDen,.5,'specific den species share is measured rather than treated as a default guess');
const across=rarity.wildernessSourceCensus({zoneIds:[sourceZone,'map_not_generated']});
assert.equal(across.totals.dens.measuredZones,1,'only loaded/generated animal zones enter the sample');
assert.equal(across.totals.dens.total,2,'real two-den roster carries through world census');
assert.equal(across.totals.reagentSites.measuredZones,1,'unexplored reagents are not counted as absence');
assert.equal(across.totals.reagentSites.total,3,'habitat-specific generated site count is reported');
assert.equal(across.totals.availableReagents.total,2,'actual unharvested reagent count survives the census');
assert.equal(across.ruins.registeredCliffSites,2,'ruin counts come from the registered site owner');
assert.equal(rarity.item('frostcapMoss',{itemDefs:{frostcapMoss:{}},zoneId:sourceZone}).observedHabitat.remainingSites,1,
  'mobile item diagnostics surface the measured reagent opportunity count');
for(const [key,value] of Object.entries(priorSources)){
  if(value===undefined)delete globalThis[key];else globalThis[key]=value;
}

console.log('Item acquisition rarity tests passed.');
