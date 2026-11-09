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
const pools={sample:{entries:[{id:'one',itemKey:'thing',chance:.1,conditions:{}},{id:'two',itemKey:'thing',chance:.2,conditions:{}}]},conditional:{entries:[{itemKey:'thing',chance:.1,conditions:{seasons:['winter']}}]}};
assert(Math.abs(rarity.lootPoolItem('thing','sample',pools).probability-.28)<1e-12,'independent table entry odds combine via union');
assert.equal(rarity.lootPoolItem('thing','conditional',pools).probability,null,'world condition needs eligibility context');
const zoneDen=rarity.denOffspring({species:'nelk',denSpecies:['puktuk','nelk'],denCount:5,clutchMin:1,clutchMax:3});
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
assert.equal(contest.scoreIngredients([{key:'plain',stars:4},{key:'flour',stars:4}],foodDefs),breakdown.reduce((sum,entry)=>sum+entry.points,0),'Gorkunash inspector matches actual scoring');
assert.equal(breakdown[1].processingMultiplier,2);
assert(breakdown[1].rarityMultiplier>1);

console.log('Item acquisition rarity tests passed.');
