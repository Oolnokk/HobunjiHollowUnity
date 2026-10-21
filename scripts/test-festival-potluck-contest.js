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
window.DoorstepVisits={registerProvider:p=>{provider=p;},markDone(){}};
const contests={'1156:gorkunash':{entry:{key:'meal',label:'Grand Feast',score:100},days,rewarded:false}};
rules.registerRewardVisit({
 grantMask:id=>{granted.push(id);return true;},
 save:()=>saveCount++
},()=>contests,key=>{contests[key].rewarded=true;complete=true;},()=>currentDay);
assert.equal(provider.next(),null,'no Hreesh visit on the seventh day');
currentDay++;
const visit=provider.next();
assert.equal(visit.npcId,'hreesh','Hreesh delivers the prize');
assert.match(visit.tree.nodes.at(-1).text,/Replica Helm of Bzabag/);
assert.equal(granted.length,0,'dialogue beginning does not award item');
assert(provider.onComplete(visit),'natural completion awards helm');
assert(complete && saveCount>0 && granted[0]==='replica_bzabag_helm');
assert.equal(provider.next(),null,'reward cannot recur');
const cosmetic = JSON.parse(fs.readFileSync('docs/config/cosmetics/clothes/hat/replica_bzabag_helm.json','utf8'));
const catalog = JSON.parse(fs.readFileSync('docs/config/cosmetics/index.json','utf8'));
assert(catalog.entries.some(entry=>entry.id===rules.HELM_ID));
assert(cosmetic.onlyExactSpeciesVariant && Object.keys(cosmetic.parts).length===0,'non-illustrated characters cannot render Mao-ao male art');
assert.deepEqual(Object.keys(cosmetic.speciesVariants),['mao-ao_male']);
for (const file of ["replica_bzabag's_helm-cap_m.png","replica_bzabag's_helm-faceguard_m.png"])
 assert(fs.existsSync('docs/assets/cosmetics/clothes/hat/'+file),'real helm PNG available: '+file);
const traderSource = fs.readFileSync('docs/js/slagothim-traders.js','utf8');
for(const spice of ['cloudSaffron','starpepper','nightCardamom']){
 assert(proto[spice]?.categories.includes('spice'),'imported seasoning registered for cooking');
 assert(traderSource.includes(spice),'imported seasoning sold by Slagothim caravans');
}
console.log('Gorkunash seeded contest, regional recipes, provenance, caps, prize and partial helmet art passed.');
