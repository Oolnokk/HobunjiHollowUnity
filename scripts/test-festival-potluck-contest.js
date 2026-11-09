#!/usr/bin/env node
'use strict';
// Uses the shipped contest, cooking data, cosmetics and caravan files; no duplicated scoring implementation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
const ctx = vm.createContext({ window });
for (const script of ['cooking-data', 'festival-potluck-contest'])
  vm.runInContext(fs.readFileSync('docs/js/' + script + '.js','utf8'), ctx, { filename:script });
const rules = window.FestivalPotluckContest;
const proto = window.HobunjiCookingData.items;
const defs = Object.fromEntries(Object.entries(proto).map(([key,item]) => [key,{
  cookingProcessingTier:item.processingTier || 'raw', label:item.name,
}]));
const npcs = [
 {id:'teacup_unumanuk',name:'Teacup',speciesId:'engh-sho'},
 {id:'hreesh',name:'Hreesh',speciesId:'engh-sho'},
 {id:'gikali_ginju',name:'Gikali',speciesId:'mao-ao'},
 {id:'jubmir',name:'Jubmir',speciesId:'slagothim'},
 {id:'harkharash',name:'Surveyor Kharkanash',speciesId:'engh-sho'},
 {id:'sloomi',name:'Sloomi',speciesId:'mashtzarr'},
 {id:'kenkari_test',name:'Kenkari Cook',speciesId:'kenkari'},
 {id:'engh_test',name:'Engh Cook',speciesId:'engh-sho'}
];
const days = rules.buildDays(npcs,1156,defs);
const again = rules.buildDays(npcs,1156,defs);
assert.equal(JSON.stringify(days),JSON.stringify(again),'saved year/roster rerolls deterministically');
assert.equal(days.length,7,'all seven days generated');
assert(days.every(row=>row.length===6),'six NPC cooks share the table with one player entry');
const every = days.flat();
for (const meal of every) {
 assert.equal(meal.score,rules.scoreIngredients(meal.ingredients,defs),'stars always agree with displayed ingredients');
 assert(meal.score >= meal.minimum && meal.score <= meal.cap,'every cook observes their minimum and maximum');
 assert(meal.label.startsWith(meal.owner + "'s "),'pot labels name the individual cook');
}
for (const meal of every)
 assert.deepEqual(meal.foodEffects,rules.mealEffects(meal.ingredients,defs),'stored NPC eating buffs reflect every ingredient quality and processing tier');
const weak = rules.ingredientEffects('nelkMeat',1,defs).strength;
const strong = rules.ingredientEffects('nelkMeat',5,defs).strength;
assert(strong > weak,'higher quality meat increases its actual food buff, not merely the contest score');
const processed = rules.ingredientEffects('nelkMayonnaise',5,defs);
const unprocessed = rules.ingredientEffects('nelkEggs',5,defs);
assert(Object.values(processed).some(value=>value>Math.min(...Object.values(unprocessed))),'processing can amplify ingredient food effects');
const ingredientDetails = rules.ingredientBreakdown([{key:'nelkMeat',stars:5},{key:'nelkMayonnaise',stars:3}],defs);
assert.equal(ingredientDetails.reduce((total,item)=>total+item.points,0),
  rules.scoreIngredients([{key:'nelkMeat',stars:5},{key:'nelkMayonnaise',stars:3}],defs),
  'visible ingredient points match real contest judging');
assert(ingredientDetails.every(item=>Object.keys(item.effects).length),'ingredient detail includes actual effects alongside stars');
const structural = [{key:'nelkMeat',stars:5,contributesEffects:true},{key:'nelkEggs',stars:5,contributesEffects:false}];
assert.equal(rules.scoreIngredients(structural,defs),
  rules.ingredientPoints('nelkMeat',5,defs)+rules.ingredientPoints('nelkEggs',5,defs),
  'structural recipe ingredients still contribute contest points');
assert.deepEqual(rules.mealEffects(structural,defs),rules.ingredientEffects('nelkMeat',5,defs),
  'no-buff structural slots are excluded from actual cooked meal effects');
assert.equal(Object.keys(rules.ingredientBreakdown(structural,defs)[1].effects).length,0,
  'ingredient inspector never promises an eating buff for a structural cooking slot');
