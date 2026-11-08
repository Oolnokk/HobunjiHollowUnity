// Pingdort species, inherited egg items and authored flight-rig assets.
// The existing livestock/stable/companion pipeline remains authoritative.
(() => {
  'use strict';
  if(window.PingdortRegistration)return;
  const KIND='pingdort'; // Shared species id across wild flocks, livestock, stable and genetics.
  const FERTILE_EGG='fertilePingdortEgg'; // Hatchable eggs found in wild flock nests.
  const FARM_EGG='pingdortEgg'; // Unfertilized food eggs laid by housed Pingdorts.
  const ZONES=Object.freeze(['map_southern_cloud_forest','map_eastern_mire']); // The only native Pingdort habitats.
  const SPRITES=Object.freeze({
    flying:'assets/creaturesprites/pingdort_flying.png',
    perched:'assets/creaturesprites/pingdort_perched.png',
    wings:'assets/creaturesprites/pingdort_wings.png',
  }); // Authored PNGs also provide the native farm, nursery and companion fallback silhouette.
  const RIG_URL='config/creatures/pingdort-flying-rig.json'; // Authored shared two-bone flying rig with burden socket.
  const debug={registered:false,rigLoaded:false,failures:0,tintAssignments:0,lastTint:null,lastError:null}; // Mobile-readable registration, coat tint and asset diagnostics.
  let rigPromise=null; // One image/config decode shared by all wild and pet Pingdorts.

  function configureLivestock(){
    const game=window.SCRATCHBONES_CONFIG?.game;
    if(!game)return false;
    const livestock=game.livestock||(game.livestock={});
    (livestock.itemKinds||(livestock.itemKinds={}))[FERTILE_EGG]=KIND; // FarmAnimals converts eggs into saved livestock or Stable entries.
    (livestock.animalWidths||(livestock.animalWidths={}))[KIND]=.52; // Retains smaller-than-Drenkirra proportions in farm pens.
    (livestock.diet||(livestock.diet={}))[KIND]='predator';
    (livestock.resources||(livestock.resources={}))[KIND]={itemKey:FARM_EGG,cooldownDays:2}; // Housed adults lay collectable eggs through the existing farm day tick.
    return true;
  }
  function register(injected={}){
    const db=injected.CREATURE_DB,render=window.CreatureGeneticsRender?.SPECIES;
    if(!db)return false;
    const baseline=db['gar-wolf']||db.grehlr||{};
    const previous=db[KIND]||{};
    db[KIND]={...baseline,...previous,label:'Pingdort',hostile:false,diet:'carnivore',
      defaultSizeClass:'small',modelWidth:.48,spriteAspect:1000/1617,
      attackDamage:6,attackTag:'sharp',attackCooldownS:2.4,
      attackRangePx:(Number(injected.TILE)||64)*3.5,
      isFlyingSpecies:true,attacks:['pingdortBoulderBomb'],
      sprites:{idle:SPRITES.perched,run:[SPRITES.flying,SPRITES.flying]}};
    // Wild flocks override their own attack dispatch; personal companions use this special.
    if(render)render[KIND]={...(render[KIND]||{}),prefix:KIND,
      base:{idle:SPRITES.perched,run1:SPRITES.flying,run2:SPRITES.flying},patterns:[],fullBaseRecolor:true}; // Farm, nursery and Stable portraits use the same inherited base-coat color.
    const items=injected.ITEM_DEFS;
    if(items){
      items[FERTILE_EGG]={...(items[FERTILE_EGG]||{}),label:'Fertile Pingdort Egg',
        icon:'🥚',cat:'livestock',sellPrice:42,tags:['Livestock','Egg','Fertile','Pingdort'],
        desc:'A hatchable Pingdort egg from a Cloud Forest or Eastern Mire flock. Raise it as livestock or keep it in your personal Stable.'};
      items[FARM_EGG]={...(items[FARM_EGG]||{}),label:'Pingdort Egg',
        icon:'🥚',cat:'ingredient',sellPrice:8,tags:['Egg','Pingdort','Unfertilized'],
        desc:'An ordinary edible egg laid by a housed Pingdort. Cannot hatch.'};
    }
    const inventoryItems=injected.inventoryItems; // Inventory item wheel recognizes both egg kinds even with older item-index saves.
    if(Array.isArray(inventoryItems))for(const key of [FERTILE_EGG,FARM_EGG])
      if(!inventoryItems.some(item=>item?.key===key))inventoryItems.push({
        key,icon:'🥚',label:key===FERTILE_EGG?'FERTILE PINGDORT EGG':'PINGDORT EGG',max:99,
      });
    debug.registered=true;
    return configureLivestock();
  }
  function loadImage(url){
    return new Promise((resolve,reject)=>{
      const img=new Image(); // Shared decoded authored PNG with no generated placeholder art.
      img.crossOrigin='anonymous';
      img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Missing Pingdort image: '+url));
      img.src=url;
    });
  }
  async function loadRig(){
    if(!rigPromise)rigPromise=Promise.all([
      fetch(RIG_URL).then(r=>{if(!r.ok)throw new Error('Pingdort rig HTTP '+r.status);return r.json();}),
      ...Object.values(SPRITES).map(loadImage),
    ]).then(([raw,flying,perched,wings])=>{
      debug.rigLoaded=true;
      return {settings:window.FlyingAnimalRig.normalize(raw),images:{flying,perched,wings}};
    }).catch(error=>{rigPromise=null;debug.failures++;debug.lastError=String(error);throw error;});
    return rigPromise;
  }
  async function createRig(genotype=null){
    const {settings,images}=await loadRig();
    const instance=window.FlyingAnimalRig.create(settings,images); // The usual authored PNGs retain their wing rig, geometry and dispose owner.
    const sourceHex=genotype?.base?.color; // Wild, saved farm and Stable genotypes all use this same inherited base coat.
    if(/^#[0-9a-f]{6}$/i.test(String(sourceHex||''))){
      const tintMaterials=new Set(); // Collect the existing body/wing material owners once; exclude optional eye overlays.
      instance.root.traverse(node=>{
        if(node.isMesh&&!node.userData?.flyingAnimalEyeOverlay&&node.material?.color)tintMaterials.add(node.material);
      });
      instance.restoreTint=(nextHex=sourceHex)=>{
        const color=String(nextHex||''); // Allow a newly bred/edited live genotype to refresh without rebuilding textures.
        if(!/^#[0-9a-f]{6}$/i.test(color))return false;
        let changed=false;
        for(const material of tintMaterials){
          if(material.color.getHexString?.().toLowerCase()===color.slice(1).toLowerCase())continue;
          material.color.set(color);
          changed=true;
        }
        if(changed){debug.tintAssignments++;debug.lastTint=color;}
        return changed;
      };
      instance.restoreTint(); // The shared live-visual tick also repairs lost tint after hit flashes.
    }
    return instance;
  }
  configureLivestock(); // Must run before game.js snapshots LIVESTOCK_ITEM_KINDS and resources.
  window.PingdortRegistration=Object.freeze({KIND,FERTILE_EGG,FARM_EGG,ZONES,SPRITES,register,configureLivestock,loadRig,createRig,
    debugSnapshot:()=>({...debug})});
})();
