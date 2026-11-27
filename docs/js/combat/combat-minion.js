// Minion humanoid enemy class.
//
// Minions share BanditCombat's humanoid combat/render/death executor, but
// deliberately own roster, clothing, dye, and permanent-affliction rules so
// bandit headwear guarantees and loadout substitutions cannot leak in.
(() => {
  'use strict';

  const CLASS_ID = 'minion'; // Semantic enemyClass written onto every Minion entity.
  const DEFAULT_WEAPON_SHAPES = Object.freeze(['daggerSword', 'fishingspear', 'hatchet', 'harlyaoLongsword', 'harlyaoBroadsword', 'warhammer']); // Default Harlyao Skeleton Minion melee pool.
  const OVERWEAR_OPTIONS = Object.freeze([null, 'tankan_bodywrap', 'rugged_poncho']); // Equal-choice upper-body pool; pants are supplied by the shared hostile avatar builder.
  const BANDOLIER_CHANCE = 0.5; // Independent torso roll creates six common silhouettes with the three overwear states.
  const HARLYAO_ARMOR_METAL_KEYS = Object.freeze(['nativeCopper', 'lowTinBronze', 'tinBronze', 'highTinBronze', 'arsenicalBronze', 'leadedBronze']); // Ordered smith alloys used to map Town Value onto skeleton armor quality.
  const SHAMBLING_FOOTING_FRACTION = 0.70; // Permanent Footing reservation applied after ResourceSystem initializes the entity; only the remaining 30% is ordinarily usable.
  const DYE_WEIGHTS = Object.freeze({ // Mostly low-saturation warm peasant/workwear hues with a smaller neutral tail.
    'dye:CLOTH:muted_red_orange': 4,
    'dye:CLOTH:dusty_red_orange': 4,
    'dye:CLOTH:dark_muted_red_orange': 3,
    'dye:CLOTH:muted_orange': 5,
    'dye:CLOTH:dusty_orange': 5,
    'dye:CLOTH:dark_muted_orange': 4,
    'dye:CLOTH:muted_yellow_orange': 4,
    'dye:CLOTH:dusty_yellow_orange': 4,
    'dye:CLOTH:dark_muted_yellow_orange': 3,
    'dye:CLOTH:muted_yellow': 3,
    'dye:CLOTH:dusty_yellow': 3,
    'dye:CLOTH:dark_muted_yellow': 2,
    'dye:CLOTH:brown': 2,
    'dye:CLOTH:charcoal': 1.5,
    'dye:CLOTH:silver': 1.5,
  });

  const rng = () => window.GameRandom?.random?.() ?? Math.random(); // Gameplay RNG when available keeps spawn sequences deterministic-capable.

  function weightedPick(weights = DYE_WEIGHTS) {
    const entries = Object.entries(weights).filter(([, weight]) => Number(weight) > 0); // Eligible palette entries.
    const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0); // Total used to map one RNG sample into the weighted palette.
    let roll = rng() * total; // Remaining weighted distance consumed in declaration order.
    for (const [id, weight] of entries) {
      roll -= Number(weight);
      if (roll <= 0) return id;
    }
    return entries[entries.length - 1]?.[0] || null;
  }

  function harlyaoArmorMetalKey() {
    const townValue = Math.max(0, Math.floor(Number(window.TownMine?.getTownValue?.()) || 0)); // Current town progression selects the strongest skeleton armor alloy available.
    const eligible = window.TownMine?.filterMetalKeysForTownValue?.(HARLYAO_ARMOR_METAL_KEYS, townValue); // Reuses the canonical Town Value metal ceiling used by treasure and other progression systems.
    return Array.isArray(eligible) && eligible.length ? eligible[eligible.length - 1] : HARLYAO_ARMOR_METAL_KEYS[0];
  }

  function rollRoster(speciesId, name = 'Minion', options = {}) {
    const genders = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species?.[speciesId]?.genders; // Species bridge registers the authored genders (Mao'ao Skeleton is male-only).
    const gender = options.gender || (Array.isArray(genders) && genders.length === 1 ? genders[0] : (rng() < 0.5 ? 'male' : 'female')); // Ghost marchers retain their authored male body while sharing skeleton equipment.
    const equippedCosmetics = []; // Explicit list bypasses BanditCombat's hood/facewrap/headband guarantee.
    const cosmeticSlots = {}; // Needed by portrait rendering, loot conversion, and outfit-weight profiling.
    const appliedDyes = {}; // Tint-slot keyed map consumed by NpcAvatarPreview.
    const overwear = OVERWEAR_OPTIONS[Math.floor(rng() * OVERWEAR_OPTIONS.length)] || null; // None/bodywrap/poncho are equally common.
    if (overwear) {
      equippedCosmetics.push(overwear);
      cosmeticSlots[overwear] = 'overwear';
      appliedDyes.CLOTH = weightedPick();
    }
    if (rng() < BANDOLIER_CHANCE) {
      equippedCosmetics.push('bandolier1');
      cosmeticSlots.bandolier1 = 'torso';
      appliedDyes.TORSO = weightedPick();
    }
    const metalArmorItems = []; // These same maximum-temper records feed the portrait and corpse loot.
    if ((options.equipmentSpeciesId || speciesId) === 'harlyao-skeleton') {
      const metalKey = harlyaoArmorMetalKey(); // Both articles share the town-scaled alloy so a skeleton's armor reads as one coherent set.
      for (const id of ['rounded_pauldron', 'tangedcirclet']) {
        const item = window.MetalArmorSystem?.makeCraftedItem?.(id, metalKey); // Shared smith article factory supplies weight and alloy metadata.
        if (!item) throw new Error('MetalArmorSystem must load before skeleton equipment is generated.');
        item.temperXp = window.MetalArmorSystem.MAX_TEMPER_XP;
        item.sprite = window.MetalArmorSystem.spriteForBlueprintAppearance(id, { speciesId, gender });
        metalArmorItems.push(item);
        equippedCosmetics.push(id);
        cosmeticSlots[id] = item.slot;
      }
    }
    return { name, appearance: { speciesId, gender, cosmetics: {} }, equippedCosmetics, appliedDyes, cosmeticSlots, metalArmorItems };
  }

  const RUIN_AREA='map_i_dev_random_ruin'; // Scope to dungeon skeletons only.
  const RUIN_HEALTH=Object.freeze({minion:1.5,wallCoffin:3}); // Spawn-time health multipliers.
  const COFFIN_SHAPES=Object.freeze({harlyaoLongsword:'longsword',harlyaoBroadsword:'broadsword',warhammer:'warhammer'}); // Held-to-bound shape mapping.
  const COFFIN_BASES=['burning','frostbitten','mirrored','livingFlame','stormwake','stonebind','soulweight','ancestralSight']; // NPC-supported Base magic.
  const debug={portraits:0,spikes:0,fire:0,plasm:0,coffins:0,lastError:null}; // Mobile diagnostic counters.
  let oilPromise; // Shared decoded oil art.
  function report(error){debug.lastError=String(error?.message||error);window.__farmLog?.('[ruin skeleton] '+debug.lastError,'warn','combat');}
  function loadOil(){
    if(!oilPromise)oilPromise=new Promise((resolve,reject)=>{
      const image=new Image(); // Authored plasm texture.
      image.crossOrigin='anonymous';image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Oil image failed'));
      image.src='./assets/textures/dark_oil.png.png';
    }).catch(error=>{oilPromise=null;throw error;});
    return oilPromise;
  }
  function noise(x,y,seed){
    let h=Math.imul(x+1,374761393)^Math.imul(y+1,668265263)^seed; // Deterministic portrait grain.
    h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;
  }
  function coarseRuinTexture(w,h,seed){
    const cell=Math.max(4,Math.round(Math.min(w,h)/14)),cols=Math.ceil(w/cell)+1,rows=Math.ceil(h/cell)+1; // Low-frequency texture samples, computed once per baked canvas.
    const grid=new Float32Array(cols*rows);
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)grid[y*cols+x]=noise(x,y,seed);
    return (x,y)=>{
      const gx=x/cell,gy=y/cell,ix=Math.floor(gx),iy=Math.floor(gy);let u=gx-ix,v=gy-iy;
      u=u*u*(3-2*u);v=v*v*(3-2*v); // Smooth patches instead of a visible square grid or fine-grained speckling.
      const i=iy*cols+ix,a=grid[i]*(1-u)+grid[i+1]*u,b=grid[i+cols]*(1-u)+grid[i+cols+1]*u;
      return a*(1-v)+b*v;
    };
  }
  function ruinInkMask(data,w,h){
    const ink=new Uint8Array(w*h); // Protect only actual black/near-black source texels, not their neighboring colored pixels.
    for(let p=0;p<ink.length;p++){
      const i=p*4;
      if(data[i+3]&&Math.max(data[i],data[i+1],data[i+2])<=32)ink[p]=1;
    }
    return ink;
  }
  function paintRuinPixels(roster,data,w,h,overlay=null,sharedMask=null){
    const theme=roster.ruinSkeletonTheme,seed=roster.ruinSkeletonSeed; // The same immutable source mask protects portraits and pants.
    const ink=ruinInkMask(data,w,h),coarse=theme==='kanthic'?null:coarseRuinTexture(w,h,seed);
    let mask=null,outline=null;
    if(theme==='kanthic'){
      if(!overlay)throw new Error('Oil texture unavailable');
      const eligible=new Uint8Array(w*h);
      for(let p=0;p<eligible.length;p++)eligible[p]=data[p*4+3]?1:0; // Let a patch cross original ink; final compositing gives authored ink priority.
      const metal=window.ToolMetalRecolor;
      mask=sharedMask?new Uint8Array(sharedMask):metal?.buildOxidationMask?.(eligible,w,h,.45,{seed,blotchCount:6,separateBlotches:true,looseBlotches:true});
      if(!mask||!metal?.buildOxidationOutlineMask)throw new Error('Verdigris mask/outline unavailable');
      for(let p=0;p<mask.length;p++)if(!eligible[p])mask[p]=0;
      outline=metal.buildOxidationOutlineMask(mask,eligible,w,h,3); // Actual verdigris outward ink boundary, not an imitation.
    }
    for(let p=0;p<w*h;p++){
      const i=p*4;
      if(!data[i+3]||ink[p])continue; // Original ink wins, including semitransparent black; no unpainted halo.
      if(theme==='kanthic'){
        if(outline[p]){data[i]=data[i+1]=data[i+2]=0;continue;} // Exact authored-style black; preserve original alpha.
        if(!mask[p])continue;
        const a=overlay[i+3]/255;
        for(let c=0;c<3;c++)data[i+c]=data[i+c]*(1-a)+overlay[i+c]*a;
      }else{
        const x=p%w,y=Math.floor(p/w),broad=coarse(x,y); // Smooth broad patches, no per-pixel grain.
        if(theme==='hronal'){
          const gray=(data[i]*.25+data[i+1]*.6+data[i+2]*.15)*(.22+broad*.14); // Charcoal is a 70% opacity layer over original color.
          data[i]=data[i]*.3+Math.min(data[i],gray)*.7;data[i+1]=data[i+1]*.3+Math.min(data[i+1],gray*.85)*.7;data[i+2]=data[i+2]*.3+Math.min(data[i+2],gray*.75)*.7;
        }else if(theme==='tothal'){
          const sheen=.29+.26*broad; // Coarse frost sheen, without pixel noise.
          data[i]=data[i]*(1-sheen)+183*sheen;data[i+1]=data[i+1]*(1-sheen)+224*sheen;data[i+2]=data[i+2]*(1-sheen)+249*sheen;
        }
      }
    }
    return mask;
  }
  async function paintRuinPortraits(roster,canvases){
    const theme=roster.ruinSkeletonTheme;
    if(!theme)return;
    try{
      const oil=theme==='kanthic'?await loadOil():null;
      let frontMask=null,overlay=null,overlayW=0,overlayH=0; // Reuse scaled oil pixels across the same-sized views.
      for(let view=0;view<canvases.length;view++){
        const canvas=canvases[view],w=canvas.width,h=canvas.height,ctx=canvas.getContext('2d');
        const pixels=ctx.getImageData(0,0,w,h);
        if(oil&&(!overlay||w!==overlayW||h!==overlayH)){
          const hidden=document.createElement('canvas');hidden.width=w;hidden.height=h;
          const hc=hidden.getContext('2d');hc.drawImage(oil,0,0,w,h);overlay=hc.getImageData(0,0,w,h).data;overlayW=w;overlayH=h;
        }
        const mask=paintRuinPixels(roster,pixels.data,w,h,overlay,view>0&&view<3?frontMask:null);
        if(view===0)frontMask=mask;
        ctx.putImageData(pixels,0,0);debug.portraits++;
      }
    }catch(error){report(error);}
  }
  async function paintRuinPants(roster,source){
    if(!source||!['hronal','tothal','kanthic'].includes(roster.ruinSkeletonTheme))return source;
    const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height; // The shared clothing cache must never receive hostile-specific pixels.
    canvas.getContext('2d').drawImage(source,0,0);
    await paintRuinPortraits(roster,[canvas]);return canvas;
  }
  function ruinTorsoFootprint(canvas,headCanvas,width,height,flipped=false){
    const w=canvas?.width,h=canvas?.height;
    if(!(w>0&&h>0&&width>0&&height>0&&headCanvas?.width===w&&headCanvas?.height===h))return null;
    const rgba=canvas.getContext('2d').getImageData(0,0,w,h).data,head=headCanvas.getContext('2d').getImageData(0,0,w,h).data;
    const pixels=[];let left=w,right=-1,top=h,bottom=-1;
    // All visible rear pixels are eligible except the actual rear-facing head sprite (not a neck-height rectangle).
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      if(rgba[i+3]<128||head[i+3]>12)continue;
      const px=flipped?x:w-1-x; // Rear canvas is mirrored once by the actual rear texture, unless global portrait flip reverses it.
      pixels.push({x:px,y});left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,y);bottom=Math.max(bottom,y);
    }
    if(!pixels.length)return null;
    const x0=(left/w-.5)*width,x1=((right+1)/w-.5)*width,y0=(.5-(bottom+1)/h)*height,y1=(.5-top/h)*height;
    const footprint={x:(x0+x1)/2,y:(y0+y1)/2,width:x1-x0,height:y1-y0,top:y1,bottom:y0,pixels:pixels.length};
    Object.defineProperty(footprint,'project',{value:(x,z)=>{
      const px=(.5+(x+footprint.x)/width)*w-.5,py=(.5-(footprint.y-z)/height)*h-.5;
      let best=Infinity,chosen=pixels[0];
      for(const pixel of pixels){
        const distance=((pixel.x-px)/w*width)**2+((pixel.y-py)/h*height)**2;
        if(distance<best){best=distance;chosen=pixel;}
        if(best===0)break;
      }
      return {x:((chosen.x+.5)/w-.5)*width-footprint.x,z:footprint.y-(.5-(chosen.y+.5)/h)*height};
    }});
    return footprint;
  }
  function seatRuinSpikeGeometry(geometry,footprint,width,height,sample){
    const anchors=geometry.userData?.iceGrowthAnchors,positions=geometry.attributes?.position;
    if(!sample||!positions||anchors?.length!==positions.count*3)return 0;
    const shifts=new Map();let seated=0; // One sample per crystal, not per vertex, using the rear mesh's real skin deformation.
    for(let i=0;i<positions.count;i++){
      const k=i*3,x=anchors[k],z=anchors[k+2],key=x+','+z;
      let shift=shifts.get(key);
      if(!shift){
        const localX=footprint.x+x,localY=footprint.y-z;
        const point=sample(.5+localX/width,.5-localY/height);
        if(point)seated++;
        shift=point?{x:point.x-localX,y:point.y-localY,z:point.z}:{x:0,y:0,z:0};
        shifts.set(key,shift);
      }
      // Generator local +Y maps to rear +Z; local +Z maps to rear -Y.
      positions.setXYZ(i,positions.getX(i)+shift.x,positions.getY(i)+shift.z,positions.getZ(i)-shift.y);
      anchors[k]+=shift.x;anchors[k+1]+=shift.z;anchors[k+2]-=shift.y;
    }
    positions.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();
    if(geometry.userData.iceFullPositions)geometry.userData.iceFullPositions.set(positions.array);
    return seated;
  }
  function attachRuinBackSpikes(THREE,avatar,roster){
    const carrier=avatar.backPortraitMesh||avatar.backPlane,width=avatar.modelWidth,height=avatar.modelHeight;
    const theme=roster.ruinSkeletonTheme;
    if(!carrier||(theme!=='hronal'&&theme!=='tothal'))return;
    const build=window.IceStalagmiteCoverage?.build;
    if(!build){report('Stalagmite generator unavailable');return;}
    let footprint;
    try{footprint=ruinTorsoFootprint(avatar.backCanvas,avatar.ruinRearHeadCanvas,width,height,window.PNGPlaneAvatar?.getPortraitsFlipped?.()===true);}catch(error){report(error);return;}
    if(!footprint){report('No visible non-head rear pixels');return;}
    const radius=width*.085,maxSpikeHeight=width*.56,minSpikeHeight=width*.28; // Clearly visible furniture-style growth, independent of the narrowness of the body's mask.
    const source=new THREE.Group(),geometry=new THREE.BoxGeometry(footprint.width,.02,Math.max(.005,footprint.height)),material=new THREE.MeshBasicMaterial({visible:false});
    const support=new THREE.Mesh(geometry,material);support.userData.authoredPartId='ruin-skeleton-back';source.add(support);
    try{
      const stone=theme==='hronal';
      const layer=build(THREE,source,{kind:stone?'stoneStalagmites':'iceStalagmites',target:'selected',targetIds:['ruin-skeleton-back'],
        seed:roster.ruinSkeletonSeed,count:5,density:1,iceCluster:3,radius,iceHeightMin:minSpikeHeight,iceHeightMax:maxSpikeHeight,
        iceRoughness:.35,iceOpacity:stone?1:.92,color:stone?'#514942':'#c2e8fb',iceEngulf:1,iceFootprintPadding:0,iceFacets:5,iceTipSharpness:.9,iceLean:.1,mapSpikeOrigin:footprint.project});
      if(!layer?.children?.length)throw new Error('Back stalagmite generator returned no geometry');
      layer.name='ruin-skeleton-back-stalagmites';layer.rotation.x=Math.PI/2;
      layer.position.set(footprint.x,footprint.y,.007); // Base vertices at -.015 sit .008 inside the actual back surface.
      const sample=window.PNGPlaneAvatar?.makePortraitSurfaceSampler?.(carrier); // Static torso hunch is already applied when the avatar is adopted.
      const owned=[];let seated=0;
      layer.traverse(node=>{if(!node.isMesh)return;delete node.userData.bladedHazard;
        seated+=seatRuinSpikeGeometry(node.geometry,footprint,width,height,sample);
        if(stone&&window.FacetedRocks?.surfaceStone){
          const oldGeometry=node.geometry,oldMaterial=node.material;
          window.FacetedRocks.surfaceStone(node,{tint:'#514942',label:layer.name});
          if(node.geometry!==oldGeometry)oldGeometry.dispose();
          if(node.material!==oldMaterial)oldMaterial.dispose();
          delete node.userData.shellOutline;node.layers.disable(1);
          owned.push({geometry:node.geometry,material:node.material===oldMaterial?oldMaterial:null});
        }else owned.push({geometry:node.geometry,material:node.material});
      });
      carrier.add(layer);debug.spikes++;
      avatar.ruinBackSpikeInfo={theme,carrier:carrier.name||'rear portrait',footprint:{...footprint},radius,minSpikeHeight,maxSpikeHeight,seated}; // Actual surface and seated crystal count for the viewer.
      let disposed=false;
      return ()=>{if(disposed)return;disposed=true;layer.parent?.remove(layer);avatar.ruinBackSpikeInfo=null;for(const entry of owned){entry.geometry.dispose();entry.material?.dispose();}};
    }catch(error){report(error);}finally{geometry.dispose();material.dispose();}
  }
  function trailMovement(c,x0,y0,x1,y1,mode,tile){
    const theme=c?.ruinSkeletonTheme; // No trail work on ordinary enemies.
    if(theme!=='kanthic'&&!(theme==='hronal'&&mode==='lunge'))return;
    if(!(c.health>0)||!(tile>0)||c.prone||c.tzatzulCapturedBy||(c.areaId&&c.areaId!==RUIN_AREA)||!Number.isFinite(x0)||!Number.isFinite(y0)||!Number.isFinite(x1)||!Number.isFinite(y1)||window.DevRandomRuinLichThemes?.activeTheme?.()!==theme)return;
    const distance=Math.hypot(x1-x0,y1-y0)/tile; // Swept movement in tiles.
    if(distance<.0001)return;
    const height=c.surfaceYOverride?.()??c.shaftSupportY??c.physicalFeetY??c.surfaceY??(c.avatarRef?.group?.position?.y-(c.halfHeight||0)); // Actual actor story.
    if(!Number.isFinite(height))return;
    const spacing=theme==='hronal'?.75:.45; // Distance-based cadence.
    let remaining=Number.isFinite(c._ruinTrailRemaining)?c._ruinTrailRemaining:0,count=0;
    while(remaining<=distance&&count++<8){
      const t=remaining/distance,x=(x0+(x1-x0)*t)/tile,z=(y0+(y1-y0)*t)/tile;remaining+=spacing;
      const tx=Math.floor(x),tz=Math.floor(z);
      const support=window.DynamicSurfaces?.sampleSupport?.(theme==='kanthic'?tx+.5:x,theme==='kanthic'?tz+.5:z,{minY:height-1.2,maxY:height+.35,pad:.02});
      const floor=support?.y;if(!Number.isFinite(floor))continue;
      if(theme==='hronal'){
        if(window.PersistentGroundFire?.ignite?.({area:RUIN_AREA,x,z,y:floor,radius:.72,seconds:4,source:'ruin-skeleton-lunge'}))debug.fire++;
      }else{
        const key=tx+','+tz+','+Math.round(floor*10); // Chance only once per visited tile.
        if(c._ruinDripTile===key)continue;c._ruinDripTile=key;
        if(rng()<.35&&window.DevRandomRuinLichThemes?.createSkeletonPlasmTile?.(tx,tz,floor))debug.plasm++;
      }
    }
    c._ruinTrailRemaining=Math.max(0,remaining-distance); // Very long frames are deliberately capped, not caught up with a flood next frame.
  }
  function emitRuinEnchantedHit(c,target,actualDamage,slotId){
    if(!c?.ruinWallCoffin||!target||!(actualDamage>0)||!c.rosterRecord?.enchantedWeapon)return;
    window.CombatAttackEvents?.hit?.(null,{attacker:c,target,weaponKey:c.def.weaponKey,slotId,attackCategory:slotId==='tap1'?'combo':slotId==='tap2'?'quickAttack':slotId==='hold2'?'defensiveHold':'offensiveHold',actualDamage});
  }

  async function makeEntity(options = {}) {
    const combat = window.BanditCombat; // Shared humanoid combat implementation beneath the distinct Minion category.
    const resources = window.ResourceSystem; // Owns immutable Shambling Footing and effective Footing.
    if (!combat?.makeEntity || !resources?.setImmutableAffliction) return null;
    const baseConfig = options.baseConfig || await combat.loadGangConfig?.(); // Reuses generic rank/stat tuning but not bandit roster generation.
    if (!baseConfig) return null;

    const speciesId = options.speciesId || 'harlyao-skeleton'; // Caller override keeps Minion reusable for future species.
    const name = options.name || 'Minion'; // Display/roster name.
    const tier = Math.max(0, Math.round(Number(options.tier) || 0)); // Existing humanoid difficulty tier.
    const weaponShapes = Array.isArray(options.weaponShapePool) && options.weaponShapePool.length ? options.weaponShapePool : DEFAULT_WEAPON_SHAPES; // Validated again by BanditCombat.
    const preview=speciesId==='harlyao-skeleton'&&options.zoneId==='map_dev_arena'&&options.previewRuinTheme; // Workshop's isolated arena is the only explicit theme override.
    const candidate=preview|| (speciesId==='harlyao-skeleton'&&options.zoneId===RUIN_AREA?(window.DevRandomRuin?.getRuntimeContext?.()?.theme||window.DevRandomRuinLichThemes?.activeTheme?.()):null);
    const theme=['hronal','tothal','kanthic'].includes(candidate)?candidate:null;
    const wallCoffin=!!theme&&(options.extra?.wallCoffin!=null||!!preview&&options.previewRuinWallCoffin===true); // Includes index zero.
    let roster=options.roster||rollRoster(speciesId,name);
    if(theme){
      roster={...roster,ruinSkeletonTheme:theme,ruinSkeletonSeed:roster.ruinSkeletonSeed??Math.floor(rng()*2147483647)};
      if(wallCoffin&&!(options.preserveRoster&&roster.enchantedWeapon))roster.enchantedWeapon=window.GhoulSpecialVariants?.rollEnchantedWeapon?.(rng,{singleBase:true,baseIds:COFFIN_BASES});
    } // Separation point: bandit clothing generation never runs. A supplied roster re-creates a specific skeleton (a lich raising its fallen).
    const entity = await combat.makeEntity({
      ...baseConfig,
      speciesWeights: { [speciesId]: 1 },
      weaponShapePool: wallCoffin?Object.keys(COFFIN_SHAPES):[...weaponShapes],
      weaponMetalKey: options.weaponMetalKey || 'nativeCopper',
      rangedWeaponChanceByRank: { grunt: 0, lieutenant: 0, captain: 0 },
    }, 'grunt', tier, Number(options.x) || 0, Number(options.y) || 0, {
      zoneId: options.zoneId,
      scene: options.scene,
      grid: options.grid,
      cols: options.cols,
      rows: options.rows,
      rosterOverride: roster,
      preserveRoster:options.preserveRoster===true, // History uses the exact original portrait and enchantment roll.
      enemyClass: options.enemyClass || CLASS_ID,
      avatarRigScale: options.avatarRigScale || null, // Caller-authored puppet proportions travel through BanditCombat before collision sizes are computed.
      defOverride: { ...(options.defOverride || {}), rangedWeaponKey: null },
      extra: { ...(options.extra || {}), enemyClass: options.enemyClass || CLASS_ID, isMinion: true,...(theme?{ruinSkeletonTheme:theme,ruinWallCoffin:wallCoffin,ruinSkeletonHealthMultiplier:wallCoffin?RUIN_HEALTH.wallCoffin:RUIN_HEALTH.minion}:{}) },
    });
    if (!entity) return null;
    if(wallCoffin){
      if(entity.rosterRecord?.enchantedWeapon)entity.rosterRecord.enchantedWeapon.relicShape=COFFIN_SHAPES[entity.def?.weaponShapeKey];
      debug.coffins++;window.__farmLog?.('[ruin skeleton] '+theme+' coffin: '+entity.maxHealth+' HP, '+(entity.rosterRecord?.enchantedWeapon?.enchantments?.base?.[0]||'missing enchantment'),'info','combat');
    }

    const shamblingFraction = Number.isFinite(Number(options.shamblingFootingFraction)) ? Math.max(0, Math.min(1, Number(options.shamblingFootingFraction))) : SHAMBLING_FOOTING_FRACTION; // Custom puppet troops bypass Minion's Harlyao-only shamble.
    const shamblingAmount = (Number(entity.maxFooting) || 0) * shamblingFraction; // Reserve permanent footing only when the troop requests it.
    if (shamblingAmount > 0) resources.setImmutableAffliction(entity, 'shamblingFooting', shamblingAmount);
    resources.enforceCaps?.(entity); // Respect a canonical per-entity resource cap after any immutable affliction.
    entity.shamblingFootingFraction = shamblingFraction; // Mobile/debug-readable troop value.
    return entity;
  }

  async function makeDemolitionist(options = {}) {
    if (options.ruinEncounter !== true) {
      window.__farmLog?.('[minion] Harlyao Demolitionist spawn rejected outside an explicitly authored ruin encounter.', 'info', 'combat');
      return null; // Bomb carriers are a ruin-challenge archetype, never a mine or wilderness replacement for ordinary Minions.
    }
    const name = options.name || 'Harlyao Demolitionist'; // Display name used by the hostile nameplate and corpse record.
    const roster = options.roster || rollRoster('harlyao-skeleton', name, { gender:options.gender }); // The Demolitionist keeps the existing Harlyao Skeleton wardrobe, dye and armor pipeline.
    if (roster?.appearance?.speciesId !== 'harlyao-skeleton') return null; // Do not let a caller silently turn this Harlyao-only class into another species.
    const fuseSeconds = Number(options.witchBombFuseSeconds);
    return makeEntity({
      ...options,
      speciesId:'harlyao-skeleton',
      name,
      roster,
      enemyClass:'harlyao-demolitionist',
      defOverride:{ ...(options.defOverride || {}), weaponKey:null, rangedWeaponKey:null }, // Both hands belong to the physical Witch-bomb; no invisible backup weapon competes for the grip.
      extra:{
        ...(options.extra || {}),
        enemyClass:'harlyao-demolitionist',
        enemyLoadoutKind:'harlyao-demolitionist',
        isHarlyaoDemolitionist:true,
        carriesHronalWitchBomb:true, // BanditCombat creates the physical sphere and publishes its two-hand attachment target.
        ...(Number.isFinite(fuseSeconds) && fuseSeconds > 0 ? { witchBombFuseSeconds:fuseSeconds } : {}),
      },
    });
  }

  window.MinionCombat = Object.freeze({
    classId: CLASS_ID,
    defaultWeaponShapes: DEFAULT_WEAPON_SHAPES,
    overwearOptions: OVERWEAR_OPTIONS,
    bandolierChance: BANDOLIER_CHANCE,
    harlyaoArmorMetalKeys: HARLYAO_ARMOR_METAL_KEYS,
    harlyaoArmorMetalKey,
    shamblingFootingFraction: SHAMBLING_FOOTING_FRACTION,
    dyeWeights: DYE_WEIGHTS,
    rollRoster,
    coffinWeaponShapes:Object.keys(COFFIN_SHAPES),ruinHealth:RUIN_HEALTH,paintRuinPortraits,paintRuinPants,paintRuinPixels,ruinTorsoFootprint,seatRuinSpikeGeometry,attachRuinBackSpikes,trailMovement,emitRuinEnchantedHit,ruinDebugSnapshot:()=>({...debug}),
    makeEntity,
    makeDemolitionist, // Explicit ruin-only Harlyao archetype; future challenge composers call this rather than changing ordinary Minion spawns.
  });
})();
