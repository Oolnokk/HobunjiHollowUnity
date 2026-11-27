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
  const inkFadeFor=(r,g,b)=>Math.max(0,Math.min(1,(Math.max(r,g,b)-24)/40)); // All traditions preserve pure black and its dark outline fringe.
  async function paintRuinPortraits(roster,canvases){
    const theme=roster.ruinSkeletonTheme; // Spawn-only treatment.
    if(!theme)return;
    try{
      const oil=theme==='kanthic'?await loadOil():null;
      let frontMask=null; // Neutral and frown share the front patch distribution; rear gets its own mask.
      for(let view=0;view<canvases.length;view++){
        const canvas=canvases[view];
        const w=canvas.width,h=canvas.height,ctx=canvas.getContext('2d'); // Actual sprite resolution.
        const pixels=ctx.getImageData(0,0,w,h),data=pixels.data;
        let mask,overlay;
        if(oil){
          const eligible=new Uint8Array(w*h); // Opaque non-black sprite pixels.
          for(let p=0;p<eligible.length;p++){const i=p*4;eligible[p]=data[i+3]&&inkFadeFor(data[i],data[i+1],data[i+2])>0?1:0;}
          mask=view<3&&frontMask?frontMask:window.ToolMetalRecolor?.buildOxidationMask?.(eligible,w,h,.28,{seed:roster.ruinSkeletonSeed,blotchCount:9,separateBlotches:true});
          if(view===0)frontMask=mask;
          if(!mask)throw new Error('Verdigris mask unavailable');
          const hidden=document.createElement('canvas'); // Stretch-to-fit hidden oil source.
          hidden.width=w;hidden.height=h;const hc=hidden.getContext('2d');hc.drawImage(oil,0,0,w,h);
          overlay=hc.getImageData(0,0,w,h).data;
        }
        for(let p=0;p<w*h;p++){
          const i=p*4; // RGBA byte offset.
          if(!data[i+3]||!(data[i]||data[i+1]||data[i+2]))continue;
          const inkFade=inkFadeFor(data[i],data[i+1],data[i+2]); // Preserve black and dark antialiasing for every tradition.
          if(inkFade===0)continue; // Charcoal must not repaint the outline either.
          if(oil){if(!mask[p])continue;const a=overlay[i+3]/255*inkFade;for(let c=0;c<3;c++)data[i+c]=data[i+c]*(1-a)+overlay[i+c]*a;}
          else{
            const x=p%w,y=Math.floor(p/w),seed=roster.ruinSkeletonSeed; // Fine and coarse stable texture.
            const grain=noise(x,y,seed),broad=noise(Math.floor(x/4),Math.floor(y/4),seed);
            if(theme==='hronal'){
              const gray=(data[i]*.25+data[i+1]*.6+data[i+2]*.15)*(.16+broad*.18);
              const char=[gray+grain*9,gray*.85+grain*4,gray*.75]; // Soot darkens the body, not the original ink fringe.
              for(let c=0;c<3;c++)data[i+c]=data[i+c]*(1-inkFade)+Math.min(data[i+c],char[c])*inkFade;
            }else{
              const sheen=(.24+.31*broad+.16*grain)*inkFade;
              data[i]=data[i]*(1-sheen)+183*sheen;data[i+1]=data[i+1]*(1-sheen)+224*sheen;data[i+2]=data[i+2]*(1-sheen)+249*sheen;
            }
          }
        }
        ctx.putImageData(pixels,0,0);debug.portraits++;
      }
    }catch(error){report(error);}
  }
  function ruinTorsoFootprint(canvas,neck,width,height){
    const w=canvas?.width,h=canvas?.height;
    if(!(w>0&&h>0&&width>0&&height>0&&Number.isFinite(neck?.y)&&Number.isFinite(neck?.x)))return null;
    const rgba=canvas.getContext('2d').getImageData(0,0,w,h).data;
    const opaque=(x,y)=>rgba[(y*w+x)*4+3]>=128;
    const center=Math.max(0,Math.min(w-1,Math.floor((1-neck.x)*w))); // Rear canvas is mirrored when mapped to the actual plane.
    const headEnd=Math.max(0,Math.min(h-1,Math.ceil(neck.y*h)));
    let bottom=-1; // Lowest alpha-visible row below the skull.
    for(let y=h-1;y>headEnd&&bottom<0;y--)for(let x=0;x<w;x++)if(opaque(x,y)){bottom=y;break;}
    const span=bottom-headEnd;if(span<5)return null;
    for(const [start,end] of [[.18,.82],[.32,.70],[.42,.60]]){
      const first=headEnd+Math.max(1,Math.ceil(span*start)),last=headEnd+Math.floor(span*end);
      let left=0,right=w-1,valid=last>first;
      for(let y=first;y<=last&&valid;y++){
        let x=center;
        if(!opaque(x,y)){
          let found=-1;
          for(let d=1;d<=Math.ceil(w*.12)&&found<0;d++)for(const q of [center-d,center+d])if(q>=0&&q<w&&opaque(q,y)){found=q;break;}
          if(found<0){valid=false;break;}x=found;
        }
        let lo=x,hi=x;
        while(lo>0&&opaque(lo-1,y))lo--;
        while(hi<w-1&&opaque(hi+1,y))hi++;
        left=Math.max(left,lo);right=Math.min(right,hi);valid=right-left>=2;
      }
      if(!valid)continue;
      const x0=(.5-(right+.5)/w)*width,x1=(.5-(left+.5)/w)*width;
      const y0=(.5-(last+.5)/h)*height,y1=(.5-(first+.5)/h)*height;
      return {x:(x0+x1)/2,y:(y0+y1)/2,width:x1-x0,height:y1-y0,top:y1,bottom:y0};
    }
    return null;
  }
  function attachRuinBackSpikes(THREE,avatar,roster){
    const back=avatar.backPlane,width=avatar.modelWidth,height=avatar.modelHeight; // Rear portrait dimensions, never the weapon holder.

    const theme=roster.ruinSkeletonTheme; // Physical growth only for stone and ice.
    if(theme!=='hronal'&&theme!=='tothal')return;
    const build=window.IceStalagmiteCoverage?.build; // Real furniture stalagmite generator.
    if(!build){report('Stalagmite generator unavailable');return;}
    let footprint;
    try{footprint=ruinTorsoFootprint(avatar.backCanvas,avatar.ruinNeckNormalized,width,height);}catch(error){report(error);return;}
    if(!footprint){report('No opaque torso footprint below skull');return;}
    // Satellites spread up to 1.78 radii and their bases reach 1.44 more. Inset each seed edge by 3.3 radii.
    const radius=Math.min(width*.055,Math.min(footprint.width,footprint.height)/8);
    const maxSpikeHeight=Math.min(width*.32,footprint.height*.9); // Long spikes on a large skull's tiny torso otherwise visually resemble a separate held object.
    const minSpikeHeight=Math.min(width*.12,maxSpikeHeight*.45);
    const source=new THREE.Group(),geometry=new THREE.BoxGeometry(footprint.width-radius*6.6,.02,footprint.height-radius*6.6),material=new THREE.MeshBasicMaterial({visible:false}); // Torso-as-ground proxy.
    const support=new THREE.Mesh(geometry,material);support.userData.authoredPartId='ruin-skeleton-back';source.add(support);
    try{
      const stone=theme==='hronal';
      const layer=build(THREE,source,{kind:stone?'stoneStalagmites':'iceStalagmites',target:'selected',targetIds:['ruin-skeleton-back'],
        seed:roster.ruinSkeletonSeed,count:4,density:1,iceCluster:3,radius,iceHeightMin:minSpikeHeight,iceHeightMax:maxSpikeHeight,
        iceRoughness:.35,iceOpacity:stone?1:.92,color:stone?'#514942':'#c2e8fb',iceEngulf:.95,iceFootprintPadding:0,iceFacets:5,iceTipSharpness:.9,iceLean:.1});
      if(!layer?.children?.length)throw new Error('Back stalagmite generator returned no geometry');
      layer.name='ruin-skeleton-back-stalagmites';layer.rotation.x=Math.PI/2; // Furniture Y becomes rear-facing Z.
      layer.position.set(footprint.x,footprint.y,.007); // Ground vertices start at -.015; embed roots .008 into the portrait to avoid floating seams.
      layer.userData.ruinTorsoFootprint={...footprint,radius}; // Spawn-time placement diagnosis.
      // Attach to a torso spline node, excluding the two uppermost nodes and every head/weapon joint.
      let carrier=avatar.backPortraitMesh||back,rest={x:0,y:0,z:0},nearest=Infinity,offset={x:0,y:0,z:0};
      const nodes=avatar.ruinBackSplineNodes||[];
      for(let i=0;i<Math.min(5,nodes.length);i++){
        const p=nodes[i].userData?.hobunjiSplineRest;if(!p)break;
        rest={x:rest.x+p.x,y:rest.y+p.y,z:rest.z+p.z};
        const distance=Math.abs(rest.y-footprint.y);
        if(distance<nearest){nearest=distance;carrier=nodes[i];offset={...rest};}
      }
      layer.position.x-=offset.x;layer.position.y-=offset.y;layer.position.z-=offset.z;
      const owned=[]; // Only per-instance buffers/materials are disposed; natural surface caches remain shared.
      layer.traverse(node=>{if(!node.isMesh)return;delete node.userData.bladedHazard;
        if(stone && window.FacetedRocks?.surfaceStone){
          const oldGeometry=node.geometry,oldMaterial=node.material;
          window.FacetedRocks.surfaceStone(node,{tint:'#514942',label:layer.name});
          if(node.geometry!==oldGeometry)oldGeometry.dispose();
          if(node.material!==oldMaterial)oldMaterial.dispose();
          delete node.userData.shellOutline;node.layers.disable(1);
          owned.push({geometry:node.geometry,material:node.material===oldMaterial?oldMaterial:null});
        }else{owned.push({geometry:node.geometry,material:node.material});}
      });
      carrier.add(layer);debug.spikes++;
      avatar.ruinBackSpikeInfo={theme,carrier:carrier.name||'rear portrait',footprint:{...footprint},radius,minSpikeHeight,maxSpikeHeight}; // Workshop roll facts can identify the real attachment without devtools.
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
    coffinWeaponShapes:Object.keys(COFFIN_SHAPES),ruinHealth:RUIN_HEALTH,paintRuinPortraits,ruinTorsoFootprint,attachRuinBackSpikes,trailMovement,emitRuinEnchantedHit,ruinDebugSnapshot:()=>({...debug}),
    makeEntity,
    makeDemolitionist, // Explicit ruin-only Harlyao archetype; future challenge composers call this rather than changing ordinary Minion spawns.
  });
})();