window.CookingSystem = { ingredientEffectTotals:(_def,stars)=>({cooking:Number(stars)*7}) };
assert.equal(rules.ingredientEffects('nelkMeat',4,defs).cooking,28,'the inspector delegates to the initialized cooking system');
delete window.CookingSystem;
const find = id=>every.filter(entry=>entry.npcId===id);
assert(find('teacup_unumanuk').every(entry=>entry.minimum > 23),'grandmother has highest minimum');
assert(find('hreesh').every(entry=>entry.minimum > 16),'Hreesh minimum exceeds mother minimum');
assert(find('gikali_ginju').every(entry=>entry.minimum > 7),'mothers cook above ordinary minimum');
assert(find('harkharash').every(entry=>entry.ingredients.some(item=>['smokedMeat','fishSauce','nelkMayonnaise'].includes(item.key))),'surveyor uses laboriously processed expensive food');
assert(find('jubmir').some(entry=>entry.ingredients.some(item=>rules.SPICES.includes(item.key))),'Jubmir uses imported trader spices');
assert(find('sloomi').every(entry=>entry.ingredients.some(item=>['heftroot','needlegrain','puktukMilk','voorgAssMilk','nelkMeat'].includes(item.key))),'Sloomi makes cold-highland food');
assert(find('kenkari_test').every(entry=>entry.ingredients.some(item=>proto[item.key]?.categories?.includes('fish'))),'every Kenkari meal contains actual fish');
const engh = find('engh_test');
assert(engh.every(entry=>entry.ingredients.some(item=>proto[item.key]?.categories?.includes('meat'))),'Engh-sho always include meat');
assert(engh.every(entry=>entry.ingredients.some(item=>['nelkEggs','puktukMilk','voorgAssMilk'].includes(item.key))),'Engh-sho use local eggs or animal dairy');
const plantCats=new Set(['vegetable','starchVegetable','fruit','berry','herb','grain','crop']);
assert(engh.every(entry=>entry.ingredients.every(item => !(proto[item.key]?.categories||[]).some(category=>plantCats.has(category)))),'Engh-sho do not cook native produce');
assert.equal(rules.ingredientPoints('fish',4,{fish:{cookingProcessingTier:'raw'}}),4);
const processDefs = {
 root:{cookingProcessingTier:'raw'},
 dried:{cookingProcessingTier:'medium',ingredientKeys:['root']},
 sauce:{cookingProcessingTier:'long',ingredientKeys:['dried']},
};
assert.equal(rules.ingredientPoints('dried',4,processDefs),8,'processed doubles first-generation source');
assert.equal(rules.ingredientPoints('sauce',4,processDefs),16,'multiple processing steps compound');
assert.equal(rules.scoreCooked({festivalIngredientQuality:[{key:'root',stars:5},{key:'sauce',stars:3}]},1,processDefs),17,'actual input quality beats the output meal star rating');
assert(!rules.winner({score:0},days),'poor entry loses');
assert(rules.winner({score:100},days),'excellent processed dish can win');
let currentDay=1156*336 + 119 + 6, complete=false, granted=[], provider=null, saveCount=0;
const awardedPack=[]; // Hreesh's actual costume grant deposits one generic prize into Pack before metal preparation.
const smithGear={clothingItems:[],clothing:{}}; // Permanent learned smith blueprints survive the recipient's future sale of the prize.
const smithSaves=[]; // Checks that faceguard metal and cap dye are persisted to the appropriate save ownership.
window.TownMine={getTownValue:()=>1,filterMetalKeysForTownValue:(keys,value)=>keys.slice(0,value+1)}; // Same low-Town-Value alloy gate as treasure chests.
vm.runInContext(fs.readFileSync('docs/js/metal-armor-system.js','utf8'),ctx,{filename:'metal-armor-system.js'});
window.MetalArmorSystem.init({
  getPackClothing:()=>awardedPack,getGearInventory:()=>smithGear,
  getPlayerData:()=>({appearance:{speciesId:'mao-ao',gender:'male'}}),
  VERDIGRIS_METAL_KEYS:['nativeCopper','lowTinBronze','tinBronze','highTinBronze','arsenicalBronze','leadedBronze'],
  saveGearInventory:()=>smithSaves.push('gear'),saveMemberWorldData:()=>smithSaves.push('world')
});
window.DoorstepVisits={registerProvider:p=>{provider=p;},markDone(){}};
const contests={'1156:gorkunash':{entry:{key:'meal',label:'Grand Feast',score:100},days,rewarded:false}};
// Use the shipped game adapter: an always-successful stub hid the helm allowlist bug.
const gameSource=fs.readFileSync('docs/game.js','utf8');
const grantStart=gameSource.indexOf('grantMask: id => {');
const grantEnd=gameSource.indexOf('\n        tellStory:',grantStart);
assert(grantStart>=0 && grantEnd>grantStart,'game supplies the festival clothing adapter');
window.FestivalSystem={MASKS:['gar-wolf','grehlr',"uumkao'ii",'voorg-ass']};
window.EquipmentPanel={clothingSpriteForCosmetic:id=>'sprite:'+id};
const grantMask=vm.runInNewContext('({'+gameSource.slice(grantStart,grantEnd)+'}).grantMask',{
 window,ITEM_DEFS:{},packClothing:awardedPack
});
assert.equal(grantMask('unrelated_hat'),false,'festival grant cannot mint arbitrary clothing');
assert.equal(grantMask(undefined),false,'missing IDs are never valid rewards');
assert.equal(awardedPack.length,0);
rules.registerRewardVisit({
 grantMask:id=>{granted.push(id);return grantMask(id);},
 save:()=>saveCount++
},()=>contests,key=>{contests[key].rewarded=true;complete=true;},()=>currentDay);
assert.equal(provider.next(),null,'no Hreesh visit on the seventh day');
currentDay++;
const visit=provider.next();
assert.equal(visit.npcId,'hreesh','Hreesh delivers the prize');
assert.match(visit.tree.nodes.at(-1).text,/Replica Helm of Bzabag/);
assert.equal(granted.length,0,'dialogue beginning does not award item');
assert(provider.onComplete(visit),'natural completion awards helm');
assert(complete && saveCount>0 && granted[0]==='replica_bzabag_helm','Hreesh awards the expected cosmetic');
const awardedHelm=awardedPack[0]; // Actual awarded item is now tested against the real MetalArmorSystem, not a stub.
assert.equal(awardedHelm.slot,'hat','the potluck helm uses the real hat slot independently from masks');
assert.equal(awardedHelm.label,'Replica Helm of Bzabag','the prize keeps its name when cosmetic item definitions are not registered');
assert.equal(awardedHelm.materialKind,'metal','prize upgrades to smith metal armor');
assert(['nativeCopper','lowTinBronze'].includes(awardedHelm.metalKey),'starting faceguard alloy obeys current chest Town Value eligibility');
assert.equal(awardedHelm.weaveMaterial,'light','the unique festival prize uses the light-wool cap by default');
assert(awardedHelm.colorA?.hex && awardedHelm.dyeable,'wool cap retains the garment dye channel');
assert(awardedHelm.weightUnits>0 && smithGear.knownMetalArmorBlueprints.includes('replica_bzabag_helm'),'prize unlocks the smith blueprint and proper outfit burden');
assert(smithSaves.includes('world') && smithSaves.includes('gear'),'prize and smith unlock persist in their respective save domains');
const prizeMetal=awardedHelm.metalKey;
assert(window.MetalArmorSystem.prepareFestivalHelmPrize(),'rechecking an already-upgraded prize is harmless');
assert.equal(awardedHelm.metalKey,prizeMetal,'rechecking the reward never rerolls its already-owned alloy');
assert.equal(provider.next(),null,'reward cannot recur');
assert(grantMask('festivalmask_gar-wolf'),'ordinary Hachutukara masks still grant');
assert.equal(awardedPack.at(-1).slot,'mask','festival animal masks use their independent mask slot');
const cosmetic = JSON.parse(fs.readFileSync('docs/config/cosmetics/clothes/hat/replica_bzabag_helm.json','utf8'));
const catalog = JSON.parse(fs.readFileSync('docs/config/cosmetics/index.json','utf8'));
assert(catalog.entries.some(entry=>entry.id===rules.HELM_ID));
assert(cosmetic.onlyExactSpeciesVariant && Object.keys(cosmetic.parts).length===0,'non-illustrated characters cannot render Mao-ao male art');
assert.deepEqual(Object.keys(cosmetic.speciesVariants),['mao-ao_male']);
assert.equal(cosmetic.material,'mixed');
const helmLayers=cosmetic.speciesVariants['mao-ao_male'].parts.head.layers; // The cap must share the head-front plane with the faceguard, not sit behind the skull.
assert.deepEqual(Object.keys(helmLayers),['front_cap','front'],'wool cap draws above the character head, then faceguard draws above the cap');
assert.equal(helmLayers.front_cap.materialKind,'cloth');
assert.equal(helmLayers.front.materialKind,'metal');
assert.equal(helmLayers.front_cap.behindImage.url,helmLayers.front_cap.image.url,'rear view reuses identical dyeable wool cap art');
assert.equal(helmLayers.front.behindImage.url,'./assets/cosmetics/clothes/hat/headband.png','metal rear band reuses Mao-ao Tanged Circlet behind art');
for (const file of ["replica_bzabag's_helm-cap_m.png","replica_bzabag's_helm-faceguard_m.png"])
 assert(fs.existsSync('docs/assets/cosmetics/clothes/hat/'+file),'real helm PNG available: '+file);
const traderSource = fs.readFileSync('docs/js/slagothim-traders.js','utf8');
for(const spice of ['cloudSaffron','starpepper','nightCardamom']){
 assert(proto[spice]?.categories.includes('spice'),'imported seasoning registered for cooking');
 assert(traderSource.includes(spice),'imported seasoning sold by Slagothim caravans');
}
console.log('Gorkunash seeded contest, regional recipes, provenance, caps, prize and partial helmet art passed.');
