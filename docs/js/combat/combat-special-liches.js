// Named Harlyao lich guardians. Ordinary liches keep the baseline spell AI.
(() => {
  'use strict';
  const DATA = Object.freeze({
    hronal: { id:'azgarlu', name:'Azgarlu of the Flame', tomb:"Azgarlu's Tomb", key:'azgarlu_key_stone', glyph:'harlyao_glyph_entropy', ink:'#ff8526', dye:'dye:CLOTH:pure_orange', scale:{x:1.30,y:1.20,head:1}, weapon:'warhammer_nativeCopper' },
    tothal: { id:'nanahi', name:'Nanahi the Unsleeping', tomb:"Nanahi's Tomb", key:'nanahi_key_stone', glyph:'harlyao_glyph_servitude', ink:'#f0f9ff', dye:'dye:CLOTH:pure_green_blue', scale:{x:.80,y:1.30,head:1} },
    kanthic: { id:'imlao', name:'Imlao the Sightless', tomb:"Imlao's Tomb", key:'imlao_key_stone', glyph:'harlyao_glyph_ignorance', ink:'#a899eb', dye:'dye:CLOTH:dark_muted_blue_indigo', scale:{x:1,y:1,head:1} },
  }); // Boss metadata drives wardrobe, region title, key-stone and combat state.
  const TILE_FALLBACK = 64; // Used in isolated tests when BanditCombat has not supplied gameplay dependencies.
  const CHARGE_INTERVAL = 18; // Seconds between Kanthic charge sequences.
  const KNEEL_INTERVAL = 13; // Seconds between Tothal's overlapping ceiling barrages.
  const CHARGE_SPEED_TILES = 10; // Horizontal speed while Imlao dives in a straight line.
  const activePatches = new Set(); // Each finite tile-plasm handle is disposed on timeout or exit.
  const droplets = new Set(); // Reused bounded drip particles for Imlao's plasm transformation.
  let lastEvent = 'idle'; // Mobile diagnostic showing last special-lich action.

  function defFor(type) { return DATA[String(type || '').toLowerCase()] || null; }
  function glyphPattern(def) {
    const cached = window.RepoPatternLibrary?.getCachedById?.(def.glyph); // Uses the same authored Harlyao glyph definition as ruin decorations.
    const fallback = 'assets/patterns/motif_' + def.glyph + '.png'; // Visible even when the pattern library has not loaded yet.
    return cached?.pattern || {repoPatternId:def.glyph,motifUrl:fallback,motifScale:1,tiling:true};
  }
  function specialRoster(type) {
    const def = defFor(type);
    if (!def) return null;
    const cosmetics = type === 'hronal'
      ? ['draped_pants','tankan_bodywrap','rounded_pauldron','tangedcirclet']
      : type === 'tothal' ? ['facewrap','tankan_bodywrap','draped_pants'] : ['tankan_bodywrap','draped_pants'];
    const slots = {draped_pants:'pants',tankan_bodywrap:'overwear',rounded_pauldron:'pauldron',tangedcirclet:'hat',facewrap:'hood'}; // Facewrap is the existing face-covering hood-slot cosmetic, not a floating mask attachment.
    const appliedDyes = {CLOTH:def.dye,HOOD:def.dye,PANTS:def.dye,MASK:def.dye}; // Existing authored dye channels, not shader-only cosmetic tint.
    const roster = { name:def.name, appearance:{speciesId:'harlyao-skeleton',gender:type==='tothal'?'female':'male',cosmetics:{}},
      equippedCosmetics:cosmetics, cosmeticSlots:Object.fromEntries(cosmetics.map(id=>[id,slots[id]])), appliedDyes,
      lichType:type, lichDyeId:def.dye, specialLichId:def.id, glyphPatternId:def.glyph,
      clothingPatterns:{forcedOverpassBySlot:{
        overwear:{pattern:glyphPattern(def),fallbackColorC:{hex:def.ink}}, // Garb is visibly woven with its own named Harlyao glyph.
        ...(type==='hronal'?{pants:{pattern:glyphPattern(def),fallbackColorC:{hex:def.ink}}}:{}),
      }},
    };
    if (type==='hronal') {
      const armor = window.MetalArmorSystem; // Existing forged pauldron and circlet must follow the same rendering/loot rules as skeletal minions.
      roster.metalArmorItems = ['rounded_pauldron','tangedcirclet'].map(id => {
        const item = armor?.makeCraftedItem?.(id,'nativeCopper');
        if (item) {
          item.temperXp = armor.MAX_TEMPER_XP;
          item.sprite = armor.spriteForBlueprintAppearance?.(id,{speciesId:'harlyao-skeleton',gender:'male'});
          item.verdigrisPatternId = def.glyph; // Diagnostic identity for the weapon/armor entropy design.
          item.smithTreatment={mode:'pattern',pattern:glyphPattern(def)}; // Existing crafted-metal patina renderer applies entropy as a verdigris removal motif.
        }
        return item;
      }).filter(Boolean);
    }
    return roster;
  }

  function patternWarhammer(actor) {
    if (!actor?._specialWarhammerGlyph || actor._specialWarhammerPatternRequested || typeof document==='undefined' || typeof Image==='undefined') return;
    const holder=actor._banditToolHolder; // The standard BanditCombat weapon holder already knows every grip, strike and two-handed scale.
    if (!holder?.parent) return;
    let mesh=null; // Real tool-plane mesh with a loaded PNG, rather than a second invented weapon model.
    holder.traverse?.(obj=>{if(!mesh && obj.isMesh && obj.material?.map?.image?.width)mesh=obj;});
    if(!mesh)return;
    actor._specialWarhammerPatternRequested=true; // The asset loads once per guardian instead of spawning asynchronous work each frame.
    const original=mesh.material, originalMap=original.map; // Keep game-owned weapon texture intact for all other warhammers.
    const motif=new Image(); // Authored entropy-glyph PNG shared by wall engravings and crafted-armor verdigris.
    motif.onload=()=>{
      if(!holder.parent || mesh.material!==original || !originalMap?.image)return;
      try {
        const canvas=document.createElement('canvas');
        canvas.width=originalMap.image.naturalWidth || originalMap.image.width;
        canvas.height=originalMap.image.naturalHeight || originalMap.image.height;
        if(!canvas.width||!canvas.height)return;
        const ctx=canvas.getContext('2d');if(!ctx)return;
        ctx.drawImage(originalMap.image,0,0,canvas.width,canvas.height);
        const stamp=document.createElement('canvas');stamp.width=stamp.height=70;
        const sc=stamp.getContext('2d');if(!sc)return;
        sc.drawImage(motif,0,0,70,70);
        sc.globalCompositeOperation='source-in';
        sc.fillStyle='#69c8ad';sc.fillRect(0,0,70,70); // Verdigris color from the Harlyao metal oxidation palette.
        ctx.globalCompositeOperation='source-atop';ctx.globalAlpha=.9;
        for(let y=0;y<canvas.height;y+=70)for(let x=0;x<canvas.width;x+=70)ctx.drawImage(stamp,x,y);
        const texture=new window.THREE.CanvasTexture(canvas);
        texture.colorSpace=originalMap.colorSpace;texture.flipY=originalMap.flipY;
        texture.magFilter=originalMap.magFilter;texture.minFilter=originalMap.minFilter;
        const material=original.clone();material.map=texture;material.needsUpdate=true;
        mesh.material=material;
        actor._specialWarhammerMaterial={mesh,original,material,texture}; // Restores/disposes this per-boss patina on clear.
        lastEvent='azgarlu:entropy-verdigris';
      }catch(error){window.__farmLog?.('[special-lich] warhammer motif: '+error.message,'warn');}
    };
    motif.onerror=()=>{actor._specialWarhammerPatternRequested=false;}; // Asset failure leaves the original functional warhammer alone.
    motif.src='assets/patterns/motif_harlyao_glyph_entropy.png';
  }
  function releaseWarhammer(actor) {
    const entry=actor?._specialWarhammerMaterial;
    if(!entry)return;
    if(entry.mesh.material===entry.material)entry.mesh.material=entry.original;
    entry.texture.dispose?.();entry.material.dispose?.();
    actor._specialWarhammerMaterial=null;
  }
  function init(entity, type) {
    const spec = defFor(type);
    if (!entity || !spec) return entity;
    entity.isSpecialLich = true;
    entity.specialLichId = spec.id;
    entity.name = spec.name;
    entity._specialMode = type==='hronal'?'magic':null;
    entity._specialModeClock = 0; // Hronal switches stance and hover on this independent cadence.
    entity._specialHoverBlend = 1; // Lerp target is zero while fighting on foot.
    entity._specialCooldown = type==='kanthic'?8:7; // Special move clock; stagger from initial ordinary cast.
    entity._specialStage = null; // Tothal kneel or Kanthic charge-sequence data.
    entity._specialDripClock = 0; // Limits new droplet meshes to a low fixed rate.
    entity._specialPlasmLastTile = null; // Prevents repeated patches on the same crossed tile.
    entity._specialOriginalMaterials = null; // Restores all original silhouette/alpha materials after plasm transformation.
    if (type==='hronal' && entity._banditToolHolder?.parent && window.THREE?.PointLight) {
      const light=new window.THREE.PointLight(0xff8d37,.64,1.6); // One bounded weapon enchant glow, carried by the real warhammer holder.
      entity._banditToolHolder.add(light);
    }
    if (type==='kanthic') {
      for (const joint of [entity.avatarRef?.headScaleJoint?.front,entity.avatarRef?.headScaleJoint?.back]) {
        joint?.scale?.set?.(.001,.001,.001); // Hide the head itself, never the whole torso PNG.
      }
    }
    lastEvent = 'spawn:' + spec.id;
    return entity;
  }
  function finishStaged(actor) {
    actor._banditAction = null;
    actor.telegraphState = null;
    actor._lichCastingAbility = null;
  }
  function meleeAI(actor,dt,target,deps,angle,dist) {
    if (actor._banditAction) return {aimAngle:angle,moving:false,handled:true};
    const tile = deps?.TILE || TILE_FALLBACK;
    let moving = false;
    if (dist>tile*2.0) moving=!!deps?.moveCreatureToward?.(actor,target.x,target.y,actor.def.chaseSpeed,dt);
    actor._specialMeleeCooldown = Math.max(0,(actor._specialMeleeCooldown||0)-dt);
    if (dist < tile*2.25 && actor._specialMeleeCooldown<=0 && window.Combat?.beginStagedAction) {
      actor.facing = angle;
      actor.telegraphState='windup';
      actor._banditSwingAnim='chop';
      actor._banditSwingPose = null;
      actor._specialMeleeCooldown = 1.45;
      actor._banditAction=window.Combat.beginStagedAction({
        windupS:.29,strikeS:.16,recoverS:.18,
        data:{isBandit:true,attacker:actor,voiceCategory:'heavyAttack'},
        onStrike:()=>{
          actor.telegraphState='strike';
          if (Number(target.health)<=0 || Math.hypot(target.x-actor.x,target.y-actor.y)>tile*2.35) return;
          const a=Math.atan2(target.y-actor.y,target.x-actor.x);
          if (Math.abs(Math.atan2(Math.sin(a-actor.facing),Math.cos(a-actor.facing)))>1.1) return;
          if (window.Combat?.meleeHit && !window.Combat.meleeHit(actor,target,{rangePx:tile*2.35,halfConeRad:1.1,yaw:actor.facing})) return;
          const sourceX=actor.x===target.x?actor.x-1:actor.x;
          const damage=Math.max(14,Math.round((Number(actor.def?.damage)||14)*1.5));
          const impact={tag:'blunt',attacker:actor,footingDamageMultiplier:2};
          if (target===deps?.player) deps?.damagePlayer?.(damage,sourceX,actor.y,tile*6,impact);
          else deps?.damageCreature?.(target,damage,sourceX,actor.y,tile*6,impact);
          window.AudioSystem?.playWeaponHitSfx?.('blunt',actor.x,actor.y,actor.areaId);
          lastEvent='azgarlu:warhammer';
        },
        onComplete:()=>finishStaged(actor),onCancel:()=>finishStaged(actor),
      });
    }
    return {aimAngle:angle,moving,handled:true};
  }
  function shockwave(actor,deps) {
    const tile=deps?.TILE||TILE_FALLBACK;
    for(const victim of [deps?.player,...(deps?.hostileObjects||[])]) {
      if(!victim||victim===actor||Number(victim.health)<=0||victim.areaId && victim.areaId!==actor.areaId)continue;
      const dist=Math.hypot(victim.x-actor.x,victim.y-actor.y);
      if(dist>tile*2.4)continue;
      const damage=Math.max(1,Math.round(22*(1-dist/(tile*3))));
      const sx=dist<1?actor.x-1:actor.x;
      if(victim===deps?.player)deps?.damagePlayer?.(damage,sx,actor.y,tile*12,{footingDamageMultiplier:2,attacker:actor});
      else deps?.damageCreature?.(victim,damage,sx,actor.y,tile*12,{footingDamageMultiplier:2,attacker:actor});
    }
    window.AudioSystem?.playObjectSfxKey?.('shattercaskExplosion');
    lastEvent='imlao:concussive-stop';
  }
  function rememberPlasm(handle,clock=12) {
    if(!handle)return;
    const record={handle,time:clock}; // Same static-tile plasm used by ordinary Kanthic spells; lifetime bound to this charge.
    activePatches.add(record);
  }
  function beginKanthic(actor,target) {
    actor._specialStage={kind:'charge',remaining:4,travel:0,targetX:target.x,targetY:target.y};
    actor._specialPlasmLastTile=null;
    applyPlasmSkin(actor,true);
    lastEvent='imlao:plasm-charge';
  }
  function chargeAI(actor,dt,target,deps,angle) {
    const stage=actor._specialStage, tile=deps?.TILE||TILE_FALLBACK;
    if(!stage||stage.kind!=='charge')return null;
    const dx=stage.targetX-actor.x,dy=stage.targetY-actor.y,dist=Math.hypot(dx,dy);
    if(dist>tile*.45 && stage.travel<tile*8) {
      const step=Math.min(dist,CHARGE_SPEED_TILES*tile*dt);
      const direction=Math.atan2(dy,dx);
      actor.facing=direction;
      const moved=deps?.moveCreatureToward?.(actor,actor.x+Math.cos(direction)*step,actor.y+Math.sin(direction)*step,CHARGE_SPEED_TILES*tile,dt);
      stage.travel+=step;
      const tx=Math.floor(actor.x/tile),ty=Math.floor(actor.y/tile),key=tx+','+ty;
      if(key!==actor._specialPlasmLastTile) {
        actor._specialPlasmLastTile=key;
        rememberPlasm(window.DevRandomRuinLichThemes?.createSpellPlasm?.(tx+.5,ty+.5));
      }
      return {aimAngle:direction,moving:!!moved,handled:true};
    }
    shockwave(actor,deps);stage.remaining--;
    if(stage.remaining<=0){actor._specialStage=null;applyPlasmSkin(actor,false);actor._specialCooldown=CHARGE_INTERVAL;}
    else {stage.travel=0;stage.targetX=target.x;stage.targetY=target.y;actor._specialPlasmLastTile=null;}
    return {aimAngle:angle,moving:false,handled:true};
  }
  function handleAI(actor,dt,target,deps,angle,dist) {
    if(!actor?.isSpecialLich || !target || Number(target.health)<=0)return null;
    if(actor.lichType==='hronal') {
      actor._specialModeClock+=dt;
      if(actor._specialModeClock>=3.4&&!actor._banditAction) {
        actor._specialModeClock=0;
        actor._specialMode=actor._specialMode==='magic'?'melee':'magic';
        lastEvent='azgarlu:stance-'+actor._specialMode;
      }
      return actor._specialMode==='melee'?meleeAI(actor,dt,target,deps,angle,dist):null;
    }
    actor._specialCooldown=Math.max(0,actor._specialCooldown-dt);
    if(actor.lichType==='tothal') {
      if(actor._specialStage?.kind==='kneel') {
        const stage=actor._specialStage;
        stage.time-=dt;stage.wave-=dt;
        if(stage.wave<=0) {
          stage.wave=.62;
          window.DevRandomRuinLichThemes?.triggerBossBlizzard?.(actor);
          lastEvent='nanahi:ceiling-barrage';
        }
        if(stage.time<=0) {actor._specialStage=null;actor._specialCooldown=KNEEL_INTERVAL;lastEvent='nanahi:stand';}
        return {aimAngle:angle,moving:false,handled:true};
      }
      if(actor._specialCooldown<=0&&!actor._banditAction) {
        actor._specialStage={kind:'kneel',time:4.8,wave:0}; // A stationary vulnerable 4.8-second window.
        lastEvent='nanahi:kneel';
        return {aimAngle:angle,moving:false,handled:true};
      }
    }
    if(actor.lichType==='kanthic') {
      if(actor._specialStage?.kind==='charge')return chargeAI(actor,dt,target,deps,angle);
      if(actor._specialCooldown<=0&&!actor._banditAction) {
        beginKanthic(actor,target);
        return chargeAI(actor,dt,target,deps,angle);
      }
    }
    return null;
  }
  function retextureMap(source,plasm) {
    const image=source?.image;
    if(!image?.width||!image?.height || typeof document==='undefined')return null;
    const width=Math.min(1024,image.width),height=Math.min(1024,image.height);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');if(!ctx)return null;
    ctx.drawImage(image,0,0,width,height);
    ctx.globalCompositeOperation='source-atop'; // Preserve transparent body/clothing cutout outlines.
    const pattern=plasm?.image;
    ctx.fillStyle='#2d2148';ctx.fillRect(0,0,width,height); // Preserve the dark indigo-violet base of the live Kanthic oil.
    ctx.globalAlpha=.62;
    if(pattern?.width && pattern?.height) {
      for(let y=0;y<height;y+=80)for(let x=0;x<width;x+=80)ctx.drawImage(pattern,x,y,80,80);
    } else {
      ctx.fillStyle='rgba(147,112,190,.5)';
      for(let i=0;i<40;i++){const x=(i*71)%width,y=(i*109)%height;ctx.fillRect(x,y,2,18);}
    }
    ctx.globalAlpha=1;
    const texture=new window.THREE.CanvasTexture(canvas);texture.colorSpace=source.colorSpace;
    return texture;
  }
  function applyPlasmSkin(actor,enabled) {
    if(enabled && actor._specialOriginalMaterials)return;
    if(!enabled) {
      for(const entry of actor._specialOriginalMaterials||[]) {
        entry.mesh.material=entry.base;
        entry.changed.map?.dispose?.();
        entry.changed.dispose?.();
      }
      actor._specialOriginalMaterials=null;
      return;
    }
    const saved=[],plasm=window.DevRandomRuinLichThemes?.plasmTexture?.();
    actor.avatarRef?.group?.traverse?.(mesh=>{
      if(!mesh.isMesh || Array.isArray(mesh.material) || !mesh.material?.map) return;
      const texture=retextureMap(mesh.material.map,plasm);
      if(!texture)return;
      const material=mesh.material.clone();
      material.map=texture;material.color?.set?.('#ffffff');material.needsUpdate=true;
      saved.push({mesh,base:mesh.material,changed:material});
      mesh.material=material;
    });
    actor._specialOriginalMaterials=saved;
  }
  function dropParticle(actor,dt) {
    if(!actor._specialStage || !window.THREE || droplets.size>=36)return;
    actor._specialDripClock+=dt;
    if(actor._specialDripClock<.055)return;
    actor._specialDripClock=0;
    const group=actor.avatarRef?.group; const parent=group?.parent;
    if(!parent)return;
    const mesh=new window.THREE.Mesh(new window.THREE.SphereGeometry(.035,4,3),new window.THREE.MeshBasicMaterial({color:0x6a509d,transparent:true,opacity:.84,depthWrite:false}));
    mesh.position.set(group.position.x+(Math.random()-.5)*.6,group.position.y+(Math.random()-.5)*.7,group.position.z+(Math.random()-.5)*.6);
    parent.add(mesh);
    droplets.add({mesh,time:.45,velocity:.4+Math.random()*.9});
  }
  function tick(actor,dt) {
    if(!actor?.isSpecialLich)return;
    if(actor.lichType==='tothal') {
      const kneel=actor._specialStage?.kind==='kneel',avatar=actor.avatarRef;
      actor._specialKneelBlend=Math.min(1,Math.max(0,(actor._specialKneelBlend||0)+(kneel?dt*4:-dt*4)));
      for(const joint of [avatar?.neckJoint?.front,avatar?.neckJoint?.back])if(joint?.rotation)joint.rotation.x=-.38*actor._specialKneelBlend;
      actor._specialHoverTarget=kneel?0:1;
    }
    if(actor.lichType==='hronal') {
      actor._specialHoverTarget=actor._specialMode==='melee'?0:1;
      patternWarhammer(actor); // Actual verdigris-glyph texture follows the ordinary held warhammer.
    }
    if(actor.lichType==='kanthic') {
      actor._specialHoverTarget=1;
      if(actor._specialStage?.kind==='charge')dropParticle(actor,dt);
    }
  }
  function updateEffects(dt) {
    for(const item of [...activePatches]) {
      item.time-=dt;
      if(item.time>0)continue;
      item.handle.dispose?.();activePatches.delete(item);
    }
    for(const item of [...droplets]) {
      item.time-=dt;item.mesh.position.y-=item.velocity*dt;
      item.mesh.material.opacity=Math.max(0,item.time/.45)*.84;
      if(item.time>0)continue;
      item.mesh.parent?.remove?.(item.mesh);
      item.mesh.geometry.dispose?.();item.mesh.material.dispose?.();droplets.delete(item);
    }
  }
  function clear() {
    for(const item of activePatches)item.handle.dispose?.();
    activePatches.clear();
    for(const item of droplets){item.mesh.parent?.remove?.(item.mesh);item.mesh.geometry.dispose?.();item.mesh.material.dispose?.();}
    droplets.clear();
  }
  window.SpecialHarlyaoLiches=Object.freeze({
    DATA,defFor,specialRoster,init,handleAI,tick,updateEffects,applyPlasmSkin,clear,
    releaseWarhammer, // Original weapon material is restored before scene teardown, without disposing shared art assets.
    onDefeat: actor => actor?.isSpecialLich ? window.DelversGuild?.grantKeyStone?.(actor.specialLichId)===true : false,
    snapshot:()=>({event:lastEvent,plasmPatches:activePatches.size,drips:droplets.size}),
  });
})();
