'use strict';
// Run: node scripts/test-skeeri-livestock.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname,'..'); // The tests load the shipped implementation, not copied logic.
const read = file => fs.readFileSync(path.join(root,file),'utf8'); // All source checks target real runtime files.
const store = new Map(); // Models the persistent per-world clutch storage.
const inventory = {}; // The same count-based bag shape used by FarmAnimals and PingdortFlocks.
const stats = {saves:0,genotypes:[],refreshes:0}; // Tracks successful transactions without assuming any UI DOM.
const W = {
  SCRATCHBONES_CONFIG:{game:{livestock:{itemKinds:{},resources:{},animalWidths:{},diet:{}},
    creatureGenetics:{palettes:{default:[{id:'brown',name:'Brown',hex:'#65403d',weight:1}]}}}},
  __hobunjiPlayerProfile:{worldId:'world-alpha'},
  InventoryStacks:{MAX_TOTAL:3},
  CreatureGeneticsRender:{SPECIES:{}},
  CreatureGenetics:{makeDefaultGenotype:()=>({base:{color:'#65403d'},sizeClass:'small'})},
  SkeeriRuins:{paletteFor:(theme,id)=>({body:theme==='tothal'?'#497a75':'#854e48',
    pattern:'#5f788d',eyes:'#2b98ff',identity:id})},
  FarmAnimals:{queueItemGenotype:(itemKey,genotype)=>stats.genotypes.push({itemKey,genotype})},
};
vm.runInNewContext(read('docs/js/skeeri-livestock-registration.js'),{
  window:W,console,localStorage:{
    getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),
  },
});
const api=W.SkeeriLivestockRegistration;
assert(api,'domestic registration must install before game.js');
assert.equal(W.SCRATCHBONES_CONFIG.game.livestock.itemKinds.fertileSkeeriEgg,'skeeri');
assert.equal(W.SCRATCHBONES_CONFIG.game.livestock.itemKinds.skeeriEgg,undefined,'ordinary eggs must never hatch');
assert.equal(W.SCRATCHBONES_CONFIG.game.livestock.resources.skeeri.itemKey,'skeeriEgg');
assert.equal(W.SCRATCHBONES_CONFIG.game.livestock.resources.skeeri.cooldownDays,2);
assert.equal(W.SCRATCHBONES_CONFIG.game.livestock.diet.skeeri,'predator');
assert.equal(W.SCRATCHBONES_CONFIG.game.creatureGenetics.palettes.skeeri.length,6);
const db={'gar-wolf':{label:'Gar-wolf'}},defs={},bagItems=[]; // Registration matches WildlifeSpawn's injected registries.
assert(api.register({CREATURE_DB:db,ITEM_DEFS:defs,inventoryItems:bagItems}));
assert.equal(db.skeeri.hostile,false);
assert.equal(db.skeeri.defaultSizeClass,'small');
assert.equal(db.skeeri.isFlyingSpecies,true);
assert.equal(defs.fertileSkeeriEgg.cat,'livestock');
assert.equal(defs.skeeriEgg.cat,'ingredient');
assert.equal(bagItems.length,2);
assert.equal(W.CreatureGeneticsRender.SPECIES.skeeri.base.idle,
 'assets/creaturesprites/skeeri_planebent_perched.png');
api.register({CREATURE_DB:db,ITEM_DEFS:defs,inventoryItems:bagItems});
assert.equal(bagItems.length,2,'repeated registration must not duplicate item catalog entries');
api.init({inventory,saveMemberWorldData:()=>stats.saves++,refreshItemScroll:()=>stats.refreshes++,
  buildInventoryGrid(){},refreshActionBar(){}});
const nest={seed:145,roomId:'wing-2',count:3,theme:'tothal'}; // The largest collectible brood.
assert.equal(api.remainingEggs(nest),3);
const first=api.collectNestEgg({...nest,identity:'egg-1'});
assert(first.ok);
assert.equal(first.remaining,2);
assert.equal(inventory.fertileSkeeriEgg,1);
assert.equal(stats.genotypes[0].itemKey,'fertileSkeeriEgg');
assert.equal(stats.genotypes[0].genotype.base.color,'#497a75','eggs retain source-tradition coat color');
assert.equal(stats.genotypes[0].genotype.skeeriEyes,'#2b98ff');
assert.equal(stats.genotypes[0].genotype.sizeClass,'small');
assert.equal(api.remainingEggs(nest),2);
assert(api.collectNestEgg({...nest,identity:'egg-2'}).ok);
assert(api.collectNestEgg({...nest,identity:'egg-3'}).ok);
assert.equal(api.remainingEggs(nest),0);
assert.equal(api.collectNestEgg(nest).ok,false,'exhaustion cannot duplicate eggs');
assert.equal(stats.saves,3);
assert.equal(stats.genotypes.length,3);
const nextNest={seed:145,roomId:'wing-3',count:2,theme:'hronal'};
assert.equal(api.collectNestEgg(nextNest).ok,false,'a full inventory must not consume a nest egg');
assert.equal(api.remainingEggs(nextNest),2);
inventory.fertileSkeeriEgg=0; // The existing farm/stable transfer consumes the egg stack.
assert(api.collectNestEgg(nextNest).ok);
assert.equal(api.remainingEggs(nextNest),1);
W.__hobunjiPlayerProfile.worldId='world-beta';
assert.equal(api.remainingEggs(nest),3,'clutch counts must not leak across different worlds');
W.__hobunjiPlayerProfile.worldId='world-alpha';
assert.equal(api.remainingEggs(nest),0,'returning to the first world must recover its exhausted clutch');
assert.equal(api.paletteForGenotype(stats.genotypes[0].genotype,'bird-1').body,'#497a75');
assert.equal(api.debugSnapshot().eggsCollected,4);
assert.equal(api.debugSnapshot().clutchesExhausted,1);

