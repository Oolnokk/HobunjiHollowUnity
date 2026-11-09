#!/usr/bin/env node
'use strict';
// Production-rule regression for keepsake rarity, live-animal release and the annual communal pyre.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=path=>fs.readFileSync(path,'utf8');
const W={SCRATCHBONES_CONFIG:{game:{livestock:{itemKinds:{puktukBaby:'puktuk',fertilePingdortEgg:'pingdort'}}}}};
const ctx=vm.createContext({window:W,console});
vm.runInContext(read('docs/js/festival-offering-ritual.js'),ctx);
const ritual=W.FestivalOfferingRitual;
const defs={
  ordinary:{label:'Ordinary Keepsake',sellPrice:0,tags:['Keepsake']},
  rare:{label:'Rare Relic',sellPrice:500,tags:['Artifact']},
  crafted:{label:'Family Broth',sellPrice:45,processingTier:3,foodEffects:{staminaRegen:1.5}},
  swift:{label:'Travel Boots',sellPrice:50,tags:['Travel']},
  puktukBaby:{label:'Puktuk Baby',sellPrice:90,tags:['Baby','Livestock']},
  fertilePingdortEgg:{label:'Fertile Pingdort Egg',sellPrice:85,tags:['Fertile','Egg','Livestock']},
  commonEgg:{label:'Ordinary Egg',sellPrice:3,tags:['Food','Egg']},
};
const rarities={
  ordinary:{kind:'unknown'},rare:{kind:'artifact'},crafted:{kind:'processed',foodRarity:2},
};
const engine={
  item:(key)=>rarities[key]||{kind:'unknown'},
  foodRarity:(key)=>({factor:key==='crafted'?2:1,known:key==='crafted'}),
  acquisitionSources:key=>key==='rare'?[{kind:'artifact',sourceId:'dungeonChest_tier4',probability:.002,
      expectedQuantity:.002,label:'Tier four Harlyao chest'}]:[],
  rarityFactor:(p,{reference,exponent,cap})=>Math.min(cap,Math.max(1,Math.pow(reference/p,exponent))),
};
const choose=(key,stars)=>ritual.assess(key,stars,defs,{rarity:engine,game:W.SCRATCHBONES_CONFIG.game});
assert.equal(choose('ordinary',5).level,3,'common five-star item must not earn an unmeasured rarity bonus');
assert.equal(choose('ordinary',5).stat,'goodwill','a sentimental gift determines the appropriate blessing');
const rareOne=choose('rare',1);
assert(rareOne.level>choose('ordinary',5).level,'an extremely difficult one-star item can outrank a common five-star gift');
assert.equal(rareOne.source,'artifact','festival uses the real tier-dependent chest source rather than assigning random scarcity');
assert(rareOne.scarcityFactor>1,'source odds must actually influence the final multiplier');
assert.equal(rareOne.level,5,'raw strength is bounded by the existing five-level blessing balance');
assert.equal(choose('crafted',2).stat,'vigor','real stamina input determines a food-based blessing');
assert(choose('crafted',2).effortFactor>1,'processing depth contributes multiplicatively, never as an arbitrary quality tier');
assert.equal(choose('swift',2).stat,'speed','travel equipment grants a movement-themed ancestor blessing');
assert.equal(choose('ordinary',3).scarcityFactor,1,'unquantified item sources remain neutral');
assert.equal(choose('ordinary',0),null,'quality zero is not a free offering');
assert.equal(choose('missing',5),null,'undefined physical items cannot generate ritual rewards');
assert.equal(choose('ordinary',6),null,'star quality outside the real 1–5 inventory buckets is rejected');
assert.equal(choose('puktukBaby',2).mode,'release','a living Puktuk is never burned');
assert.equal(choose('puktukBaby',2).species,'puktuk','the baby becomes a real creature of its registered species');
assert.equal(choose('fertilePingdortEgg',3).mode,'release','a hatchable Pingdort egg is saved, not incinerated');
assert.equal(choose('fertilePingdortEgg',3).stat,'goodwill','releasing a young creature is a goodwill ritual');
assert.equal(choose('commonEgg',3).mode,'burn','unfertilized cooking eggs are not released as animals');
assert.equal(ritual.releaseSpecies('unregisteredBaby',defs.puktukBaby,W.SCRATCHBONES_CONFIG.game),null,
  'an arbitrary item name cannot forge a species outside the official livestock catalog');
const fallback=ritual.assess('ordinary',4,defs,{game:W.SCRATCHBONES_CONFIG.game,rarity:null});
assert.equal(fallback.scarcityFactor,1,'the festival remains safe while the dependent rarity PR has not yet loaded');
const map=JSON.parse(read('docs/config/maps/hobunji_hollow_town.map.json'));
const tziz=map.layouts.find(l=>l.id==='festival_tzizkhanash');
const pyres=tziz.decor.filter(d=>d.festivalOfferingPyre);
assert.equal(pyres.length,1,'one visible shared communal pyre serves the offering locale');
assert.equal(pyres[0].key,'campfire','the pyre reuses the authored campfire fire and weather suppression');
assert.equal(pyres[0].festivalWeatherFire,true,'even the large festival fire extinguishes naturally in rain');
assert(pyres[0].postSY>=2 && pyres[0].postSX>2,'the communal pyre looks larger than path-side campfires');
assert(tziz.decor.some(d=>d.activity?.type==='offering'),'ordinary shrine interaction still offers the ritual');
const index=read('docs/index.html');
assert(index.includes('js/festival-offering-ritual.js?v='),'browser loads the shared ritual appraisal');
assert(index.indexOf('festival-offering-ritual.js')<index.indexOf('festival-system.js?v='),'appraisal loads before the festival controller');
const rules=read('docs/js/festival-system.js');
assert(rules.includes("registerActivity('offering'"),'the real once-per-year world activity is retained');
assert(rules.includes("pendingAnimalReleases()"),'donated juveniles remain in the saved festival queue until delivery');
const wildlife=read('docs/js/wildlife-spawn.js');
assert(wildlife.includes('deliverFestivalAnimalReleases(zoneId);'),'the live wilderness lifecycle delivers queued releases');
assert(wildlife.includes('genotype.sizeClass=\'small\''),'released creatures reuse the small-size genotype renderer');
const ui=read('docs/js/festival-ui.js');
assert(!ui.includes("action === 'select-stat'"),'arbitrary stat selection was retired in favor of item-determined buffs');
assert(ui.includes('preview.scarcityFactor.toFixed(2)'),'mobile offering inspector explains the actual source multiplier');
console.log('Tzizkhanash source-rarity offering, native-animal release, pyre and mobile preview tests passed.');
