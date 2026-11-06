// RuinLayerChallenges — self-contained gameplay mechanisms for stacked dungeon
// wings. All targets use SimplePuzzles' canonical ranged-projectile hook.
// A chamber only completes after a real player plate hold or real projectile hits.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinLayerChallenges=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const TYPES=Object.freeze(['pressurePlate','glyphObelisk','ceilingRailTargets','melodyEcho','dungeonFire','ropeChain','statueDefense']);
  const boneTextures=new Map(); // Shared Scratchbone numeral textures for every generated melody decal.
  function melodyFor(id){
    let seed=2166136261; // Deterministic FNV hash; the same generated chamber always has the same note sequence.
    for(const ch of String(id))seed=Math.imul(seed^ch.charCodeAt(0),16777619)>>>0;
    const size=4+(seed&1),notes=[];
    for(let i=0;i<size;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;notes.push(seed%8);}
    return notes;
  }
  const TARGET_COLORS=Object.freeze({idle:0xff9e42,hit:0x55e886,stone:0x777267});
  function ropePitForRoom(room,side){
    if(!room||!['N','E','S','W'].includes(side))return null;
    const alongX=side==='E'||side==='W';
    const length=alongX?room.w:room.d;
    if(length<11)return null; // Three supported cells on either bank and at least five cells of actual abyss.
    const bank=3; // Physical ground left before/after the void, measured from the chamber's full exterior walls.
    const bounds={
      minX:room.x+(alongX?bank:0),maxX:room.x+room.w-(alongX?bank:0),
      minZ:room.z+(alongX?0:bank),maxZ:room.z+room.d-(alongX?0:bank),
    };
    return {
      ...bounds,axis:alongX?'x':'z',side,
      contains:(x,z)=>x>=bounds.minX&&x<bounds.maxX&&z>=bounds.minZ&&z<bounds.maxZ,
    };
  }

  function compose(options={}){
    const {THREE,parent,room,id,kind,y,isActive,onSolved,getPlayerPosition,getPlayerY}=options;
    if(kind==='statueDefense'){
      const defense=options.RuinLayerDefense||root.RuinLayerDefense; // Delegates authored statue and combat rules instead of duplicating their puzzle state.
      if(!defense?.create)throw new Error('Native RuinLayerDefense module is not installed.');
      return defense.create(options);
    }
    if(!THREE?.Mesh||!THREE?.MeshBasicMaterial||!parent?.add||!room||!TYPES.includes(kind)
      ||typeof isActive!=='function'||typeof onSolved!=='function')
      throw new Error('Invalid layered ruin challenge '+id+' ('+kind+').');
    const cx=room.x+room.w/2,cz=room.z+room.d/2;
    const owned=[],materials=[],targets=[],authoredVisuals=[]; // Each challenge owns its geometry, authored fixture instances and their per-room materials.
    const rec={id,kind,solved:false,elapsed:0,targetCount:0,hits:0,targets,plate:null,linked:false,disposed:false};
    const group=new THREE.Group(); // Visible mechanism geometry follows the wing floor's presentation culling.
    group.name='ruin-layer-challenge-'+id;parent.add(group);
    const basic=color=>{const mat=new THREE.MeshBasicMaterial({color});materials.push(mat);return mat;};
    const authoredStone=root.ProceduralFurniture?.makePartMaterial?.({
      materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never',color:'#777267'
    });
    if(authoredStone)materials.push(authoredStone); // Owned stone material uses the same texture treatment as the shaft and V50 walls.
    const stone=authoredStone||basic(TARGET_COLORS.stone),idle=basic(TARGET_COLORS.idle),hit=basic(TARGET_COLORS.hit);
    const plateMat=basic(0x776452);
    const bus=options.projectileBus||root.DevRandomRuinSimplePuzzles;
    const side=options.side||'E'; // Used by rope chambers to orient the traversal away from the shaft.
    const music=options.music||root.MusicMinigame; // Existing eight-note flute performance/puzzle bridge is authoritative.
    const fire=options.dungeonFire||root.DungeonFire; // Reuse real ranged-weapon ignition + projectile contact/heat checks.
    const events=options.events||root; // Reuses the standard hobunji-ruin-melody-result event, not a new music input bridge.
    let linkDisposers=[]; // Disposers are returned by the existing modular target hit registry.
    let melodyListener=null; // Removed on the same lifecycle as this authored chamber's other resources.
    let fireTargetId=null; // Registered only when the correct ruin's projectile runtime is live; removed on teardown.
    let fireControl=null; // This chamber removes its fire-source interaction when disposed, including on partial mounts.
    let ropeChain=null; // Native V50 rope controller owns all rope physics and checkpoint updates after registration.
    let icePlacement=null; // The existing door-ice generator owns the visible stalagmites over the fire target.
    let flameVisuals=[]; // Authored particle emitters are ticked and disposed with their puzzle, never left running after a reroll.
    const body=(name,geometry,mat,x,py,z)=>{
      const mesh=new THREE.Mesh(geometry,mat);
      mesh.name=name;mesh.position.set(x,py,z);
      mesh.userData ||= {};
      mesh.userData.devRuinFootprintIgnore=true; // Mechanism geometry must not block floor navigation; only the physical stone gate does.
      group.add(mesh);owned.push(mesh);return mesh;
    };
    const authored=(key,x,py,z)=>{ // Existing Furniture Author pieces are placed as visuals; the challenge retains its own hit/collision authority.
      const furniture=root.DevRandomRuinFurniturePieces;
      const visual=furniture?.build?.(key);
      if(!visual)return null;
      visual.position.set(x,py,z);
      group.add(visual);authoredVisuals.push(visual);
      return visual;
    };
    const complete=()=>{
      if(rec.solved||rec.disposed||!isActive())return false;
      rec.solved=true;onSolved(rec);
      return true;
    };
    const target=(name,x,py,z,ceiling=false)=>{
      const kit={ // Reuse the standalone V50 ceiling-sconce geometry and glyph art, not a second hand-built ceiling target.
        sharedBoxGeometry:(w,h,d)=>new THREE.BoxGeometry(w,h,d),
        makeBasic:basic,
        naturalizeStone:mesh=>{mesh.material=stone;return mesh;}
      };
      const hanging=ceiling?root.DevRandomRuinCeilingTargetVisuals?.create?.(kit,{
        parent:group,name,x,y:py+.6,z
      }):null;
      let base,rune,plaque=null,hitMesh,visualRoot=null;
      if(hanging){
        visualRoot=hanging.object;base=visualRoot;rune=hanging.hitMesh;hitMesh=hanging.hitMesh;
        authoredVisuals.push(visualRoot); // Hanging fixture owns multiple meshes and a shared rune texture.
      }else{
        const stemHeight=Math.max(.9,py-y+.17); // Grounded stone pillar reaches the glyph height rather than floating in the air.
        base=body(name+'-stone',new THREE.CylinderGeometry(.35,.43,stemHeight,8),stone,x,y+stemHeight*.5,z);
        body(name+'-cap',new THREE.BoxGeometry(.85,.13,.85),stone,x,y+stemHeight-.035,z);
        base.raycast=()=>{};
        rune=body(name+'-rune-hit',new THREE.BoxGeometry(.62,.5,.2),idle,x,py,z+.43);
        hitMesh=rune;
        plaque=authored('ruinGlyphTarget',x,py,z+.55);
        if(plaque){
          // The real rune decal is visible while the transparent box remains the canonical projectile target.
          const invisible=basic(0xffffff);
          invisible.transparent=true;invisible.opacity=0;invisible.depthWrite=false;
          rune.material=invisible;
        }
      }
      const state={
        id:name,object:visualRoot||rune,hitMesh,active:false,
        hittable:()=>!rec.disposed&&!state.active&&isActive()&&(visualRoot||rune).visible
          &&Number.isFinite(Number(getPlayerY?.()))&&Math.abs(Number(getPlayerY())-y)<.9,
        onHit:()=>{
          if(state.active||rec.disposed||!isActive()
            ||!Number.isFinite(Number(getPlayerY?.()))||Math.abs(Number(getPlayerY())-y)>=.9)return;
          state.active=true;rec.hits++;
          if(hanging)hanging.setActive(true);
          else if(!plaque)rune.material=hit;
          options.onHit?.(rec,state);
          if(rec.hits===rec.targetCount)complete();
        },
        base,rune,visualRoot,plaque,baseY:base.position.y,runeY:rune.position.y,origin:{x,z,y:visualRoot?py+.6:py},
      };
      if(plaque)root.DevRandomRuinFurniturePieces?.track?.(plaque,()=>state.active?1:0);
      targets.push(state);return state;
    };
    if(kind==='pressurePlate'){
      const surface=body('stone-pressure-plate-'+id,
        new THREE.BoxGeometry(2.2,.18,2.2),plateMat,cx,y+.05,cz);
      rec.plate=surface;
      rec.requiredSeconds=.8;
    }else if(kind==='ropeChain'){
      // A real open abyss occupies the entire width of this chamber. The
      // physical floor and DynamicSurfaces supports are omitted by
      // RuinLayerPlayable, while the V50 rope runtime handles player grabs,
      // release flights, mid-air rope catches and fatal checkpoint respawns.
      const pit=ropePitForRoom(room,side);
      if(!pit)throw new Error('Rope chamber cannot hold two safe banks: '+id);
      const centerX=(pit.minX+pit.maxX)/2,centerZ=(pit.minZ+pit.maxZ)/2;
      const pitLength=pit.axis==='x'?pit.maxX-pit.minX:pit.maxZ-pit.minZ;
      const positive=side==='E'||side==='S',from=positive?-1:1,to=-from;
      const alongX=pit.axis==='x';
      const start=alongX?(positive?pit.minX:pit.maxX):(positive?pit.minZ:pit.maxZ);
      const finish=alongX?(positive?pit.maxX:pit.minX):(positive?pit.maxZ:pit.minZ);
      const entry={x:alongX?start+from*.8:centerX,z:alongX?centerZ:start+from*.8,y};
      const exit={x:alongX?finish+to*.8:centerX,z:alongX?centerZ:finish+to*.8,y};
      const count=Math.max(3,Math.min(8,Math.ceil((pitLength-1)/2.25)+1));
      const anchors=Array.from({length:count},(_,i)=>{
        const t=.5+(pitLength-1)*i/(count-1); // Spread across the entire abyss, keeping a small margin at either bank.
        const along=start+(positive?1:-1)*t;
        return {x:alongX?along:centerX,z:alongX?centerZ:along,y:y+3.35};
      });
      for(const anchor of anchors){
        const mount=authored('ruinRopeMount',anchor.x,anchor.y-2.965,anchor.z); // The existing Rope Furniture mount's top anchor sits exactly on the actual physics rope pivot.
        if(mount)mount.userData.ruinLabRopeFixture=true;
      }
      const beam=body('ruin-abyss-ceiling-beam-'+id,
        new THREE.BoxGeometry(alongX?pitLength+1:0.5,.3,alongX?.5:pitLength+1),
        stone,centerX,y+3.4,centerZ);
      beam.userData.devRuinCeilingBeam=true;
      const fog=body('ruin-bottomless-abyss-'+id,
        new THREE.PlaneGeometry(pit.maxX-pit.minX,pit.maxZ-pit.minZ),
        basic(0x08090b),centerX,y-.15,centerZ);
      fog.rotation.x=-Math.PI/2;fog.userData.devRuinBottomlessFog=true;
      rec.pit=pit;rec.ropesRequested=count;
      rec.ropeSpec={id,roomId:id,bounds:pit,entry,exit,floorY:y,anchors,
        yaw:Math.atan2(side==='S'?1:side==='N'?-1:0,side==='E'?1:side==='W'?-1:0),
        length:2.43, maxLength:2.55,parent:group};
    }else if(kind==='dungeonFire'){
      // The standard DungeonFire runtime owns shot ignition and plume-to-ice
      // collision. The room merely authors a source brazier, a heat target,
      // and a progression gate; it never guesses from a normal arrow hit.
      const source=authored('ruinStandingBrazier',cx-2.3,y,cz)
        ||body('ruin-fire-source-'+id,new THREE.CylinderGeometry(.65,.8,.65,8),stone,cx-2.3,y+.37,cz);
      const createEmitter=root.AuthoredFurniture?.createEmitterVisual;
      if(typeof createEmitter==='function'){
        const flameRoot=new THREE.Group(); // Particle flame stays attached to the authored brazier's bowl.
        flameRoot.name='ruin-fire-flame-'+id;
        flameRoot.position.set(cx-2.3,y+1.2,cz);group.add(flameRoot);
        for(const stream of [
          {id:'yellow',colorA:'#fff56a',colorB:'#ffdc12'},
          {id:'red',colorA:'#ff5225',colorB:'#e91b08'},
          {id:'orange',colorA:'#ffab3b',colorB:'#ff740c'}
        ]){
          const emitter=createEmitter(flameRoot,{id:'ruin_fire_'+stream.id,name:'Brazier flame',type:'fire',enabled:true,
            position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},radius:.12,size:.16,rate:9,
            lifetime:.7,speed:.65,spread:.25,gravity:-.05,colorA:stream.colorA,colorB:stream.colorB},11);
          if(emitter){emitter.update?.(1/9,true);flameVisuals.push(emitter);}
        }
        if(!flameVisuals.length)flameRoot.parent?.remove(flameRoot);
      }
      if(!flameVisuals.length)body('ruin-fire-source-flame-'+id,new THREE.ConeGeometry(.35,.8,7),
        idle,cx-2.3,y+1.3,cz); // Only a fallback when the shared authored emitter runtime is unavailable.
      const frozen=basic(0x9fdaed);
      const ice=body('ruin-fire-ice-seal-'+id,
        new THREE.BoxGeometry(2.3,2.1,.75),frozen,cx+2.1,y+1.18,cz);
      icePlacement=root.DungeonDoorIceCoverage?.create?.({door:ice,parent:group,groundY:y,seed:id})||null;
      if(icePlacement){
        frozen.transparent=true;frozen.opacity=0;frozen.depthWrite=false;
        icePlacement.iceLayer.traverse?.(node=>{node.userData.devRuinFootprintIgnore=true;});
        authoredVisuals.push(icePlacement.iceLayer); // Exact same generated ice that melts from real Tothal doors.
      }
      rec.fireSource=source;rec.fireSeal=ice;
      rec.meltProgress=0;rec.melting=false;
      rec.animate=dt=>{
        if(!rec.melting||rec.disposed||rec.meltProgress>=1)return;
        rec.meltProgress=Math.min(1,rec.meltProgress+Math.max(0,Math.min(.05,Number(dt)||0))/.85);
        const t=rec.meltProgress*rec.meltProgress*(3-2*rec.meltProgress); // Reverse the ice growth over a smooth .85s lerp.
        ice.scale.y=Math.max(.02,1-t);
        ice.position.y=y+1.18-1.04*t; // Fallback target bounds contract as the ice disappears.
        if(icePlacement)root.DungeonDoorIceCoverage?.setGrowth?.(icePlacement,1-t);
        if(t>=1)ice.visible=false;
      };
      rec.fireRecord={
        id:'layer-fire-target-'+id,object:ice,active:true,contactPadding:.16,
        isActive:()=>!rec.disposed&&!rec.solved&&isActive()
          &&Number.isFinite(Number(getPlayerY?.()))&&Math.abs(Number(getPlayerY())-y)<.9,
        onBurn:()=>{
          if(!rec.fireRecord.isActive())return false;
          rec.fireRecord.active=false;
          rec.melting=true;
          if(!icePlacement)rec.fireSeal.material=hit;
          return complete();
        },
      };
      fireControl={
        kind:'dungeonFireSource',object:source,promptRoot:source,
        floorY:y,range:1.75,priority:26,touchIcon:'🔥',label:'Ignite Next Shot',
        onPress:()=>{
          if(rec.disposed||rec.solved||!isActive()
            ||Math.abs(Number(getPlayerY?.())-y)>.9)return;
          if(fire?.armNextProjectile?.()===true)options.onFireArmed?.(rec);
          else options.onFireUnavailable?.(rec);
        }
      };
      options.addControl?.(fireControl);
    }else if(kind==='melodyEcho'){
      // This is the existing melody-echo mini-game: stepping onto the bronze
      // plate plays the generated phrase; step off/on to hear it again, then
      // play the note sequence using the equipped flute. No WRONG overlay.
      const plate=body('ruin-melody-trigger-'+id,
        new THREE.BoxGeometry(1.35,.14,1.35),plateMat,cx,y+.07,cz);
      const plateSkin=authored('ruinRewardPlate',cx,y,cz);
      if(plateSkin){
        plateSkin.scale.set(1.8,1,1.8); // The authored press surface remains the same footprint as the melody's trigger region.
        const invisible=basic(0xffffff);
        invisible.transparent=true;invisible.opacity=0;invisible.depthWrite=false;
        plate.material=invisible;
      }
      rec.plate=plate;rec.plateSkin=plateSkin;
      rec.notes=melodyFor(id);
      rec.lastDown=false;rec.attempts=0;
      if(THREE.TextureLoader&&THREE.PlaneGeometry){
        for(let i=0;i<rec.notes.length;i++){
          const number=rec.notes[i]+1; // Actual Scratchbone 1–8 sprites match the generated instrument notes.
          let texture=boneTextures.get(number);
          if(!texture){
            texture=new THREE.TextureLoader().load('assets/hud/scratchbone'+number+'.png');
            if(THREE.SRGBColorSpace)texture.colorSpace=THREE.SRGBColorSpace;
            boneTextures.set(number,texture);
          }
          const material=new THREE.MeshBasicMaterial({
            map:texture,color:0xf5ead9,transparent:true,depthWrite:false,side:THREE.DoubleSide,
          });
          materials.push(material); // Textures are immutable and shared; only the decal material is owned by this room.
          const decal=body('scratchbone-note-'+id+'-'+i,
            new THREE.PlaneGeometry(.65,.75),material,
            cx+(i-(rec.notes.length-1)/2)*.8,y+1.8,room.z+.55);
          decal.userData.devRuinScratchboneMelodyNote=number;
        }
      }
      rec.onMelodyResult=detail=>{
        if(rec.disposed||rec.solved||detail?.id!==id)return;
        if(detail.solved===true){
          if(rec.plateSkin)rec.plateSkin.traverse(node=>{if(node.isMesh&&node.material?.color)node.material.color.setHex(TARGET_COLORS.hit);});
          else rec.plate.material=hit;
          complete();
        }
      };
      melodyListener=event=>rec.onMelodyResult(event?.detail); // One authoritative callback shared by browser event and tests.
      events?.addEventListener?.('hobunji-ruin-melody-result',melodyListener);
    }else if(kind==='glyphObelisk'){
      // Three separate real projectile targets spaced around the room.
      // Each uses the existing ranged weapon's world-space hit sweep.
      const dx=Math.min(2.8,room.w*.22),dz=Math.min(2.8,room.d*.22);
      target(id+'-glyph0',cx-dx,y+1.6,cz-dz*.45);
      target(id+'-glyph1',cx,y+2.1,cz+dz*.52);
      target(id+'-glyph2',cx+dx,y+1.6,cz-dz*.45);
    }else if(kind==='ceilingRailTargets'){
      // Both targets physically traverse a rail beneath the room ceiling.
      // They must be aimed at while moving, like the existing V50 target rail.
      const alongX=room.w>=room.d;
      const distance=Math.max(3,(alongX?room.w:room.d)*.34);
      const track=body('ruin-moving-target-track-'+id,
        new THREE.BoxGeometry(alongX?distance*2+.9:.18,.12,alongX?.18:distance*2+.9),
        stone,cx,y+2.72,cz);
      track.userData.devRuinCeilingRail=true;
      for(let i=0;i<2;i++){
        const t=target(id+'-moving'+i,cx,y+2.15,cz,true);
        t.alongX=alongX;t.distance=distance;
        t.phase=i*Math.PI;t.speed=1.2+i*.35;
      }
    }
    rec.targetCount=targets.length;
    rec.tick=(dt)=>{
      if(rec.disposed)return;
      for(const emitter of flameVisuals)emitter.update?.(Math.max(0,Math.min(.05,Number(dt)||0)),true); // Reuse the authored fire renderer's own particle lifecycle.
      const player=getPlayerPosition?.(),currentY=getPlayerY?.();
      if(kind==='pressurePlate'&&isActive()&&!rec.solved){
        const standing=player&&Number.isFinite(currentY)&&Math.abs(currentY-y)<.75
          &&Math.hypot(player.x-cx,player.z-cz)<1.15;
        rec.elapsed=standing?rec.elapsed+Math.min(.05,Math.max(0,dt)):0;
        if(rec.elapsed>=rec.requiredSeconds){rec.plate.material=hit;complete();}
      }
      if(kind==='melodyEcho'&&!rec.solved){
        const down=isActive()&&player&&Number.isFinite(currentY)&&Math.abs(currentY-y)<.75
          &&Math.abs(player.x-cx)<.58&&Math.abs(player.z-cz)<.58;
        if(down&&!rec.lastDown){
          const started=music?.beginPlayerSession?.({echoChallenge:{id,notes:rec.notes}});
          if(started){
            rec.attempts++;
            options.onMusicStart?.(rec);
          }else options.onMusicUnavailable?.(rec);
        }
        rec.lastDown=!!down; // Step off and on to replay the phrase, including after an incomplete attempt.
      }
      if(kind==='ceilingRailTargets'&&!rec.solved){
        rec.elapsed+=Math.min(.05,Math.max(0,dt));
        for(const t of targets){
          if(t.active)continue;
          const offset=Math.sin(rec.elapsed*t.speed+t.phase)*t.distance;
          if(t.visualRoot){
            t.visualRoot.position.set(t.origin.x+(t.alongX?offset:0),t.origin.y,t.origin.z+(t.alongX?0:offset));
          }else{
            t.base.position.set(t.origin.x+(t.alongX?offset:0),t.baseY,t.origin.z+(t.alongX?0:offset));
            t.rune.position.set(t.base.position.x,t.runeY,t.base.position.z+.43);
            if(t.plaque)t.plaque.position.set(t.base.position.x,t.runeY,t.base.position.z+.55);
          }
        }
      }
      if(kind==='ropeChain'){
        if(!ropeChain&&bus?.hasActiveRuinState?.()===true){
          ropeChain=bus?.registerExternalRopeChain?.(rec.ropeSpec)||null;
          rec.ropeLinked=!!ropeChain;
          rec.error=ropeChain?null:bus?.lastExternalRopeError?.()||'Rope controller declined the room'; // Surface registration failures in the mobile challenge badge.
          if(ropeChain)options.onLink?.(rec);
        }
        if(ropeChain&&!rec.solved&&isActive()&&player&&Number.isFinite(currentY)
          &&Math.abs(currentY-y)<.9){
          const finish=rec.ropeSpec.exit;
          const along=rec.pit.axis==='x'?player.x:player.z;
          const gateAlong=rec.pit.axis==='x'?finish.x:finish.z;
          const beyond=(side==='E'||side==='S')?along>=gateAlong-.2:along<=gateAlong+.2;
          const cross=rec.pit.axis==='x'?Math.abs(player.z-finish.z):Math.abs(player.x-finish.x);
          if(beyond&&cross<1.6)complete(); // The ACTUAL opposite bank, not a decorative activator, opens the gate.
        }
      }
      if(kind==='dungeonFire'&&!rec.solved&&!fireTargetId
        &&bus?.hasActiveRuinState?.()===true){
        fireTargetId=fire?.registerTarget?.(rec.fireRecord)||null;
        rec.fireLinked=!!fireTargetId;
        if(rec.fireLinked)options.onLink?.(rec); // One-time mobile diagnostic update on a successful fire hook.
      }
      // External target registration may precede this module (the V50
      // puzzle runtime initializes on its first *in-map* frame). Retry until
      // the canonical projectile registry becomes available.
      if(targets.length&&!rec.linked){
        const registered=[];
        for(const t of targets){
          const disposer=bus?.registerExternalProjectileTarget?.(t);
          if(typeof disposer!=='function')break;
          registered.push(disposer);
        }
        if(registered.length===targets.length){
          linkDisposers=registered;rec.linked=true;
          options.onLink?.(rec); // The first active ranged challenge is now attached to the canonical hit loop.
        }
        else for(const remove of registered)remove();
      }
    };
    rec.dispose=()=>{
      if(rec.disposed)return;
      rec.disposed=true;
      for(const remove of linkDisposers)remove();
      if(fireTargetId)fire?.unregisterTarget?.(fireTargetId);
      if(fireControl)options.removeControl?.(fireControl);
      if(ropeChain)bus?.removeExternalRopeChain?.(ropeChain);
      if(melodyListener)events?.removeEventListener?.('hobunji-ruin-melody-result',melodyListener);
      for(const emitter of flameVisuals)emitter.dispose?.();
      flameVisuals=[];
      if(icePlacement)root.DungeonDoorIceCoverage?.clear?.(icePlacement);
      group.parent?.remove(group);
      for(const m of owned)m.geometry?.dispose?.();
      const seenMaterials=new Set(materials); // Authored fixtures have per-instance materials but share immutable cached textures.
      for(const visual of authoredVisuals){
        visual.parent?.remove(visual); // A detached group has no scene parent; FurniturePieces.track can now release its glow callback instead of retaining the entire discarded ruin.
        visual.traverse?.(node=>{
        if(!node.isMesh)return;
        if(!node.geometry?.userData?.devRuinSharedPrimitive)node.geometry?.dispose?.();
        const mats=Array.isArray(node.material)?node.material:[node.material];
        for(const mat of mats)if(mat&&!seenMaterials.has(mat)){seenMaterials.add(mat);mat.dispose?.();}
        });
      }
      for(const mat of materials)mat.dispose?.();
    };
    rec.simulateHit=(index)=>{
      // In-process tests may dispatch the SAME target callback that the
      // canonical projectile wrapper calls; never bypass isActive or gate logic.
      targets[index]?.onHit?.();
    };
    return rec;
  }
  return Object.freeze({TYPES,compose,melodyFor,ropePitForRoom});
});
