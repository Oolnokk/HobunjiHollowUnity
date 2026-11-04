'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Test the shipped fur-hood and world-mastery modules together.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const furSource = read('docs/js/fur-hood-leatherworking.js');
const masterySource = read('docs/js/crafting-mastery-system.js');
const manifest = JSON.parse(read('docs/config/patterns/fur-hoods.json'));

// These guards remain meaningful even if the overlay is refactored: the game
// must reject a locked species before AnimalHides.consume changes the pack.
assert.match(furSource, /craftButton\.disabled = !kind \|\| \(isLined\(\) \? [^:]+ : !hasSpeciesUnlock\(kind\)\)/, 'species trophy must still honor its mastery unlock while the new lined recipe bypasses it');
assert(furSource.indexOf('if (!lined && !hasSpeciesUnlock(current.furHood.kind))') > 0);
assert(furSource.indexOf('if (!lined && !hasSpeciesUnlock(current.furHood.kind))') < furSource.indexOf('AnimalHides.consume(choice.key'), 'runtime species gate must precede hide consumption');

function testWorld(masterFirst) {
  const storage = new Map([['hobunjiSaveMeta', JSON.stringify({worlds:[{id:'world-a'},{id:'world-b'}]})]]);
  const loadHandlers = []; // Simulates normal DOMContentLoaded registration after CraftingPanel loads.
  const overlays = []; // Captures the real fur-hood overlay to test disabled buttons and craft clicks.
  const createOverlay = () => {
    const select = {value:'0',options:[],appendChild(option){this.options.push(option);}};
    const kind = {value:'fur_hood'}; // This legacy trophy-specific test explicitly selects the mastery-gated recipe.
    const status = {textContent:''};
    const canvas = {width:1,height:1,getContext(){return {clearRect(){},drawImage(){},imageSmoothingEnabled:false};}};
    const controls = {
      '[data-field="hide"]':select, '[data-field="hood-kind"]':kind,
      '[data-field="dye"]':{value:'',appendChild(){}}, '[data-dye-row]':{hidden:false},
      '[data-field="status"]':status, '[data-view="preview"]':canvas,
      '[data-action="unlock"]':{hidden:false,disabled:false,textContent:''},
      '[data-action="craft"]':{disabled:false},
      '[data-action="close"]':{}, '[data-action="cloth"]':{}, '[data-action="view"]':{},
    };
    const overlay = {
      controls, isConnected:false, innerHTML:'',
      querySelector(selector){return controls[selector] || null;},
      appendChild(){},addEventListener(){},remove(){this.isConnected=false;},
    };
    overlays.push(overlay);
    return overlay;
  };
  const document = {
    readyState:'loading',
    currentScript:{src:'https://example.test/docs/js/fur-hood-leatherworking.js'},
    getElementById(){return null;},
    addEventListener(type, handler){if(type==='DOMContentLoaded')loadHandlers.push(handler);},
    createElement(type){return type==='div' ? createOverlay() : {value:'',textContent:'',style:{},appendChild(){}};},
    body:{appendChild(overlay){overlay.isConnected=true;}},
    head:{appendChild(){}},
  };
  const context = {
    console, document, URL,
    fetch:async()=>({ok:true,json:async()=>manifest}),
    localStorage:{
      getItem(key){return storage.get(key) || null;},
      setItem(key,value){storage.set(key,String(value));},
    },
    CustomEvent:function(type,options){this.type=type;this.detail=options?.detail;},
  };
  context.window = context;
  context.dispatchEvent = () => true;
  context.__farmLog = () => {};
  context.WorldPopupText = {queueReward(){}};
  context.CreatureGenetics = {SPECIES_ALIAS:{'gar-wolf-alpha':'gar-wolf'}};
  vm.createContext(context);
  if(masterFirst)vm.runInContext(masterySource,context,{filename:'crafting-mastery-system.js'});
  vm.runInContext(furSource,context,{filename:'fur-hood-leatherworking.js'});
  if(!masterFirst)vm.runInContext(masterySource,context,{filename:'crafting-mastery-system.js'});
  let worldId='world-a'; // Changes the authoritative world getter to test isolation/persistence.
  context.CraftingMasterySystem.setWorldIdGetter(()=>worldId);
  return {context,storage,loadHandlers,overlays,setWorld:value=>{worldId=value;}};
}

