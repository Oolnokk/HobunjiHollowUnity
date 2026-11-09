// Hachutu boss-vault weapons: persistent duplicate torch shapes with actual
// EnchantmentSystem states. Initialized through the existing Harlyao relic
// inventory dependency seam so this never guesses at game.js private globals.
(() => {
  'use strict';
  const SHAPES=Object.freeze(['hachutuTorchFlail','hachutuTorchStaff']); // Only shipped Hachutu torch weapons are eligible.
  let deps=null; // Inventory and save adapters injected when HarlyaoRelics initializes.
  let counter=0; // Prevents duplicate weapon keys when multiple boss chests open in one millisecond.
  const random=()=>window.GameRandom?.random?.()??Math.random();
  const gear=()=>deps?.getGearInventory?.()||null;
  function init(injected){deps=injected;return restore();}
  function register(key,shape){
    const source=deps?.TOOL_ITEM_DEFS?.[shape]; // Original torch rig/assembly is the single source of geometry and animation.
    if(!source)return false;
    if(!deps.TOOL_ITEM_DEFS[key])deps.TOOL_ITEM_DEFS[key]={
      ...source,itemKey:key,shapeKey:shape,label:'Enchanted '+String(source.label||shape),
      hachutuRelic:true,
    };
    deps.ensureToolTexture?.(key);
    return true;
  }
  function restore(){
    const inv=gear();if(!inv||!deps?.TOOL_ITEM_DEFS)return 0;
    if(!inv.hachutuRelics||typeof inv.hachutuRelics!=='object'||Array.isArray(inv.hachutuRelics))inv.hachutuRelics={};
    let count=0;
    for(const [key,record] of Object.entries(inv.hachutuRelics))
      if(SHAPES.includes(record?.shape)&&register(key,record.shape))count++;
    return count;
  }
  function grantBossWeapon(){
    const inv=gear(),es=window.EnchantmentSystem;
    if(!inv||!es?.DEFINITIONS||!deps?.TOOL_ITEM_DEFS)return [];
    const available=SHAPES.filter(key=>!!deps.TOOL_ITEM_DEFS[key]);
    const bases=Object.values(es.DEFINITIONS).filter(def=>def?.type==='Base'&&def?.id);
    if(!available.length||!bases.length)return [];
    const shape=available[Math.floor(random()*available.length)];
    const uid=Date.now().toString(36)+'_'+(++counter).toString(36);
    const key='hachutuRelic_'+shape+'_'+uid;
    const base=bases[Math.floor(random()*bases.length)].id;
    inv.hachutuRelics ||= {};
    inv.tools ||= {};
    inv.toolMastery ||= {};
    inv.hachutuRelics[key]={shape,uid,bound:false,source:'hachutu-temple-heart'};
    inv.tools[key]=true;
    inv.toolMastery[key]={xp:0};
    if(!register(key,shape)){
      delete inv.tools[key];delete inv.toolMastery[key];delete inv.hachutuRelics[key];
      return [];
    }
    es.stateFor?.(key,true);
    if(es.addBase?.(key,base)===false){
      delete inv.tools[key];delete inv.toolMastery[key];delete inv.hachutuRelics[key];delete deps.TOOL_ITEM_DEFS[key];
      return [];
    }
    deps.saveGearInventory?.();deps.saveMemberWorldData?.();
    deps.buildInventoryGrid?.();deps.buildEquipmentSlots?.();
    window.CombatLoadoutUI?.render?.();
    return ['🔥 Enchanted '+(deps.TOOL_ITEM_DEFS[shape].label||shape)];
  }
  window.HachutuRelics=Object.freeze({init,restore,grantBossWeapon,SHAPES});
})();