const actualGeneticsHost = {
  SCRATCHBONES_CONFIG:W.SCRATCHBONES_CONFIG,
  addEventListener() {},
  __farmLog() {},
  SkeeriLivestockRegistration:api, // Production crossOffspring delegates special eye/marking inheritance here.
}; // Isolated genuine genetics module, so size roles and breeding are checked behaviorally.
vm.runInNewContext(read('docs/js/creature-genetics.js'),{window:actualGeneticsHost,console});
actualGeneticsHost.CreatureGenetics.init({
  CREATURE_DB:db,
  clamp:(value,min,max)=>Math.max(min,Math.min(max,value)),
});
const genetic = actualGeneticsHost.CreatureGenetics; // The exact shipped farm/Stable role implementation.
const colors = new Set(W.SCRATCHBONES_CONFIG.game.creatureGenetics.palettes.skeeri.map(entry=>entry.hex));
for (const sizeClass of ['small','medium','large']) {
  const parentA = genetic.makeDefaultGenotype('skeeri');
  const parentB = genetic.makeDefaultGenotype('skeeri');
  assert(colors.has(parentA.base.color) && colors.has(parentB.base.color),
    'fresh Skeeri coats must use authored palette colors');
  parentA.sizeClass=sizeClass;
  parentB.sizeClass=sizeClass;
  const offspring = genetic.crossOffspring(parentA,parentB,'skeeri',0);
  assert.equal(offspring.sizeClass,sizeClass,'size must remain inherited when mutation chance is zero');
  assert(colors.has(offspring.base.color),'offspring must retain an allowed Skeeri coat');
  const role = sizeClass==='small'?'shoulderPet':'companion';
  assert.equal(genetic.stableEntryRole({kind:'skeeri',genotype:offspring}),role,
    'Stable must obey Pingdort size-to-role limits');
  assert.equal(genetic.creatureSizeTrait('skeeri',offspring).role,role,
    'on-screen traits must agree with actual Stable slot eligibility');
}

const sire=genetic.makeDefaultGenotype('skeeri');
const dam=genetic.makeDefaultGenotype('skeeri');
Object.assign(sire,{skeeriTradition:'hronal',skeeriPattern:'#967d55',skeeriEyes:'#ff8027'});
Object.assign(dam,{skeeriTradition:'tothal',skeeriPattern:'#5f788d',skeeriEyes:'#2b98ff'});
for(let n=0;n<25;n++){
  const chick=genetic.crossOffspring(sire,dam,'skeeri',0);
  const parent=[sire,dam].find(candidate=>candidate.skeeriTradition===chick.skeeriTradition);
  assert(parent,'a domesticated offspring must inherit one real parent tradition');
  assert.equal(chick.skeeriPattern,parent.skeeriPattern,'marking colors must follow the same parent');
  assert.equal(chick.skeeriEyes,parent.skeeriEyes,'glowing eyes must follow the same parent');
}
const geneticsSource=read('docs/js/creature-genetics.js');
assert(geneticsSource.includes('skeeri: []'),'normal livestock genotype inheritance is required');
assert(geneticsSource.includes("kind === 'skeeri'") && geneticsSource.includes("entry?.kind==='skeeri'"),
  'both trait and Stable role paths must forbid Large Skeeri mounts');
const farmSource=read('docs/js/farm-animals.js');
assert(farmSource.includes('skeeri: makeSkeeriAnimal'),'farm assignment and world-load factory must exist');
const nestSource=read('docs/js/ruin-hidden-secrets.js');
assert(nestSource.includes('SkeeriLivestockRegistration?.collectNestEgg'),
  'inspecting a ruin brood must grant a fertile egg, not only display text');
assert(nestSource.includes('eggsRemaining:rec.nest?.eggsRemaining'),
  'mobile diagnostics must expose per-brood egg counts');
const visuals=read('docs/js/tzatzul-live-visuals.js');
assert(visuals.includes("kind(actor) === 'skeeri' && actor?.isCompanion === true"),
  'trained domestic birds must receive their real authored flying rig');
const vocalizations=read('docs/js/animal-vocalizations.js');
assert(vocalizations.includes("raw === 'skeeri' || /^skeeri-(?:small|medium|large)$/.test(raw)"),
  'farm and Stable Skeeri must reuse the native planebent Skeeri vocalizations');
const html=read('docs/index.html');
assert(html.indexOf('js/skeeri-livestock-registration.js')>html.indexOf('js/pingdort-registration.js'));
assert(html.indexOf('js/skeeri-livestock-registration.js')<html.indexOf('js/creature-genetics.js'),
  'Skeeri palette and egg item mapping must be ready before genetics/game snapshots');
console.log('Skeeri inventory, nest persistence, genetics, Nursery/Stable and flying rig contracts: OK');