async function run(masterFirst) {
  const rig = testWorld(masterFirst);
  const {context,storage,loadHandlers,overlays} = rig;
  const fur = context.FurHoodLeatherworking;
  const mastery = context.CraftingMasterySystem;
  await fur.ensureManifest();
  for(const handler of loadHandlers)handler();
  assert.equal(fur.registerSpeciesUnlocks(),0,'repeat startup must not replace purchased nodes');
  assert.equal(fur.SPECIES_UNLOCK_COST,2);
  for(const kind of Object.keys(manifest.species)){
    const id=fur.speciesUnlockId(kind);
    assert.equal(mastery.node(id)?.cost,2,'each source species costs exactly two Motes: '+kind);
    assert.equal(mastery.node(id)?.tier,1,'species recipes must not require unrelated crafting perks');
    assert.equal(fur.hasSpeciesUnlock(kind),false,'recipes are locked in new saves: '+kind);
  }
  assert.equal(fur.speciesUnlockId('gar-wolf-alpha'),fur.speciesUnlockId('gar-wolf'),'alpha coat aliases use the same species node');
  assert.equal(fur.registerSpeciesUnlocks(['future-beast']),1,'new species with hide records can register without a new hardcoded list');
  assert.equal(mastery.node('furHoodSpecies:future-beast')?.cost,2);
  assert.equal(fur.registerSpeciesUnlocks(['??']),0,'invalid species keys never create a purchasable node');

  mastery.awardMotes(4,'test',{silent:true});
  assert.equal(mastery.purchaseRank(fur.speciesUnlockId('gar-wolf')),true);
  assert.equal(fur.hasSpeciesUnlock('gar-wolf'),true);
  assert.equal(fur.hasSpeciesUnlock('puktuk'),false,'another species is not unlocked for free');
  assert.equal(mastery.getState().motes,2,'first species consumes precisely two Motes');
  assert.equal(mastery.purchaseRank(fur.speciesUnlockId('puktuk')),true);
  assert.equal(mastery.getState().motes,0,'second species consumes another two Motes');
  assert.equal(fur.hasSpeciesUnlock('nelk'),false);
  rig.setWorld('world-b');
  assert.equal(fur.hasSpeciesUnlock('gar-wolf'),false,'unlock does not leak to another world');
  rig.setWorld('world-a');
  assert.equal(fur.hasSpeciesUnlock('gar-wolf'),true,'world switching restores saved rank');
  const worldA=JSON.parse(storage.get('hobunjiSaveMeta')).worlds[0];
  assert.equal(worldA.craftingMastery.ranks['furHoodSpecies:gar-wolf'],1,'species unlock persists in normal world metadata');

  // Exercise the real craft and unlock handlers without needing WebGL or the
  // full game: even a manually invoked disabled button must never spend a hide.
  rig.setWorld('world-b');
  const hide = {
    itemKey:'garWolfHide', kind:'gar-wolf', sourceKind:'gar-wolf-alpha', stars:3, sellPrice:20,
    genotype:{base:{color:'#997755'}}, appearance:{baseColor:'#997755',patterns:[]},
  }; // An exact eligible hide; its genotype is preserved in the resulting article.
  const inventory={garWolfHide:1};
  const pack=[];
  let consumption=0;
  context.AnimalHides={
    isHide:key=>key==='garWolfHide',
    groupsFor:()=>[{variant:'hide:one',count:1,stars:3,hideRecord:hide}],
    consume(){consumption++;return {ok:true,records:[hide]};},
  };
  context.ClothingWeavingSystem={renderClothingLayers:async()=>({canvas:{width:1,height:1}})};
  context.EquipmentPanel={buildPackClothingSection(){}};
  const deps={
    inventory, getPackClothing:()=>pack, saveMemberWorldData(){}, buildInventoryGrid(){},
    clampInventoryStack(){}, showToast(){},
  };
  assert.equal(fur.openLoom(deps),true);
  const overlay=overlays.at(-1);
  const craft=overlay.controls['[data-action="craft"]'];
  const unlock=overlay.controls['[data-action="unlock"]'];
  const select=overlay.controls['[data-field="hide"]'];
  const status=overlay.controls['[data-field="status"]'];
  assert.equal(craft.disabled,true,'locked hides cannot be crafted via the UI');
  await craft.onclick(); // A scripted call deliberately bypasses the HTML disabled attribute.
  assert.equal(consumption,0,'craft handler rejects bypasses before consuming the hide');
  assert.equal(inventory.garWolfHide,1);
  assert.match(status.textContent,/locked/i);
  mastery.awardMotes(2,'test',{silent:true});
  await select.onchange();
  assert.equal(unlock.disabled,false,'2 earned Motes enable this species purchase');
  unlock.onclick();
  assert.equal(fur.hasSpeciesUnlock('gar-wolf'),true);
  assert.equal(mastery.getState().motes,0);
  assert.equal(craft.disabled,false,'purchasing the recipe enables the craft action');
  await craft.onclick();
  assert.equal(consumption,1,'first valid craft consumes exactly one hide');
  assert.equal(inventory.garWolfHide,0);
  assert.equal(pack.length,1);
  assert.equal(pack[0].furHood.kind,'gar-wolf','craft keeps the purchased source species');
  assert.equal(pack[0].furHood.baseColor,'#997755','craft retains inherited coat color');
}

(async()=>{
  await run(true); // Mastery script already published when the fur module initializes.
  await run(false); // Real game order: fur module first, CraftingPanel/Mastery afterward.
  console.log('OK: species-specific fur-hood mastery registration, 2-Mote world purchases, locked UI, and craft guard');
})().catch(error=>{console.error(error);process.exitCode=1;});
