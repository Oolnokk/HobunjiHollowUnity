// RuinLayerChallenges — self-contained gameplay mechanisms for stacked dungeon
// wings. All targets use SimplePuzzles' canonical ranged-projectile hook.
// A chamber only completes after a real player plate hold or real projectile hits.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinLayerChallenges=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const TYPES=Object.freeze(['pressurePlate','glyphObelisk','ceilingRailTargets','melodyEcho','dungeonFire','ropeChain','statueDefense','findBlocks','timedMelody','fireSconces']);
  const boneTextures=new Map(); // Shared Scratchbone numeral textures for every generated melody decal.
  function scratchboneMaterial(THREE,texture,options,name){
    if(root.RuinMelodyGlyphDecal?.makeInkMaterial)
      return root.RuinMelodyGlyphDecal.makeInkMaterial(texture,options,name);
    const material=new THREE.MeshBasicMaterial({map:texture,...options});
    material.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
        #ifdef USE_MAP
          diffuseColor.a *= texture2D(map, vUv).a;
        #endif
      `); // Match the Witch-bomb engraving shader even if the standalone cave test omits the shared decal library.
    };
    return material;
  }
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
    if(kind==='findBlocks'){
      // A V50 push-block controller is available only after the generated ruin enters
      // the gameplay map. Delay installation instead of failing shaft construction.
      const bus=options.projectileBus||root.DevRandomRuinSimplePuzzles;
      const game=options.DevRandomRuin||root.DevRandomRuin;
      const DS=options.DynamicSurfaces||root.DynamicSurfaces;
      const scope='ruin-layer-find-blocks-'+id; // Each stage owns its own raised supports and can be disposed independently.
      const targets=[],disposers=[]; // Native projectile callbacks and their remover functions for this chamber only.
      let puzzle=null,failed=false;
      const rec={id,kind,solved:false,ready:false,linked:false,disposed:false,error:null};
      const seed=Array.from(String(id)).reduce((hash,ch)=>Math.imul(hash^ch.charCodeAt(0),16777619)>>>0,2166136261); // A reproducible mix of net and pillar mechanisms per wing.
      function setup(){
        if(rec.disposed||puzzle||failed||!isActive()
          ||bus?.hasActiveRuinState?.()!==true||!(game?.hasOccupancy?game.hasOccupancy():game?.getOccupancySnapshot?.()))return; // Presence check only: building the full snapshot sorts every floor cell and ran every frame.
        const player=getPlayerPosition?.(); // Deferred construction avoids eagerly mounting several heavy compound rooms on a story the player has just reached.
        if(!player||player.x<room.x-5||player.x>room.x+room.w+5
          ||player.z<room.z-5||player.z>room.z+room.d+5)return;
        try{
          const kit={
            state:{controls:[]},group:()=>parent,
            deps:{showToast:(message,ok)=>options.showToast?.(message,ok)},
            playerWorld:getPlayerPosition,
            addControl:control=>options.addControl?.(control),
            removeControl:control=>options.removeControl?.(control),
            registerSurface:surface=>DS.registerSurface({...surface,scope}),
            registerBlocker:blocker=>DS.registerBlocker({...blocker,scope}), // Every pillar, blocker and closed gate collides only at its authored wing elevation.
            registerProjectileTarget:target=>{targets.push(target);return target;},
            disposeObject:object=>{
              object.parent?.remove(object);
              const geometries=new Set(),materials=new Set();
              object.traverse?.(node=>{
                if(node.geometry&&!node.geometry.userData?.devRuinSharedPrimitive)geometries.add(node.geometry);
                for(const mat of Array.isArray(node.material)?node.material:[node.material])if(mat)materials.add(mat);
              });
              geometries.forEach(geo=>geo.dispose?.());
              materials.forEach(mat=>mat.dispose?.());
            }
          }; // The same native cube/fire/music/bomb implementation receives a layered-wing lifecycle adapter.
          puzzle=root.DevRuinFindBlocks?.create?.({
            THREE,kit,context:{seed,ceilingY:y+4.5},room,y,
            showGate:false,isActive,
            onSolved:()=>{if(!rec.disposed&&!rec.solved){rec.solved=true;onSolved(rec);}}
          });
          if(!puzzle)throw new Error('Find the Blocks module is unavailable.');
          rec.variant=puzzle.variant;rec.netVariant=puzzle.netVariant;rec.ready=true;rec.linked=targets.length===0;
          options.onLink?.(rec);
        }catch(error){
          DS?.clearScope?.(scope); // Roll back raised platforms and blockers if any native submodule failed during construction.
          targets.length=0; // No external ranged callbacks are installed before the chamber finishes building.
          failed=true;rec.error=String(error?.message||error);
          options.onError?.(rec); // Show the failure in the mobile dungeon diagnostics instead of silently generating a fake plate.
        }
      }
      rec.tick=dt=>{
        if(rec.disposed||!isActive())return;
        setup();
        if(!puzzle)return;
        if(targets.length&&!rec.linked){
          const next=[];
          for(const target of targets){
            const release=bus?.registerExternalProjectileTarget?.(target);
            if(typeof release!=='function')break;
            next.push(release);
          }
          if(next.length===targets.length){disposers.push(...next);rec.linked=true;options.onLink?.(rec);}
          else for(const remove of next)remove();
        }
        puzzle.tick?.(dt);
      };
      rec.snapshot=()=>puzzle?.snapshot?.()||{id,kind,ready:false,error:rec.error};
      rec.dispose=()=>{
        if(rec.disposed)return;rec.disposed=true;
        for(const release of disposers)release();
        puzzle?.dispose?.();
        DS?.clearScope?.(scope);
      };
      return rec;
    }
    if(kind==='statueDefense'){
      const defense=options.RuinLayerDefense||root.RuinLayerDefense; // Delegates authored statue and combat rules instead of duplicating their puzzle state.
      if(!defense?.create)throw new Error('Native RuinLayerDefense module is not installed.');
      return defense.create(options);
    }
    if(!THREE?.Mesh||!THREE?.MeshBasicMaterial||!parent?.add||!room||!TYPES.includes(kind)
      ||typeof isActive!=='function'||typeof onSolved!=='function')
      throw new Error('Invalid layered ruin challenge '+id+' ('+kind+').');
    const cx=room.x+room.w/2,cz=room.z+room.d/2;
    const caveGateZ=room.z+room.d-2.8; // Leave a genuinely reachable treasure alcove behind the slab; the whole door remains inside the carved nine-tile room.
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
    const plateMat=stone; // Interacting with the plate changes its rune, never the carved stone PNG.
    const bus=options.projectileBus||root.DevRandomRuinSimplePuzzles;
    const side=options.side||'E'; // Used by rope chambers to orient the traversal away from the shaft.
    const music=options.music||root.MusicMinigame; // Existing eight-note flute performance/puzzle bridge is authoritative.
    const fire=options.dungeonFire||root.DungeonFire; // Reuse real ranged-weapon ignition + projectile contact/heat checks.
    const events=options.events||root; // Reuses the standard hobunji-ruin-melody-result event, not a new music input bridge.
    let linkDisposers=[]; // Disposers are returned by the existing modular target hit registry.
    let timedNoteListener=null; // Every ruin/cave melody consumes only the player's real, plate-gated note events.
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
      rec.solved=true;
      rec.plateSignal?.setActive(true); // One completion path illuminates the native pressure plate and melody plate alike.
      onSolved(rec);
      return true;
    };
    function installTimedSession(composer,song){
      rec.scoreComposer=composer; // Both cave and ruin melodies share the same tempo, judge, glow and debug state.
      rec.song=song;
      rec.notes=song.notes.map(note=>note.index); // Kept for mobile diagnostics and older authored module consumers.
      rec.session=composer.createSession(song,{
        onBeat:beat=>root.RuinInteractionAudio?.metronomeTick?.(beat),
        onSolved:()=>complete(), // The instrument remains equipped; only the owning mechanism unlocks.
        onChanged:snapshot=>{
          if(snapshot.mistakes>(rec.melodyState?.mistakes||0)){
            rec.flashRemaining=.4;
            rec.flashGlyphIndex=snapshot.activeIndex>=0?snapshot.activeIndex:
              Math.min(song.notes.length-1,rec.melodyState?.progress||0);
          }
          rec.melodyState=snapshot;
          if(rec.flashRemaining>0)for(let i=0;i<(rec.glyphs||[]).length;i++)
            if(i===rec.flashGlyphIndex)composer.advanceGlyphGlow?.(rec.glyphs[i],{rejected:true,dt:0});
        }
      });
      timedNoteListener=event=>{
        const area=options.area||options.mapId; // A different map, inactive floor or unoccupied plate cannot feed this score.
        if(rec.disposed||rec.solved||!isActive()||(area&&event?.detail?.area!==area))return;
        rec.session.note(event?.detail?.noteIndex);
      };
      events?.addEventListener?.('hobunji-kurraya-puzzle-note',timedNoteListener);
    }
    // V50 square pillar (docs/tools/debris-ifier createPillarNicheShortObeliskActivator envelope): 0.78 x 1.75 with base, collar,
    // shaft, collar and capital. With `opening` the shaft is a hollow housing open on that side, so a glyph target sits in a niche.
    const squarePillar=(name,x,py0,z,opening=null)=>{
      const part=(w,h,d,ox,oy,oz,label)=>body(name+'-'+label,new THREE.BoxGeometry(w,h,d),stone,x+ox,py0+oy,z+oz);
      const first=part(.78,.11,.78,0,.055,0,'base');
      part(.64,.07,.64,0,.145,0,'collar');
      part(.58,.10,.58,0,1.56,0,'collar-top');
      part(.76,.14,.76,0,1.68,0,'capital');
      const SH=1.36,SY=.18+SH/2,W=.48,T=.055;
      if(!opening){part(W-.02,SH,W-.02,0,SY,0,'shaft');return first;}
      const dirs={north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]};
      for(const [side,[dx,dz]] of Object.entries(dirs)){
        if(side===opening)continue; // The open face is the niche.
        part(dx?T:W,SH,dz?T:W,dx*(W/2-T/2),SY,dz*(W/2-T/2),'wall-'+side);
      }
      return first;
    };
    const SIDE_NAMES=['south','east','north','west']; // Matches the side index used by target(): 0:+z, 1:+x, 2:-z, 3:-x.
    const target=(name,x,py,z,ceiling=false,side=0)=>{
      const SIDE=[[0,1],[1,0],[0,-1],[-1,0]][side&3],yaw=[0,Math.PI/2,Math.PI,-Math.PI/2][side&3]; // Which pillar face holds the glyph: hidden pillars hide it around the back.
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
        base=squarePillar(name,x,y,z,SIDE_NAMES[side&3]); // Hollow square pillar, open on one face; the glyph sits inside the niche.
        rune=body(name+'-rune-hit',new THREE.BoxGeometry(.34,.4,.12),stone,x-SIDE[0]*.06,py,z-SIDE[1]*.06);
        rune.rotation.y=yaw;
        hitMesh=rune;
        plaque=authored('ruinGlyphTarget',x+SIDE[0]*.0,py,z+SIDE[1]*.0);
        if(plaque){plaque.rotation.y=yaw;plaque.position.set(x-SIDE[0]*.03+SIDE[0]*.0,py,z-SIDE[1]*.03);plaque.scale.multiplyScalar(.62);} // Sized to the niche.
        if(plaque){
          // The real rune decal is visible while the transparent box remains the canonical projectile target.
          const invisible=basic(0xffffff);
          invisible.transparent=true;invisible.opacity=0;invisible.depthWrite=false;
          rune.material=invisible;
        }
      }
      const signal=!plaque&&!hanging?root.FurniturePatternSurfaces?.attachStoneSignal?.(rune,{
        face:'front',width:.42,height:.39,idleColor:'#fbaa48',activeColor:'#65ffaf',
      }):null; // Keep the target plaque stone constant and light only its PNG rune.
      const state={
        id:name,object:visualRoot||rune,hitMesh,active:false,
        hittable:()=>!rec.disposed&&!state.active&&isActive()&&(visualRoot||rune).visible
          &&Number.isFinite(Number(getPlayerY?.()))&&Math.abs(Number(getPlayerY())-y)<.9,
        onHit:()=>{
          if(state.active||rec.disposed||!isActive()
            ||!Number.isFinite(Number(getPlayerY?.()))||Math.abs(Number(getPlayerY())-y)>=.9)return;
          state.active=true;rec.hits++;
          if(hanging)hanging.setActive(true);
          else if(!plaque)signal?.setActive(true);
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
      rec.plateSignal=root.FurniturePatternSurfaces?.attachStoneSignal?.(surface,{width:.68,height:.68,idleColor:'#e8a957',activeColor:'#65ffaf'});
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
      // The abyss shows the ruin's own hazard: lava (Hronal), ice (Tothal) or plasm-dark oil (Kanthic) far below the ropes.
      const hazardColor={hronal:0xff4215,tothal:0xb7ecfa,kanthic:0x2a1a4a}[options.theme];
      if(hazardColor){
        const sheet=body('ruin-abyss-hazard-'+(options.theme||'')+'-'+id,
          new THREE.PlaneGeometry(pit.maxX-pit.minX,pit.maxZ-pit.minZ),basic(hazardColor),centerX,y-2.4,centerZ);
        sheet.rotation.x=-Math.PI/2;sheet.userData.devRuinAbyssHazard=options.theme;
      }
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
      const flameRoot=new THREE.Group(); // Reuses the player's campfire visual; no custom flame cones or alternative particle recipes.
      flameRoot.name='ruin-fire-flame-'+id;
      flameRoot.position.set(cx-2.3,y+1.2,cz);group.add(flameRoot);
      const flameVisual=(options.puzzleFireVisuals||root.PersistentGroundFire)?.attachCampfireFlame?.(flameRoot,{
        scale:.94,rateScale:.8,
      }); // AuthoredFurniture loads campfire_fire from the exact campfire furniture JSON.
      if(flameVisual)flameVisuals.push(flameVisual); // Shared update/dispose lifecycle below remains authoritative.
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
    }else if(kind==='fireSconces'){
      // Stone sconces must both be lit with real lingering world fire, not a
      // generic projectile hit. A fire flask or a Flame Shattercask will work.
      const gate=body('puzzle-cave-fire-door-'+id,
        new THREE.BoxGeometry(4.7,3.4,.32),stone,cx,y+1.75,caveGateZ);
      gate.userData.puzzleCaveDoor=true;
      rec.door=gate;rec.backdrop=null;rec.sconces=[];rec.doorRise=0; // The reward alcove is rendered through the actual opening.
      const gateY=gate.position.y; // Only the physical slab rises; the sconces remain on the stone wall.
      for(const [index,direction] of [-1,1].entries()){
        const px=cx+direction*2.55,pz=caveGateZ-.15; // Lit sconce vessels sit just in front of the shifted door and remain reachable by ground fire.
        const bracket=body('stone-sconce-'+id+'-'+index,
          new THREE.CylinderGeometry(.27,.32,.32,10),stone,px,y+1.20,pz);
        const flame=new THREE.Group(); // Real campfire particles replace the former opaque triangle/cone torch flame.
        flame.name='sconce-flame-'+id+'-'+index;
        flame.position.set(px,y+1.42,pz);
        flame.visible=false;
        group.add(flame);
        const visual=(options.puzzleFireVisuals||root.PersistentGroundFire)?.attachCampfireFlame?.(flame,{scale:.8,rateScale:.65}); // Shared campfire emitter palette, lifetime and rise speed.
        if(visual)flameVisuals.push(visual); // The cave's existing lifecycle ticks and disposes each torch's authored particles.
        bracket.userData.puzzleCaveSconce=true;
        rec.sconces.push({x:px,z:pz,flame,lit:false});
      }
      rec.animate=dt=>{
        if(!rec.solved||rec.disposed)return;
        rec.doorRise=Math.min(1,rec.doorRise+Math.max(0,Number(dt)||0)/.95);
        gate.position.y=gateY+3.5*rec.doorRise;
      };
    }else if(kind==='timedMelody'){
      // Cliff-door score: visible Scratchbone notation on a stone gate, no audible example.
      // The generated score's beat clock advances only while the player stays on the large plate.
      const composer=options.puzzleCaveMelody||root.PuzzleCaveMelody; // One generator/judge for both exterior and interior puzzle cave doors.
      if(!composer?.generate||!composer?.createSession)throw new Error('PuzzleCaveMelody is not installed.');
      const song=composer.generate(id,options.songOptions||{}); // The cave's stable ID fixes the tune and reward tier on reload.
      const plate=body('puzzle-cave-music-plate-'+id,
        new THREE.CylinderGeometry(1.18,1.18,.15,32),plateMat,cx,y+.08,cz-1.6);
      rec.plate=plate;rec.attempts=0;rec.lastDown=false;
      rec.melodyPlate={x:cx,z:cz-1.6,radius:1.18}; // Cave melody uses the large circular bronze plate.
      const plateSignal=root.FurniturePatternSurfaces?.attachStoneSignal?.(plate,{width:.32,height:.32,idleColor:'#e5aa55',activeColor:'#65ffaf'});
      rec.plateSignal=plateSignal; // Both the musical session and an external result use the same glyph state.
      rec.plateArt=root.PuzzleCavePlateArt?.decorate?.(THREE,plate,{
        radius:1.18,thickness:.15,toward:{x:0,z:1}
      })||null; // Furniture-textured stone, inscribed with hao'uun in the Tankan author font.
      const gate=body('puzzle-cave-stone-door-'+id,
        new THREE.BoxGeometry(4.7,3.4,.32),stone,cx,y+1.75,caveGateZ);
      gate.userData.puzzleCaveDoor=true;
      rec.door=gate;rec.backdrop=null;rec.glyphs=[];rec.scorePanel=null;rec.inscription=null; // Walk-through gate: no fake portal mesh.
      // The inscription is placed on an unmoving stone flank after its fused wall has been constructed.
      const baseY=gate.position.y; // Door opening lifts the slab and its inscriptions, exposing the real cave.
      rec.animate=dt=>{
        if(!rec.solved)return;
        rec.doorRise=Math.min(1,(rec.doorRise||0)+Math.max(0,Number(dt)||0)/.85);
        gate.position.y=baseY+3.6*rec.doorRise;
      };
      installTimedSession(composer,song);
    }else if(kind==='melodyEcho'){
      // Read the inscription and play the ordinary equipped instrument; the plate never opens or claims input.
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
      const visiblePlate=plateSkin?.userData?.meshById?.get?.('plate')||plate; // Prefer the actual authored stone face when available.
      rec.plateSignal=root.FurniturePatternSurfaces?.attachStoneSignal?.(visiblePlate,{
        width:.54,height:.54,idleColor:'#82d8b7',activeColor:'#ffe18a',
      }); // Only the melody plate's glyph changes on completion; the carved stone remains neutral.
      const composer=options.puzzleCaveMelody||root.PuzzleCaveMelody; // Legacy echo placements now use the timed-score generator and judge.
      if(!composer?.generate||!composer?.createSession)throw new Error('PuzzleCaveMelody is not installed.');
      const song=composer.generate(id,options.songOptions||{});
      rec.notes=song.notes.map(note=>note.index);
      rec.melodyPlate={x:cx,z:cz,radius:.72}; // Preserve the native square trigger's original footprint.
      rec.lastDown=false;rec.attempts=0;
      rec.heardNotes=[];rec.glyphs=[]; // Rolling player-note history and owned fallback art for native challenge diagnostics.
      rec.inscription=root.RuinMelodyGlyphDecal?.create?.({
        root:group,plate:{x:cx,y,z:cz},notes:rec.notes,
        bounds:{minX:room.x,maxX:room.x+room.w,minZ:room.z,maxZ:room.z+room.d},
        sampleSupport:()=>({y}),surfaces:options.melodySurfaces||[],surfaceRoot:options.surfaceRoot,
        seed:melodyFor(id).reduce((sum,n)=>sum*8+n,0),
      });
      if(!rec.inscription&&THREE.TextureLoader&&THREE.PlaneGeometry){
        // Standalone layered rooms may load without the random-ruin decal module.
        for(let i=0;i<rec.notes.length;i++){
          const number=rec.notes[i]+1;
          let texture=boneTextures.get(number); // Shared immutable textures, with per-challenge glowing sprite materials.
          if(!texture){
            texture=new THREE.TextureLoader().load('assets/hud/scratchbone'+number+'.png');
            root.HobunjiSpritePngSurface?.configureTexture?.(THREE,texture,'ruin-melody-'+number);
            boneTextures.set(number,texture);
          }
          const appearance={color:0xffda70,transparent:true,depthWrite:false,side:THREE.DoubleSide}; // Unlit glyphs stay luminous in dark ruins.
          const material=scratchboneMaterial(THREE,texture,appearance,'ruin-melody-'+number);
          materials.push(material);
          const decal=body('scratchbone-note-'+id+'-'+i,new THREE.PlaneGeometry(.65,.75),material,
            cx-(i-(rec.notes.length-1)/2)*.8,y+1.8,room.z+.55);
          decal.rotation.y=Math.PI;decal.visible=false; // Upright and facing south toward the plate, rather than a mirrored rear face.
          decal.userData.devRuinScratchboneMelodyNote=number;rec.glyphs.push(decal);
        }
      }
      if(rec.inscription)rec.glyphs=rec.inscription.group.children.filter(node=>
        node.userData?.melodyNoteIndex!==undefined); // Exact note order, with the same fixed-size glow planes as the timed cave.
      installTimedSession(composer,song);
    }else if(kind==='glyphObelisk'){
      // The old pillar hall: a field of stone pillars, most of them plain. Three hide a
      // glyph target in a niche on one face (a different face each, so you must walk
      // around them) and every unstruck target hums, louder the closer you get
      // (dev-random-ruin-target-hum). Pillars are solid. Each target is a real projectile
      // target that uses the existing ranged weapon's world-space hit sweep.
      const DS=options.DynamicSurfaces||root.DynamicSurfaces,scope='ruin-layer-glyph-'+id;
      let seed=Array.from(String(id)).reduce((h,ch)=>Math.imul(h^ch.charCodeAt(0),16777619)>>>0,2166136261);
      const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      const margin=3.2,pitch=2.8; // Wide margin keeps the doorways and their approach clear.
      const cols=Math.max(2,Math.floor((room.w-margin*2)/pitch)+1),rows=Math.max(2,Math.floor((room.d-margin*2)/pitch)+1);
      const slots=[];
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
        const px=cx+(c-(cols-1)/2)*pitch+(rnd()-.5)*.5,pz=cz+(r-(rows-1)/2)*pitch+(rnd()-.5)*.5;
        slots.push({x:px,z:pz});
      }
      for(let i=slots.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[slots[i],slots[j]]=[slots[j],slots[i]];}
      const hidden=Math.min(3,Math.max(1,slots.length-1));
      const footprintBoxes=[]; // Same boxes for ground movement (AreaFootprintBlockers): walking, dodges and lunges query THAT registry, not DynamicSurfaces.
      let blockerSerial=0;
      const block=(px,pz,height)=>{footprintBoxes.push({minX:px-.4,maxX:px+.4,minZ:pz-.4,maxZ:pz+.4,top:y+height});return DS?.registerBlocker?.({id:scope+'-pillar-'+(blockerSerial++),scope,
        bounds:{minX:px-.4,maxX:px+.4,minZ:px-.4,maxZ:px+.4}, // DynamicSurfaces reads the footprint from `bounds`; bare minX/maxX meant an infinite, map-wide wall.
        enabled:()=>!rec.disposed&&isActive(),
        blocksAt:(_x,_z,_h,_r,_radius,query)=>{ // Solid only from the floor up to the pillar top, and only on this story.
          const elevation=Number(query?.y??query?.floorY??query?.worldY);
          return !Number.isFinite(elevation)||(elevation>=y-.4&&elevation<=y+height);
        }});};
      slots.forEach((slot,index)=>{
        if(index<hidden){
          const t=target(id+'-glyph'+index,slot.x,y+.95,slot.z,false,Math.floor(rnd()*4));
          block(slot.x,slot.z,2.4);
          return t;
        }
        const height=1.75;
        squarePillar(id+'-pillar'+index,slot.x,y,slot.z);
        block(slot.x,slot.z,height);
      });
      rec.pillarScope=DS?scope:null;
      const footprint=options.AreaFootprintBlockers||root.AreaFootprintBlockers;
      const footprintArea=options.area||options.mapId||'map_i_dev_random_ruin';
      rec.removePillarFootprints=footprint?.register?.(scope,{area:footprintArea,
        enabled:()=>!rec.disposed&&isActive(),
        blocksBox:(bx,bz,half,worldY)=>{
          const feet=Number(getPlayerY?.());
          for(const b of footprintBoxes){
            if(bx+half<=b.minX||bx-half>=b.maxX||bz+half<=b.minZ||bz-half>=b.maxZ)continue;
            if(worldY!=null){if(worldY<y-.4||worldY>b.top+.05)continue;}
            else if(Number.isFinite(feet)&&Math.abs(feet-y)>2.5)continue; // A walker on another story is not on this floor's pillars.
            return true;
          }
          return false;
        }});
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
    if(options.authoredCliffDoor&&(kind==='timedMelody'||kind==='fireSconces')){
      // The playable cave gate occupies a genuine rough-hewn hole in a single
      // roof-height rock wall. The slab rises independently; after opening the
      // exposed jambs/lintel remain stone, not clipped boulders or a black card.
      const surround=root.CavernOreRocks?.carveStoneGate?.(group,{
        x:cx,y,z:caveGateZ+.42,openingWidth:4.78,openingHeight:3.55,
        sideThickness:Math.max(.6,room.w-4.78),roofHeight:9,wallDepth:.30, // The stone flanks seal the ENTIRE chamber width, not merely the doorframe.
      }); // Slightly behind the slab so sconces and score glyphs remain visible in front.
      if(surround){owned.push(surround);rec.rockSurround=surround;}
    }
    if(options.authoredCliffDoor && kind==='timedMelody'){
      const notes=rec.song.notes.map(note=>note.index); // Musical timing and sequence remain authored by PuzzleCaveMelody.
      const rows=Math.ceil(notes.length/2),postHeight=rows*.35+.42; // One vertical glyph column per stone post.
      const offset=Math.min(room.w/2-.65,Math.max(2.75,4.78/2+.40)); // Mirrored beyond the actual 4.78-wide opening, never in the passage.
      const postZ=caveGateZ-.45; // Fixed freestanding posts slightly ahead of the irregular cave wall.
      const posts=[{x:cx+offset,z:postZ},{x:cx-offset,z:postZ}]; // Visual left then right when seen from the south-facing pressure plate.
      const scoreRoot=new THREE.Group();
      scoreRoot.name='puzzle-cave-symmetric-note-columns';
      group.add(scoreRoot);scoreRoot.visible=false; // Only glyphs are revealed by the plate; both stone pillars remain physically present.
      for(const [index,post] of posts.entries()){
        body('puzzle-cave-melody-pillar-'+index,
          new THREE.BoxGeometry(.52,postHeight,.45),stone,post.x,y+postHeight/2,post.z);
        for(const [part,width,height,depth,dy] of [
          ['base',.68,.10,.57,.05],
          ['cap',.66,.11,.55,postHeight-.055],
        ])body('puzzle-cave-melody-pillar-'+part+'-'+index,
          new THREE.BoxGeometry(width,height,depth),stone,post.x,y+dy,post.z);
      } // Matching plinths and capitals identify the paired columns as one deliberately built puzzle fixture.
      const inscriptions=posts.map((post,column)=>root.RuinMelodyGlyphDecal?.create?.({
        root:scoreRoot,plate:{x:cx,y,z:cz-1.6},
        notes:notes.filter((_,index)=>index%2===column),maxColumns:1,
        surfaces:[{x:post.x,y:y+postHeight/2,z:post.z-.254,yaw:Math.PI}],
        sampleSupport:()=>({y}),
        makeStoneMaterial:()=>new THREE.MeshBasicMaterial({color:0x777267,transparent:true,opacity:0,depthWrite:false}),
      })||null); // Explicit faces on authored standing pillars, never a cave wall or the unpredictable floor.
      if(inscriptions.every(Boolean)){
        const columns=inscriptions.map(inscription=>inscription.group.children.filter(node=>
          node.userData?.melodyNoteIndex!==undefined));
        rec.glyphs=notes.map((_,index)=>columns[index%2][Math.floor(index/2)]);
        rec.inscription={
          group:scoreRoot,
          setVisible(visible){
            scoreRoot.visible=!!visible;
            inscriptions.forEach(inscription=>inscription.setVisible(visible));
          },
          dispose(){inscriptions.forEach(inscription=>inscription.dispose());scoreRoot.parent?.remove(scoreRoot);},
          diagnostics:()=>({kind:'pillarPair',posts:posts.map(post=>({...post})),
            columns:inscriptions.map(inscription=>inscription.diagnostics?.())}),
        }; // Keep the existing plate-gated, disposable inscription interface and chronological glyph indices.
      }else{
        inscriptions.forEach(inscription=>inscription?.dispose?.());
        // Minimal browser/headless fallback retains the *same paired pillar locations*, never a rock-face decal.
        const board=new THREE.Group();
        board.name='puzzle-cave-fallback-score';
        board.visible=false;group.add(board);rec.scorePanel=board;
        scoreRoot.parent?.remove(scoreRoot);
        notes.forEach((index,i)=>{
          const number=index+1;
          let texture=boneTextures.get(number);
          if(!texture&&THREE.TextureLoader){
            texture=new THREE.TextureLoader().load('assets/hud/scratchbone'+number+'.png');
            root.HobunjiSpritePngSurface?.configureTexture?.(THREE,texture,'puzzle-cave-note-'+number);
            boneTextures.set(number,texture);
          }
          const mat=scratchboneMaterial(THREE,texture||null,{color:0xffb35e,transparent:true,
            depthWrite:false,side:THREE.DoubleSide},'cave-note-'+number);
          materials.push(mat);
          const glyph=new THREE.Mesh(new THREE.PlaneGeometry(.25,.28),mat);
          const column=i%2,row=Math.floor(i/2);
          glyph.position.set(posts[column].x,y+postHeight/2+(rows-1)/2*.35-row*.35,postZ-.254);
          if(glyph.rotation)glyph.rotation.y=Math.PI; // The browser mesh always has Euler rotation; headless fixture may not.
          glyph.name='puzzle-cave-timed-note-'+i;glyph.userData.melodyNoteIndex=index;
          glyph.userData.puzzleCaveNote={index,duration:rec.song.notes[i].lengthTicks};
          board.add(glyph);owned.push(glyph);rec.glyphs.push(glyph);
        });
      }
    }
    if(options.authoredCliffDoor && (kind==='timedMelody'||kind==='fireSconces')){
      // Use the real authored, lightly rockified cliff gate (frame, stone slab,
      // and 0.95-second slab motion). No black backdrop or interactive puzzle metadata
      // is registered on this visual; only this encounter's judge can open it.
      const furniture=root.AuthoredFurniture;
      Promise.resolve(furniture?.load?.('cliffGate')).then(data=>{
        if(rec.disposed||!data||!furniture?.buildGroup||!rec.door?.parent)return;
        const cleanGate={...data,parts:(data.parts||[]).filter(part=>part.id!=='cliff_gate_darkness'),puzzle:null}; // No black backing even if a stale authored asset is cached.
        const model=furniture.buildGroup(cleanGate); // Disable direct-interaction bypass on the puzzle-locked gate.
        const slab=model.userData?.meshById?.get?.('cliff_gate_slab');
        const motion=data.puzzle?.motion?.parts?.cliff_gate_slab;
        if(!slab||!motion)return;
        const gateZ=caveGateZ; // Authored gate and all wall-mounted puzzle fixtures share one offset.
        model.position.set(cx,y,gateZ);
        model.scale.setScalar(3); // The wide authored gate becomes a legible multi-glyph puzzle-door rather than a tiny prop.
        group.add(model);
        rec.authoredGate=model;
        rec.door.visible=false; // The modeled slab/frame replace the placeholder when the JSON is ready.
        const off=motion.off,on=motion.on;
        const updateAuthoredDoor=()=>{
          const progress=Math.max(0,Math.min(1,Number(rec.doorRise)||0));
          const ease=progress*progress*(3-2*progress);
          slab.position.y=off.y+(on.y-off.y)*ease;
          slab.scale.z=off.sz+(on.sz-off.sz)*ease;
        };
        const priorAnimation=rec.animate;
        rec.animate=dt=>{priorAnimation?.(dt);updateAuthoredDoor();};
        updateAuthoredDoor(); // A solved save that loads the model late still shows a fully raised gate.
      }).catch(error=>root.__farmLog?.('[puzzle-cave] authored cliff gate unavailable: '+error.message,'warn'));
    }
    if((kind==='timedMelody'||kind==='fireSconces')&&options.area){
      const DS=options.DynamicSurfaces||root.DynamicSurfaces;
      const footprint=options.AreaFootprintBlockers||root.AreaFootprintBlockers; // game.js player movement and NPC pathing actually query this registry.
      const gateZ=caveGateZ; // Collider follows the shifted visual exactly; no invisible wall where the old slab stood.
      const bounds={minX:cx-2.35,maxX:cx+2.35,minZ:gateZ-.18,maxZ:gateZ+.18}; // One shared physical footprint for both collision APIs.
      const gateClosed=()=>!rec.disposed&&isActive()&&(!rec.solved||(Number(rec.doorRise)||0)<.98); // Both registries open together only after the animated slab rises.
      rec.colliderId='puzzle-cave-interior-gate:'+options.area+':'+id;
      if(options.authoredCliffDoor){
        const stoneWidth=room.w; // Physical, unbreakable rock shoulders match the carved surface spanning the nine-tile chamber.
        const passageHalfWidth=2.39; // Half the 4.78-tile sculpted opening; only this central opening may ever become walkable.
        const stoneBounds={minX:cx-stoneWidth/2,maxX:cx+stoneWidth/2,
          minZ:gateZ-.32,maxZ:gateZ+.75}; // Cover the sculpted wall at z=gateZ+.42, including its front/back rock faces.
        const flankAt=(px,pz,half,elevation)=>{
          if(Number.isFinite(elevation)&&(elevation<y-.5||elevation>y+9))return false;
          if(px+half<stoneBounds.minX||px-half>stoneBounds.maxX
            ||pz+half<stoneBounds.minZ||pz-half>stoneBounds.maxZ)return false;
          return px-half<cx-passageHalfWidth||px+half>cx+passageHalfWidth;
        }; // The stone remains solid after the slab rises; the player cannot walk around the door.
        rec.stoneColliderId=rec.colliderId+':permanent-rock';
        if(DS?.registerBlocker)DS.registerBlocker({
          id:rec.stoneColliderId,scope:'puzzle-cave-stone:'+options.area,
          bounds:stoneBounds,enabled:()=>!rec.disposed&&isActive(),
          blocksAt:(px,pz,_h,_record,radius,query)=>flankAt(px,pz,Math.max(0,Number(radius)||0),
            Number(query?.y??query?.floorY??query?.worldY)),
        });
        if(footprint?.register)rec.removeStoneFlanks=footprint.register(rec.stoneColliderId,{
          area:options.area,enabled:()=>!rec.disposed&&isActive(),
          blocksBox:flankAt,
        });
      }

      if(DS?.registerBlocker){
        DS.registerBlocker({
          id:rec.colliderId,scope:'puzzle-cave-interior:'+options.area,
          bounds,enabled:gateClosed,
          blocksAt:(_x,_z,_h,_r,_radius,query)=>{
            const elevation=Number(query?.y??query?.floorY??query?.worldY);
            return !Number.isFinite(elevation)||(elevation>=y-.4&&elevation<=y+3.55); // The locked 3.4-tile slab blocks airborne movement below its actual top, not just the first 1.4 tiles.
          },
        });
      }
      if(footprint?.register){
        rec.removeFootprintGate=footprint.register(rec.colliderId,{
          area:options.area,enabled:gateClosed,
          blocksBox:(x,z,half,worldY)=>{
            if(Number.isFinite(worldY)&&(worldY<y-.4||worldY>y+3.55))return false; // Airborne shots clear the slab only above its actual stone top.
            return x+half>=bounds.minX&&x-half<=bounds.maxX
              &&z+half>=bounds.minZ&&z-half<=bounds.maxZ; // The game queries square actor footprints, not point-only dynamic hits.
          },
        });
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
        root.RuinInteractionAudio?.watchPlate?.(rec.plate,!!standing); // Audible weight-on/weight-off without replaying during the hold timer.
        rec.elapsed=standing?rec.elapsed+Math.min(.05,Math.max(0,dt)):0;
        if(rec.elapsed>=rec.requiredSeconds){rec.plate.material=hit;complete();}
      }
      if(kind==='fireSconces'&&!rec.solved&&isActive()){
        const fireZones=options.groundFire||root.PersistentGroundFire;
        for(const sconce of rec.sconces){
          if(sconce.lit||!fireZones?.intersects?.(options.area,sconce.x,sconce.z,.16))continue;
          sconce.lit=true;sconce.flame.visible=true; // Lights persist after the ground patch burns out.
          root.RuinInteractionAudio?.igniteTorch?.(); // Play the large recorded ignition at the actual flame transition.
          options.onSconceLit?.(rec,sconce);
        }
        if(rec.sconces.every(sconce=>sconce.lit))complete();
      }
      if(kind==='timedMelody'||kind==='melodyEcho'){
        const plate=rec.melodyPlate; // The cave and every former echo use their own existing plate footprint.
        const down=!rec.solved&&isActive()&&player&&Number.isFinite(currentY)&&Math.abs(currentY-y)<.75
          &&Math.hypot(player.x-plate.x,player.z-plate.z)<=plate.radius;
        rec.session.step(dt,down); // Only an occupied plate advances the timed score; wrong or late notes reset an attempt.
        rec.flashRemaining=Math.max(0,(rec.flashRemaining||0)-Math.max(0,Number(dt)||0));
        const glowState=rec.session.snapshot();
        for(let i=0;i<rec.glyphs.length;i++){
          const glyph=rec.glyphs[i],rejected=rec.flashRemaining>0&&i===rec.flashGlyphIndex;
          if(rec.scoreComposer?.advanceGlyphGlow)rec.scoreComposer.advanceGlyphGlow(glyph,{
            current:i===glowState.activeIndex,accepted:i<glowState.progress,rejected,dt,
          });
          else glyph.material?.color?.setHex?.(rejected?0xff6666:i<glowState.progress?0x80ffbb:
            i===glowState.activeIndex?0xffec64:0xeaf5ff);
          if(!rec.inscription&&!rec.scorePanel)glyph.visible=!!down; // Standalone fallback glyphs lack a shared group.
        }
        rec.inscription?.setVisible?.(down);
        if(rec.scorePanel)rec.scorePanel.visible=!!down;
        if(down&&!rec.lastDown)rec.attempts++;
        root.RuinInteractionAudio?.watchPlate?.(rec.plate,!!down);
        rec.lastDown=!!down;
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
        if(!ropeChain&&bus?.hasActiveRuinState?.()!==true)rec.error='Native rope controller is not attached to this ruin scene';
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
      rec.removePillarFootprints?.();
      if(rec.pillarScope)(options.DynamicSurfaces||root.DynamicSurfaces)?.clearScope?.(rec.pillarScope); // The pillar hall's solid blockers.
      rec.removeStoneFlanks?.(); // Unregister permanent stone flanks along with their carved scene mesh.
      if(rec.stoneColliderId)(options.DynamicSurfaces||root.DynamicSurfaces)?.remove?.(rec.stoneColliderId);
      rec.removeFootprintGate?.(); // Release the real player/NPC occupancy blocker before this scene is reused.
      if(rec.colliderId)(options.DynamicSurfaces||root.DynamicSurfaces)?.remove?.(rec.colliderId); // One owner for both collision removal and room teardown.
      if(ropeChain)bus?.removeExternalRopeChain?.(ropeChain);
      rec.inscription?.dispose?.();
      if(timedNoteListener)events?.removeEventListener?.('hobunji-kurraya-puzzle-note',timedNoteListener);
      rec.plateArt?.dispose?.(); // Retire async Tankan lettering without affecting the player's own instrument session.
      if(rec.plateArt)rec.plate?.material?.dispose?.(); // Author-textured plate material is owned by this challenge, not the shared furniture texture.
      for(const emitter of flameVisuals)emitter.dispose?.();
      flameVisuals=[];
      if(icePlacement)root.DungeonDoorIceCoverage?.clear?.(icePlacement);
      group.parent?.remove(group);
      if(rec.authoredGate){
        // Authored furniture is built asynchronously with fresh per-part meshes.
        // These are not in 'owned'; release their geometry/material on cave scene
        // retirement while keeping the globally cached shared PNG textures alive.
        rec.authoredGate.traverse?.(node=>{
          if(!node.isMesh)return;
          node.geometry?.dispose?.();
          for(const material of Array.isArray(node.material)?node.material:[node.material])
            material?.dispose?.();
        });
        rec.authoredGate=null;
      }
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
