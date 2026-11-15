// Optional ruin secrets: hidden low-tier chests and planebent Skeeri broods.
// All positions and clues derive from the room ID; no call consumes the main puzzle RNG.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinHiddenSecrets=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const MAP_ID='map_i_dev_random_ruin'; // Same area as the live shaft rooms and their projectile/fire registries.
  const SAFE_CHALLENGES=new Set(['pressurePlate','timedMelody','melodyEcho','ceilingRailTargets','dungeonFire','cavePressurePlate']);
  const hash=value=>{let h=2166136261;for(const ch of String(value))h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;return h;};
  const unit=value=>hash(value)/4294967296; // Independent deterministic roll for each placement decision.
  const nearFloor=(getPlayerY,y)=>Math.abs(Number(getPlayerY?.())-y)<0.9;
  function planForRoom(room,seed,theme){
    if(!room||room.kind!=='challenge-room'||room.w<10||room.d<10||!SAFE_CHALLENGES.has(room.challenge))return null;
    const id=String(seed)+':'+String(room.id);
    const kindRoll=unit(id+':kind'),nestRoll=unit(id+':nest');
    if(kindRoll>=.38&&nestRoll>=.16)return null;
    const kinds=['pillar','closet','suspended'];
    const kind=kindRoll<.38?kinds[hash(id+':style')%kinds.length]:null;
    return {id:'secret-'+room.id,roomId:String(room.id),theme:theme||'hronal',
      corner:hash(id+':corner')%4,kind,trigger:['projectile','fire','melody'][hash(id+':trigger')%3],
      suspension:hash(id+':cover')%2?'ice':'net',tier:unit(id+':tier')<.77?1:2,
      babies:nestRoll<.16?1+hash(id+':babies')%3:0};
  }
  function create(options={}){
    const {room,seed,theme,parent,THREE,getPlayerPosition,getPlayerY,addControl,removeControl}=options;
    const spec=planForRoom(room,seed,theme);
    if(!spec||!parent||!THREE?.Group)return null;
    const chests=root.DevRandomRuinDungeonChests; // Canonical chest locks, world-save open flags and loot ownership.
    const DS=options.DynamicSurfaces||root.DynamicSurfaces; // Ordinary room collision, not a new pathing layer.
    const bus=root.DevRandomRuinSimplePuzzles; // Canonical swept projectile intersections and target hum.
    const fire=root.DungeonFire; // Lit torch melee and flaming projectile contact share this one receiver.
    const floor=Number(room.y)||0,group=new THREE.Group();
    group.name='ruin-hidden-discoveries-'+room.id;parent.add(group);
    const left=(spec.corner&1)===0,top=(spec.corner&2)===0;
    const sx=left?1:-1,sz=top?1:-1;
    const edgeX=left?room.x:room.x+room.w,edgeZ=top?room.z:room.z+room.d;
    const at=(dx,dz)=>({x:edgeX+sx*dx,z:edgeZ+sz*dz});
    const center=at(1.55,1.55),mouth=at(3.3,1.95);
    const mat=root.ProceduralFurniture?.makePartMaterial?.({
      materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never',color:'#625d57'
    })||new THREE.MeshBasicMaterial({color:0x625d57}); // Reuse the ruin's authored carved stone rather than flat gray geometry.
    const dark=new THREE.MeshBasicMaterial({color:0x383733});
    const accent=new THREE.MeshBasicMaterial({color:0x8d806f});
    const ice=new THREE.MeshBasicMaterial({color:0x96cad8,transparent:true,opacity:.56,depthWrite:false});
    const materials=[mat,dark,accent,ice]; // Owned by this scene-only discovery, never a shared furniture material.
    const colliders=[]; // Precise per-floor optional barriers; cleared when the ruin session ends.
    const controls=[]; // Interactions participate in the existing ruin resolver and its teardown.
    const links=[]; // Projectile and fire target disposers, tied to this room's lifetime.
    const art=[]; // Asynchronously loaded baby rigs and audio emitters that have their own dispose().
    const rec={...spec,group,unlocked:spec.kind==='pillar',linked:false,disposed:false,discovered:false,
      gateProgress:0,chest:null,nest:null,targets:[],fireId:null,melody:null,notes:[],
      x:center.x,z:center.z,y:floor};
    const box=(name,w,h,d,x,y,z,material=mat)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
      mesh.name=name;mesh.position.set(x,y,z);
      mesh.userData.devRuinFootprintIgnore=true;group.add(mesh);return mesh;
    };
    const registerControl=control=>{if(!control)return;addControl?.(control);controls.push(control);};
    function blocker(name,x,z,w,d,enabled){
      if(!DS?.registerBlocker)return;
      const id=rec.id+':'+name;
      DS.registerBlocker({id,scope:'ruin-hidden-secrets',
        bounds:{minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2},
        enabled:()=>!rec.disposed&&enabled(),
        blocksAt:(_x,_z,_h,_record,_radius,query)=>{
          const height=Number(query?.y??query?.floorY??query?.worldY);
          return !Number.isFinite(height)||height>=floor-.35&&height<=floor+3.2;
        }});
      colliders.push(id);
    }
    function unlock(){
      if(rec.unlocked||rec.disposed)return false;
      rec.unlocked=true;
      if(rec.chest)rec.chest.secretRevealed=true;
      if(rec.kind==='suspended'&&rec.cover)rec.cover.visible=false; // Ice/net parts visibly give way before the real chest settles.
      root.RuinInteractionAudio?.mechanism?.(rec.gate||rec.cover||rec.group,{size:2});
      options.onStateChange?.();
      return true; // Do not touch wing objective/gate state: this is always optional.
    }
    function chestAt(x,z,y){
      if(!chests?.create)return null;
      const chest=chests.create({id:rec.id+':chest',parent:group,x,z,y,tier:spec.tier,theme:spec.theme,secret:true});
      if(chest){
        rec.chest=chest;
        const control=chest.control;
        control.available=()=>!rec.disposed&&!chest.opened&&rec.unlocked&&rec.gateProgress>=.98&&nearFloor(getPlayerY,floor);
        control.floorY=floor;
        registerControl(control);
      }
      return chest;
    }
    function targetAt(x,y,z,onHit){
      const targetMesh=box('secret-projectile-target-'+rec.id,.35,.42,.24,x,y,z,accent);
      targetMesh.userData.ruinProjectileTarget=true;
      const signal=root.FurniturePatternSurfaces?.attachStoneSignal?.(targetMesh,{
        face:'front',width:.32,height:.36,idleColor:'#a18b68',activeColor:'#8fffbd'
      });
      const target={id:rec.id+':target:'+rec.targets.length,object:targetMesh,hitMesh:targetMesh,active:false,
        hittable:()=>!rec.disposed&&!rec.unlocked&&nearFloor(getPlayerY,floor),
        onHit:()=>{if(rec.disposed||rec.unlocked)return;target.active=true;signal?.setActive(true);onHit();}};
      rec.targets.push(target);
      return target;
    }
    function fireAt(x,z,onBurn){
      const vessel=box('secret-unlit-brazier-'+rec.id,.6,.32,.6,x,floor+.93,z,accent);
      const ember=box('secret-brazier-ember-'+rec.id,.4,.08,.4,x,floor+1.11,z,dark);
      rec.fireVessel=vessel;rec.ember=ember;
      rec.fireRecord={id:rec.id+':fire',object:vessel,active:true,
        isActive:()=>!rec.disposed&&!rec.unlocked&&nearFloor(getPlayerY,floor),
        onBurn:()=>{if(!rec.fireRecord.isActive())return false;ember.material=accent;unlock();return true;}};
      rec.firePoint={x,z}; // PersistentGroundFire supplies flask and placed-fire overlap.
    }
    function melodyAt(x,z,onSolved){
      const composer=root.PuzzleCaveMelody;
      if(!composer?.generate||!composer?.createSession)return false;
      const plate=box('unmarked-music-pressure-stone-'+rec.id,.9,.075,.9,x,floor+.042,z,mat);
      rec.plate=plate;rec.platePoint={x,z}; // Nearly flush, no glowing glyph on the trigger itself.
      const song=composer.generate(rec.id+':melody',{difficulty:composer.ruinDifficulty?.(options.ruinTier)||3});
      rec.notes=song.notes.map(note=>note.index);
      const glyphs=root.RuinMelodyGlyphDecal?.create?.({
        root:group,plate:{x,y:floor,z},notes:rec.notes,backingMode:'carved',
        bounds:{minX:room.x,maxX:room.x+room.w,minZ:room.z,maxZ:room.z+room.d},
        sampleSupport:()=>({y:floor}),seed:hash(rec.id+':melody-art')
      });
      if(glyphs)art.push(glyphs);
      rec.melody=composer.createSession(song,{
        lookaheadMs:root.AudioSystem?.metronomeLookaheadMs||0,
        onStop:()=>{root.RuinInteractionAudio?.metronomeStop?.();root.MusicMinigame?.clearPuzzleBeatClock?.();},
        onBeat:beat=>{if(beat.absoluteBeat===0)root.MusicMinigame?.setPuzzleBeatClock?.(song.bpm,beat.whenMs);root.RuinInteractionAudio?.metronomeTick?.(beat);},
        onNote:note=>root.RuinInteractionAudio?.melodyPercussionTick?.(note),
        onSolved
      });
      rec.melodyListener=event=>{
        if(rec.disposed||rec.unlocked||event?.detail?.area!==(options.mapId||MAP_ID))return;
        rec.melody?.note?.(event.detail.noteIndex,event.detail.pressedAtMs);
      };
      root.addEventListener?.('hobunji-kurraya-puzzle-note',rec.melodyListener);
      return true;
    }
    if(spec.kind==='pillar'){
      const pillar=at(2.6,2.55);
      box('secret-sightline-pillar-'+rec.id,.85,2.55,.85,pillar.x,floor+1.27,pillar.z);
      blocker('pillar',pillar.x,pillar.z,.85,.85,()=>true);
      chestAt(center.x,center.z,floor);
      rec.gateProgress=1;
    }else if(spec.kind==='closet'){
      // L-shaped partition occupies existing floor cells: no new doorway, dead tile, or
      // exterior mesh leak. Its only opening faces the room and has an actual blocker.
      const xWall=edgeX+sx*3.3,zWall=edgeZ+sz*3.3;
      const wallZ1=edgeZ+sz*1.0,wallZ2=edgeZ+sz*2.85;
      const wallX=edgeX+sx*1.9;
      for(const [name,x,z,w,d] of [
        ['narrow-wall-a',xWall,wallZ1,.2,1.05],
        ['narrow-wall-b',xWall,wallZ2,.2,.7],
        ['back-wall',wallX,zWall,2.9,.2]
      ]){
        box(rec.id+':'+name,w,2.8,d,x,floor+1.4,z);
        blocker(name,x,z,w,d,()=>true);
      }
      const gate=box('secret-closet-stone-door-'+rec.id,.21,2.8,1.2,mouth.x,floor+1.4,mouth.z,dark);
      blocker('gate',mouth.x,mouth.z,.24,1.2,()=>rec.gateProgress<.92);
      rec.gate=gate;rec.gateY=gate.position.y;
      chestAt(center.x,center.z,floor);
      const switchAt=at(4.6,3.4);
      if(spec.trigger==='projectile')targetAt(switchAt.x,floor+1.5,switchAt.z,unlock);
      else if(spec.trigger==='fire')fireAt(switchAt.x,switchAt.z,unlock);
      else if(!melodyAt(switchAt.x,switchAt.z,unlock))targetAt(switchAt.x,floor+1.5,switchAt.z,unlock);
    }else if(spec.kind==='suspended'){
      const height=floor+Math.max(2.3,Math.min(2.75,(options.ceilingHeight||3.6)-1.15)); // The chest, cover and target must stay BELOW the airtight room cap.
      const chest=chestAt(center.x,center.z,height);
      if(chest){
        const topY=height+.35;
        rec.cover=spec.suspension==='ice'
          ?box('secret-ceiling-ice-prison-'+rec.id,1.15,1.0,1.05,center.x,topY,center.z,ice)
          :new THREE.Group();
        if(spec.suspension==='net'){
          rec.cover.name='secret-ceiling-net-'+rec.id;
          rec.cover.position.set(center.x,topY,center.z);group.add(rec.cover);
          for(const p of [-.48,-.16,.16,.48]){
            const strand=new THREE.Mesh(new THREE.BoxGeometry(.045,.87,1.05),accent);
            strand.name='secret-net-strand';strand.position.set(p,0,0);
            strand.userData.devRuinFootprintIgnore=true;rec.cover.add(strand);
          }
        }
        targetAt(center.x+.48,height+.37,center.z+.15,unlock); // Exposed edge of the hanging cover: visible and shootable from floor.
      }
    }
    if(spec.babies){
      // A separate opposite corner shelf preserves the chest's hidden sightline and does
      // not overlap the main objective. These are real planebent flying rigs, not eggs.
      const bx=left?room.x+room.w-1.2:room.x+1.2;
      const bz=top?room.z+room.d-1.2:room.z+1.2;
      const shelf=box('secret-skeeri-stone-shelf-'+rec.id,2.15,.3,1.05,bx,floor+2.05,bz);
      const nest=root.ProceduralFurniture?.buildFurnitureGroup?.('nest',0x756044)
        ||box('secret-skeeri-nest-'+rec.id,1.45,.14,.85,bx,floor+2.27,bz,accent);
      if(!nest.parent){nest.name='secret-skeeri-nest-'+rec.id;nest.position.set(bx,floor+2.19,bz);
        nest.scale.setScalar(.67);nest.userData.devRuinFootprintIgnore=true;group.add(nest);}
      rec.nest={x:bx,z:bz,babies:spec.babies,loaded:0,shelf,nest,anim:[],elapsed:0}; // Dormant hatchling motion updates only in the active room.
      for(let i=0;i<spec.babies;i++){
        const identity=String(seed)+':'+room.id+':baby:'+i;
        const palette=root.SkeeriRuins?.paletteFor?.(spec.theme,identity);
        Promise.resolve(root.SkeeriRuins?.createRig?.({skeeriPalette:palette})).then(rig=>{
          if(!rig?.root){return;}
          if(rec.disposed){rig.dispose?.();return;}
          rig.root.scale.setScalar(.27+(hash(identity)%4)*.025);
          rig.root.position.set(bx+(i-(spec.babies-1)/2)*.52,floor+2.32,bz);
          rig.root.rotation.y=(hash(identity+':yaw')%5-2)*.2;
          group.add(rig.root);art.push(rig);rec.nest.loaded++;
          rec.nest.anim.push({root:rig.root,baseY:rig.root.position.y,baseYaw:rig.root.rotation.y,
            phase:(hash(identity+':phase')%628)/100}); // Tiny independent breathing/ruffling, not adult combat flight.
        }).catch(error=>root.__farmLog?.('[ruin-secrets] Baby Skeeri rig: '+error.message,'warn'));
      }
      registerControl({kind:'ruinSkeeriNest',object:nest,promptRoot:nest,floorY:floor,
        range:2,priority:16,claimAction1:true,touchIcon:'🐣',
        available:()=>!rec.disposed&&nearFloor(getPlayerY,floor),
        label:()=>spec.babies+' Planebent Skeeri Hatchling'+(spec.babies===1?'':'s'),
        onPress:()=>{rec.discovered=true;options.showToast?.(
          'A hidden brood of '+spec.babies+' planebent Skeeri, coloured in the '+spec.theme+' tradition.',true);}});
    }
    rec.tick=dt=>{
      if(rec.disposed)return;
      const t=Math.min(.05,Math.max(0,Number(dt)||0));
      if(rec.nest?.anim.length){
        rec.nest.elapsed+=t;
        for(const baby of rec.nest.anim){
          baby.root.position.y=baby.baseY+.016*Math.sin(rec.nest.elapsed*2.4+baby.phase);
          baby.root.rotation.y=baby.baseYaw+.09*Math.sin(rec.nest.elapsed*1.1+baby.phase);
        }
      }
      if(rec.gate&&rec.unlocked&&rec.gateProgress<1){
        rec.gateProgress=Math.min(1,rec.gateProgress+t*1.7);
        rec.gate.position.y=rec.gateY+rec.gateProgress*3;
      }
      if(spec.kind==='suspended'&&rec.chest&&rec.unlocked&&rec.gateProgress<1){
        rec.gateProgress=Math.min(1,rec.gateProgress+t*2.3);
        rec.chest.group.position.y=floor+(1-rec.gateProgress)*(rec.chestDropHeight-floor);
      }
      if(rec.fireRecord&&!rec.unlocked&&rec.firePoint
        &&root.PersistentGroundFire?.intersects?.(options.mapId||MAP_ID,rec.firePoint.x,rec.firePoint.z,.38))unlock();
      if(rec.melody&&!rec.unlocked){
        const p=getPlayerPosition?.(),standing=p&&nearFloor(getPlayerY,floor)
          &&Math.hypot(p.x-rec.platePoint.x,p.z-rec.platePoint.z)<.48;
        rec.melody.step(t,!!standing);
        root.RuinInteractionAudio?.watchPlate?.(rec.plate,!!standing);
      }
      if(rec.targets.length&&!rec.linked&&bus?.hasActiveRuinState?.()===true){
        const disposers=rec.targets.map(target=>bus.registerExternalProjectileTarget?.(target));
        if(disposers.every(x=>typeof x==='function')){links.push(...disposers);rec.linked=true;}
        else disposers.forEach(dispose=>dispose?.());
      }
      if(rec.fireRecord&&!rec.fireId&&bus?.hasActiveRuinState?.()===true)
        rec.fireId=fire?.registerTarget?.(rec.fireRecord)||null;
    };
    if(rec.chest&&spec.kind==='suspended')rec.chestDropHeight=rec.chest.group.position.y;
    if(rec.chest?.opened){ // Opened caches remain visible and accessible after site restoration, without replaying the secret switch.
      rec.unlocked=true;rec.gateProgress=1;
      if(rec.gate)rec.gate.position.y=rec.gateY+3;
      if(spec.kind==='suspended'){rec.chest.group.position.y=floor;if(rec.cover)rec.cover.visible=false;}
    }
    rec.snapshot=()=>({id:rec.id,kind:rec.kind,trigger:rec.kind==='closet'?rec.trigger:rec.suspension,
      tier:rec.tier,unlocked:rec.unlocked,projectileLinked:rec.linked,fireLinked:!!rec.fireId,
      chestOpened:rec.chest?.opened??null,babies:rec.babies,nestLoaded:rec.nest?.loaded||0,
      nestDiscovered:rec.discovered});
    rec.dispose=()=>{
      if(rec.disposed)return;rec.disposed=true;
      for(const control of controls)removeControl?.(control);
      for(const dispose of links)dispose();
      if(rec.fireId)fire?.unregisterTarget?.(rec.fireId);
      if(rec.melodyListener)root.removeEventListener?.('hobunji-kurraya-puzzle-note',rec.melodyListener);
      rec.melody?.stop?.();
      for(const a of art)a.dispose?.();
      for(const id of colliders)DS?.remove?.(id);
      const geometries=new Set(); // Destroy detached secret meshes in both layer and V50 sessions; neither owner traverses them after removal.
      const ownMaterials=new Set(materials);
      group.traverse?.(node=>{
        if(node.geometry&&!node.geometry.userData?.devRuinSharedPrimitive)geometries.add(node.geometry);
        for(const material of Array.isArray(node.material)?node.material:[node.material])if(material)ownMaterials.add(material);
      });
      group.parent?.remove?.(group);
      for(const geometry of geometries)geometry.dispose?.();
      for(const material of ownMaterials)material.dispose?.(); // Cached source textures are owned by their original author, never disposed here.
      // The owner disposes all scene geometry after its puzzles; do not release
      // a shared authored chest texture or remove the group before that sweep.
    };
    return rec;
  }
  return Object.freeze({planForRoom,create});
});