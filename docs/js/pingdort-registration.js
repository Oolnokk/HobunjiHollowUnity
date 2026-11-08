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
      base:{idle:SPRITES.perched,run1:SPRITES.flying,run2:SPRITES.flying},patterns:[],
      baseRecolorKeyHex:'#9dc09c',baseRecolorHueTolerance:24,baseRecolorMinSaturationRatio:.4,
      baseShadeReferenceHex:'#9dc09c'}; // Key the authored sage body only: never recolor white eyes, black ink or transparent pixels.
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
  const SOURCE_COAT_HEX='#9dc09c'; // Approximate native sage-green pigment used as the existing animal shade-fill's luminance anchor.
  function recoloredImages(images,hex){
    const shadeFill=window.CreatureGeneticsRender?.recolorPixels; // Reuse the exact body-color math used by CreatureGeneticsRender for Stable and Farm.
    const colorRgb=window.CreatureGeneticsRender?.hexToRgb?.(hex); // The selected genotype drives all three native flight-pose canvases.
    if(typeof document==='undefined'||typeof shadeFill!=='function'||!Array.isArray(colorRgb))return null;
    const out={}; // Allocated only at initial rig mount or when an existing genotype's base color changes.
    for(const [pose,image] of Object.entries(images)){
      const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height; // Canvas sources and decoded PNGs share this dimension contract.
      const canvas=document.createElement('canvas'); // Keep white eye pixels and black outlines on their original sprite, not in a tinted material.
      canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx||!width||!height)return null;
      ctx.drawImage(image,0,0,width,height);
      const frame=ctx.getImageData(0,0,width,height),rgba=frame.data; // Test the authored green source pixels before recolor alters them.
      const mask=new Uint8Array(rgba.length>>2); // Only pigments whose green channel exceeds red/blue; white eyes and black ink are excluded.
      for(let i=0;i<rgba.length;i+=4){
        const r=rgba[i],g=rgba[i+1],b=rgba[i+2];
        if(rgba[i+3]&&g>45&&g>r*1.08&&g>b*1.07)mask[i>>2]=1;
      }
      shadeFill(rgba,colorRgb,i=>mask[i>>2]===1,SOURCE_COAT_HEX,'pingdort-'+pose); // Existing shade-fill conserves highlights and shadow gradients.
      ctx.putImageData(frame,0,0);out[pose]=canvas;
    }
    return out;
  }
  async function createRig(genotype=null){
    const {settings,images}=await loadRig();
    const requested=genotype?.base?.color; // From wild actor genetics, saved Stable entry, or livestock-to-companion promotion.
    const initial=/^#[0-9a-f]{6}$/i.test(String(requested||''))?requested:null;
    let recolored=null; // A fallback to authored PNGs is safer than tinting the white eye when canvas compositing is unavailable.
    if(initial)try{recolored=recoloredImages(images,initial);}catch(error){debug.failures++;debug.lastError=String(error);}
    const instance=window.FlyingAnimalRig.create(settings,recolored||images); // Retains the real wing bones, original silhouettes, and native cleanup owner.
    let displayedColor=recolored?initial:null; // Tracks the exact color already baked into this rig's PNG textures, not a multiplied material tint.
    const poseMaterials=instance.bodyMaterials; // References the existing flying/perched/wings materials; gripping shares perched.
    instance.restoreTint=(nextHex=displayedColor)=>{
      let changed=false;
      for(const material of Object.values(poseMaterials||{})){
        if(material?.color?.getHexString?.().toLowerCase()!=='ffffff'){
          material.color.set('#ffffff');changed=true; // Native damage flashes may temporarily alter the material's multiply color.
        }
      }
      if(!/^#[0-9a-f]{6}$/i.test(String(nextHex||''))||nextHex.toLowerCase()===displayedColor?.toLowerCase())return changed;
      const png=window.HobunjiSpritePngSurface; // The same GPU texture creator and disposer used by FlyingAnimalRig.
      if(!png?.makeCanvasTexture||!poseMaterials)return changed;
      let next=null;
      try{next=recoloredImages(images,nextHex);}catch(error){debug.failures++;debug.lastError=String(error);return changed;}
      if(!next)return changed;
      const pending={}; // Produce every new texture first; if one fails, none of the live pose maps should be partially replaced.
      try{
        for(const pose of ['flying','perched','wings'])pending[pose]=png.makeCanvasTexture(window.THREE,next[pose],'pingdort-'+pose+'-'+nextHex);
      }catch(error){
        Object.values(pending).forEach(texture=>texture?.dispose?.());
        debug.failures++;debug.lastError=String(error);return changed;
      }
      for(const pose of ['flying','perched','wings']){
        const material=poseMaterials[pose],prior=material.map;
        material.map=pending[pose];material.needsUpdate=true;prior?.dispose?.(); // The shared grip mesh still reads perched.material.map.
      }
      displayedColor=nextHex;debug.tintAssignments++;debug.lastTint=nextHex;
      return true;
    };
    if(recolored){debug.tintAssignments++;debug.lastTint=initial;}
    return instance;
  }
  configureLivestock(); // Must run before game.js snapshots LIVESTOCK_ITEM_KINDS and resources.
  window.PingdortRegistration=Object.freeze({KIND,FERTILE_EGG,FARM_EGG,ZONES,SPRITES,register,configureLivestock,loadRig,createRig,
    debugSnapshot:()=>({...debug})});
})();
