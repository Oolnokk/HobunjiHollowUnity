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
    if(!room||room.kind!=='challenge-room'||room.w<12||room.d<12||!SAFE_CHALLENGES.has(room.challenge))return null;
    const id=String(seed)+':'+String(room.id);
    const kindRoll=unit(id+':kind'),nestRoll=unit(id+':nest');
    if(kindRoll>=.38&&nestRoll>=.16)return null;
    const kinds=['pillar','closet','suspended'];
    const kind=kindRoll<.38?kinds[hash(id+':style')%kinds.length]:null;
    if(kind==='closet'&&(room.w<14||room.d<14))return null; // A main puzzle's central footprint must be clear of the optional alcove trigger.
    return {id:'secret-'+room.id,roomId:String(room.id),theme:theme||'hronal',
      corner:hash(id+':corner')%4,kind,trigger:['projectile','fire','melody'][hash(id+':trigger')%3],
      suspension:hash(id+':cover')%2?'ice':'net',tier:unit(id+':tier')<.77?1:2,
      babies:nestRoll<.16?1+hash(id+':babies')%3:0};
  }
  function create(options={}){
    const {room,seed,theme,parent,THREE,getPlayerPosition,getPlayerY,addControl,removeControl}=options;
    const spec=planForRoom(room,seed,theme);
    if(!spec||!parent||!THREE?.Group)return null;
    if(options.allowBrood===false){ // Large ruins use a bounded number of GPU-heavy individual flying rigs.
      spec.babies=0;
      if(!spec.kind)return null; // A nest-only roll is empty once the brood budget is exhausted.
    }
    const chests=root.DevRandomRuinDungeonChests; // Canonical chest locks, world-save open flags and loot ownership.
    const DS=options.DynamicSurfaces||root.DynamicSurfaces; // Ordinary room collision, not a new pathing layer.
    const bus=root.DevRandomRuinSimplePuzzles; // Canonical swept projectile intersections and target hum.
    const fire=root.DungeonFire; // Lit torch melee and flaming projectile contact share this one receiver.
    const area=options.mapId||MAP_ID; // Scope collision and ignition to the owning ruin.
    const floor=Number(room.y)||0; // The real stone floor anchors every bonus switch, chest, cover and hatchling plinth.
    const supportedSite=(corner,dx,dz)=>{
      const left=(corner&1)===0,top=(corner&2)===0;
      const x=(left?room.x:room.x+room.w)+(left?dx:-dx);
      const z=(top?room.z:room.z+room.d)+(top?dz:-dz);
      if(x<room.x+.55||x>room.x+room.w-.55||z<room.z+.55||z>room.z+room.d-.55)return false;
      const sample=DS?.sampleSupport?.(x,z,{minY:floor-.16,maxY:floor+.16,pad:.025});
      if(typeof DS?.sampleSupport==='function'&&(!sample||Math.abs(Number(sample.y)-floor)>.12))return false;
      return root.DevRandomRuinTileOccupancy?.solidAt?.(x,z,.22,floor)!==true;
    }; // Existing physical support and collision, not visual mesh height, decide whether a reward puzzle can spawn.
    const requiredSites=spec.kind==='closet'
      ?[[1.55,1.55],[2.6,2.55],[3.3,1.95],[4.6,3.4]]
      :spec.kind==='suspended'?[[1.55,1.55],[2.6,2.55],[2.50,2.35]]
      :[[1.55,1.55],[2.6,2.55]];
    let chosenCorner=-1; // Try all four authored corner orientations before giving up rather than leaving a floating plate.
    for(let offset=0;offset<4;offset++){
      const corner=(spec.corner+offset)%4;
      if(requiredSites.every(([x,z])=>supportedSite(corner,x,z))){chosenCorner=corner;break;}
    }
    if(spec.kind&&chosenCorner<0)return null;
    if(chosenCorner>=0)spec.corner=chosenCorner;
    if(spec.babies>0&&!supportedSite(spec.corner,room.w-1.2,room.d-1.2))spec.babies=0;
    if(!spec.kind&&!spec.babies)return null;
    const group=new THREE.Group();
    group.name='ruin-hidden-discoveries-'+room.id;parent.add(group);
    const left=(spec.corner&1)===0,top=(spec.corner&2)===0;
    const sx=left?1:-1,sz=top?1:-1;
    const edgeX=left?room.x:room.x+room.w,edgeZ=top?room.z:room.z+room.d;
    const at=(dx,dz)=>({x:edgeX+sx*dx,z:edgeZ+sz*dz});
    const center=at(1.55,1.55),mouth=at(3.3,1.95);
    const stoneFinish=(color,filled=true,opacity=1)=>{
      const finish=root.ProceduralFurniture?.makePartMaterial?.({
        materialTexture:'carved_smooth.png',materialLighting:'unlit',
        materialFillEnabled:filled,materialFillColor:filled?color:null,
        materialFillMode:filled?'always':'never',color,
        surfaceOpacity:opacity,textureTransparent:opacity<1,
      }); // Reuse V50's authored stone texture and its actual color-fill workflow, not flat basic-material boxes.
      return finish||new THREE.MeshBasicMaterial({
        color,transparent:opacity<1,opacity,depthWrite:opacity>=1,
      }); // Headless fixture fallback: production has the real furniture texture factory.
    };
    const mat=stoneFinish('#777267',false); // Main room masonry and puzzle plinths use untouched carved_smooth.png.
    const dark=stoneFinish('#4d3831'); // Native V50 door slab tint on the same carved-stone texture.
    const accent=stoneFinish('#b08d57'); // The main treasure/glyph mechanisms' bronze-coloured stone.
    const ice=stoneFinish('#bcecff',true,.72); // Texture-backed translucent fallback if the authored ice growth system is absent.
    const materials=[mat,dark,accent,ice]; // Only these per-secret authored finishes belong to the optional room puzzle.
    const colliders=[]; // Shared volume records for the movement and dynamic-surface queries.
    const surfaces=[]; // Pressure-plate support is removed independently of the solid props.
    const removeFootprints=root.AreaFootprintBlockers?.register?.(spec.id,{
      area,
      blocksBox:(x,z,half,worldY)=>{
        const probeY=worldY??getPlayerY?.()??NaN; // Walking uses ground support. Projectiles pass their actual height.
        for(const record of colliders){
          const {bounds,minY,maxY}=record; // Skip distant props before reading their animated state.
          if(x+half>bounds.minX&&x-half<bounds.maxX&&z+half>bounds.minZ&&z-half<bounds.maxZ
            &&probeY+half>=minY&&probeY-half<maxY&&record.enabled())return true;
        }
        return false;
      },
    });
    const controls=[]; // Interactions participate in the existing ruin resolver and its teardown.
    const links=[]; // Projectile and fire target disposers, tied to this room's lifetime.
    const art=[]; // Asynchronously loaded baby rigs and audio emitters that have their own dispose().
    const rec={...spec,group,unlocked:!spec.kind,linked:false,disposed:false,discovered:false,
      gateProgress:0,chest:null,nest:null,targets:[],fireId:null,melody:null,notes:[],
      x:center.x,z:center.z,y:floor};
    const box=(name,w,h,d,x,y,z,material=mat)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
      mesh.name=name;mesh.position.set(x,y,z);
      mesh.userData.devRuinFootprintIgnore=true;
      mesh.userData.ruinSecretTexturedStone=true; // Pixel Probe/scene inspection can distinguish authored PNG stone from geometry-only placeholders.
      group.add(mesh);
      const initialGeometry=mesh.geometry; // Dispose a replaced primitive if the shared surface mapper rebuilds its UV mesh.
      root.HobunjiSurfaceStretchUV?.mapMesh?.(mesh,{
        label:'ruin-side-treasure-stone',maxPatchWorldSize:6,
      }); // Match the main puzzle's connected-face UV mapping even on tall columns and narrow gates.
      if(mesh.geometry!==initialGeometry)initialGeometry.dispose?.();
      return mesh;
    };
    const registerControl=control=>{if(!control)return;addControl?.(control);controls.push(control);};
    function blocker(name,x,z,w,d,height,enabled=()=>true){
      const record={
        id:rec.id+':'+name,scope:'ruin-hidden-secrets',
        bounds:{minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2},
        minY:floor,maxY:floor+height,
        enabled:()=>!rec.disposed&&enabled(),
        blocksAt:(_x,_z,actorHeight,_record,radius,query)=>{
          const y=query?.worldY??query?.y??query?.floorY??getPlayerY?.(); // Dynamic queries can include the pusher's height.
          return Number.isFinite(y)&&y+Math.max(actorHeight,radius)>=floor&&y-radius<floor+height;
        },
      };
      DS?.registerBlocker?.(record);
      colliders.push(record);
    }
    function unlock(){
      if(rec.unlocked||rec.disposed)return false;
      rec.unlocked=true;
      if(rec.chest)rec.chest.secretRevealed=true;
      if(rec.kind!=='closet')rec.gateProgress=1; // Freestanding mechanisms reveal a grounded chest immediately; only a real stone door animates.
      if(rec.kind==='suspended'&&rec.cover)rec.cover.visible=false; // Grounded cage or ice cover breaks open without suspending the reward.
      root.RuinInteractionAudio?.mechanism?.(rec.gate||rec.cover||rec.group,{size:2});
      options.onStateChange?.();
      return true; // Do not touch wing objective/gate state: this is always optional.
    }
    function chestAt(x,z,y){
      if(!chests?.create)return null;
      const chest=chests.create({id:rec.id+':chest',parent:group,x,z,y,tier:spec.tier,theme:spec.theme,secret:true});
      if(chest){
        rec.chest=chest;
        chest.group.userData.devRuinFootprintManaged=true; // The chest keeps one stable body collider while its lid opens.
        blocker('chest',x,z,.8,.54,.42);
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
    function fireAt(x,z,source){
      const sourceBase=box('secret-lit-brazier-base-'+rec.id,.66,.42,.66,source.x,floor+.21,source.z);
      box('secret-lit-brazier-bowl-'+rec.id,.70,.18,.70,source.x,floor+.51,source.z,dark);
      const flame=new THREE.Group(); // Same authored campfire particles as the main ruin fire challenge.
      flame.position.set(source.x,floor+.61,source.z);group.add(flame);
      const contact=new THREE.Mesh(new THREE.BoxGeometry(.72,.94,.72),new THREE.MeshBasicMaterial({visible:false}));
      contact.name='Secret alcove fire source';
      contact.position.set(0,.33,0);contact.userData.fireHazard=true;
      contact.userData.devRuinFootprintIgnore=true;sourceBase.add(contact);
      rec.ignitionSource=source; // Pixel Probe reports the available flame's coordinates.
      rec.sourceFlame=root.PersistentGroundFire?.attachCampfireFlame?.(flame,{scale:.9,rateScale:.8})||null;
      blocker('fire-source',source.x,source.z,.70,.70,.60);
      blocker('brazier',x,z,.82,.82,.90);
      box('secret-brazier-grounded-base-'+rec.id,.82,.54,.82,x,floor+.27,z);
      const vessel=box('secret-unlit-brazier-'+rec.id,.6,.32,.6,x,floor+.69,z,accent);
      const ember=box('secret-brazier-ember-'+rec.id,.4,.08,.4,x,floor+.89,z,dark);
      rec.fireVessel=vessel;rec.ember=ember;
      rec.fireRecord={id:rec.id+':fire',object:vessel,active:true,
        isActive:()=>!rec.disposed&&!rec.unlocked&&nearFloor(getPlayerY,floor),
        onBurn:()=>{if(!rec.fireRecord.isActive())return false;ember.material=accent;unlock();return true;}};
      rec.firePoint={x,z}; // PersistentGroundFire supplies flask and placed-fire overlap.
    }
    function melodyAt(x,z,onSolved){
      const composer=root.PuzzleCaveMelody;
      if(!composer?.generate||!composer?.createSession)return false;
      const plate=new THREE.Mesh(new THREE.CylinderGeometry(.46,.46,.14,32),mat);
      plate.name='secret-Haouun-melody-pressure-stone-'+rec.id;
      plate.position.set(x,floor+.07,z);
      plate.userData.devRuinFootprintIgnore=true;group.add(plate);
      const support=DS?.pressurePlateSurface?.(plate,{
        id:rec.id+':plate',scope:options.scope||options.mapId||MAP_ID,plateArea:options.mapId||MAP_ID,
      }); // Supports the stone in either the native ruin or a stacked wing.
      if(support){DS.registerSurface(support);surfaces.push(support.id);}
      rec.plate=plate;rec.platePoint={x,z}; // Same one-tile grounded circular trigger as the main timed melody puzzles.
      rec.plateSignal=root.FurniturePatternSurfaces?.attachStoneSignal?.(plate,{
        width:.12,height:.12,idleColor:'#e5aa55',activeColor:'#65ffaf'
      })||null;
      rec.plateArt=root.PuzzleCavePlateArt?.decorate?.(THREE,plate,{
        radius:.46,thickness:.14,toward:{x:0,z:1}
      })||null; // Shared Hao'uun inscription, not a tiny floating unmarked plate.
      const song=composer.generate(rec.id+':melody',{difficulty:composer.ruinDifficulty?.(options.ruinTier)??3});
      rec.notes=song.notes.map(note=>note.index);
      const glyphs=root.RuinMelodyGlyphDecal?.create?.({
        root:group,plate:{x,y:floor,z},notes:rec.notes,backingMode:'carved',
        bounds:{minX:room.x,maxX:room.x+room.w,minZ:room.z,maxZ:room.z+room.d},
        sampleSupport:(px,pz)=>{const sample=DS?.sampleSupport?.(px,pz,{minY:floor-.5,maxY:floor+.5,pad:.02});
          return typeof DS?.sampleSupport==='function'?sample||null:{y:floor};},seed:hash(rec.id+':melody-art') // Only actual supported room floor may hold a clue.
      });
      if(glyphs)art.push(glyphs);
      rec.glyphs=glyphs;rec.scoreComposer=composer; // Scratchbone notes are hidden until the almost invisible floor stone is stepped on.
      rec.melody=composer.createSession(song,{
        lookaheadMs:root.AudioSystem?.metronomeLookaheadMs||0,
        clockMs:root.AudioSystem?.metronomeLookaheadMs?()=>root.performance?.now?.()??Date.now():undefined,
        onStop:()=>{root.RuinInteractionAudio?.metronomeStop?.();root.MusicMinigame?.clearPuzzleBeatClock?.();},
        onBeat:beat=>{if(beat.absoluteBeat===0)root.MusicMinigame?.setPuzzleBeatClock?.(song.bpm,beat.whenMs);root.RuinInteractionAudio?.metronomeTick?.(beat);},
        onNote:note=>root.RuinInteractionAudio?.melodyPercussionTick?.(note),
        onSolved
      });
      rec.melodyListener=event=>{
        if(rec.disposed||rec.unlocked||event?.detail?.area!==(options.mapId||MAP_ID))return;
        const player=getPlayerPosition?.();
        if(!player||!nearFloor(getPlayerY,floor)
          ||Math.hypot(player.x-rec.platePoint.x,player.z-rec.platePoint.z)>.48)return; // Other hidden plates in the same ruin never hear this performance.
        rec.melody?.note?.(event.detail.noteIndex,event.detail.pressedAtMs);
      };
      root.addEventListener?.('hobunji-kurraya-puzzle-note',rec.melodyListener);
      return true;
    }
    if(spec.kind==='pillar'){
      const pillar=at(2.6,2.55);
      box('secret-sightline-pillar-'+rec.id,.85,2.55,.85,pillar.x,floor+1.275,pillar.z);
      blocker('pillar',pillar.x,pillar.z,.85,.85,2.55);
      chestAt(center.x,center.z,floor);
      targetAt(pillar.x+sx*.44,floor+1.28,pillar.z+sz*.44,unlock); // The hidden target is built onto the stone pillar's room-facing corner.
      rec.gateProgress=0; // The loot is optional but must still be earned with the shared projectile mechanism.
    }else if(spec.kind==='closet'){
      // L-shaped partition occupies existing floor cells: no new doorway, dead tile, or
      // exterior mesh leak. Its only opening faces the room and has an actual blocker.
      const xWall=edgeX+sx*3.3,zWall=edgeZ+sz*3.3;
      const wallZ1=edgeZ+sz*.765,wallZ2=edgeZ+sz*2.85; // The first wall meets the room perimeter.
      const wallX=edgeX+sx*1.70; // Close the seam between the back wall and the room perimeter.
      for(const [name,x,z,w,d] of [
        ['narrow-wall-a',xWall,wallZ1,.2,1.53],
        ['narrow-wall-b',xWall,wallZ2,.2,.7],
        ['back-wall',wallX,zWall,3.4,.2]
      ]){
        box(rec.id+':'+name,w,2.8,d,x,floor+1.4,z);
        blocker(name,x,z,w,d,2.8);
      }
      const gate=box('secret-closet-stone-door-'+rec.id,.21,2.8,1.2,mouth.x,floor+1.4,mouth.z,dark);
      blocker('gate',mouth.x,mouth.z,.21,1.2,2.8,()=>rec.gateProgress<.92);
      rec.gate=gate;rec.gateY=gate.position.y;
      chestAt(center.x,center.z,floor);
      const switchAt=at(4.6,3.4);
      const source=spec.trigger==='fire'
        ?[[7.6,1.6],[2.2,6.6],[7.5,5.9]].find(([x,z])=>supportedSite(spec.corner,x,z))
        :null; // Use room-side floor away from the trigger so a player can carry fire between them.
      if(source)fireAt(switchAt.x,switchAt.z,at(...source));
      else if(spec.trigger!=='melody'||!melodyAt(switchAt.x,switchAt.z,unlock)){
        rec.trigger='projectile';
        targetAt(switchAt.x,floor+1.5,switchAt.z,unlock);
      }
    }else if(spec.kind==='suspended'){
      chestAt(center.x,center.z,floor);
      box('secret-clasp-grounded-plinth-'+rec.id,.65,.9,.65,center.x+sx*.95,floor+.45,center.z+sz*.35);
      rec.cover=new THREE.Group(); // The reward sits on its real floor; only the visible enclosing cover is destroyed on solve.
      rec.cover.name='secret-grounded-'+spec.suspension+'-cover-'+rec.id;
      group.add(rec.cover);
      if(spec.suspension==='ice'){
        const iceSeed=box('secret-ice-growth-seed-'+rec.id,1.3,1.75,1.3,center.x,floor+.875,center.z,ice);
        group.remove(iceSeed);rec.cover.add(iceSeed); // Fallback remains a carved-textured icy solid attached to the removable cover.
        const placement=root.DungeonDoorIceCoverage?.create?.({
          door:iceSeed,parent:rec.cover,groundY:floor,seed:rec.id+':ice-cover',
        }); // Same Furniture Author stalagmite coverage as Tothal dungeon doors, not a translucent rectangular placeholder.
        if(placement?.iceLayer){
          iceSeed.visible=false; // Real authored ice alone forms the cover; the physical chest remains available after it breaks.
          rec.icePlacement=placement;
        }
      }else{
        rec.cover.position.set(center.x,floor+1.75,center.z); // Its entire net descends to the same real floor as the chest.
        const coverStone=(name,w,h,d,dx,dy,dz,material=mat)=>{
          const stone=box(name,w,h,d,center.x+dx,floor+1.75+dy,center.z+dz,material);
          group.remove(stone);rec.cover.add(stone);
          stone.position.set(dx,dy,dz); // Reparent from world space to the net's shared local support frame.
          return stone;
        }; // Stone props use the same PNG and UV pipeline as the main dungeon's pillars and gates.
        for(const dx of [-.65,.65])for(const dz of [-.65,.65])
          coverStone('secret-net-grounded-column-'+rec.id,.15,1.75,.15,dx,-.875,dz);
        for(const dz of [-.65,.65])
          coverStone('secret-net-top-crossbeam-'+rec.id,1.45,.14,.14,0,-.035,dz,dark);
        const netSkin=root.DungeonRopeArt?.createNetFrustum?.(1.36,1.36,1.75,1); // Straight-sided rope_long.png net fully encloses the ground-level chest; hanging nets retain their original taper.
        if(netSkin){
          netSkin.name='secret-rope-long-net-cover-'+rec.id;
          netSkin.userData.devRuinFootprintIgnore=true;
          rec.cover.add(netSkin);
          rec.netSkin=netSkin; // The real rope_long.png atlas hangs from four solid carved-stone columns.
        } // Without the sprite module, the supported stone enclosure remains visible, never a floating bare net.
      }
      blocker('cache-cover',center.x,center.z,1.3,1.3,1.75,()=>!rec.unlocked);
      // A visible ice/net enclosure also physically blocks approach until the shared projectile clasp is struck.
      targetAt(center.x+sx*.95,floor+1.11,center.z+sz*.35,unlock); // Clasp rests on the stone plinth, not unsupported air.
    }
    const cameraForBrood=()=>root.DevRandomRuinInteractions?.activeCamera?.()
      ||root.Combat?.deps?.getActiveCamera?.()||null; // Shared camera for the entire active-room hatchling rig update.
    if(spec.babies){
      // A separate opposite corner shelf preserves the chest's hidden sightline and does
      // not overlap the main objective. These are real planebent flying rigs, not eggs.
      const bx=left?room.x+room.w-1.2:room.x+1.2;
      const bz=top?room.z+room.d-1.2:room.z+1.2;
      const shelf=box('secret-skeeri-grounded-plinth-'+rec.id,2.15,2.2,1.05,bx,floor+1.1,bz);
      blocker('brood-plinth',bx,bz,2.15,1.05,()=>true); // A real solid column under the nest, not a floating slab in a narrow corner.
      const nest=root.ProceduralFurniture?.buildFurnitureGroup?.('nest',0x756044)
        ||box('secret-skeeri-nest-'+rec.id,1.45,.14,.85,bx,floor+2.27,bz,accent);
      if(!nest.parent){nest.name='secret-skeeri-nest-'+rec.id;nest.position.set(bx,floor+2.19,bz);
        nest.scale.setScalar(.67);nest.userData.devRuinFootprintIgnore=true;group.add(nest);}
      rec.nest={x:bx,z:bz,babies:spec.babies,loaded:0,shelf,nest,anim:[],elapsed:0,
        eggsRemaining:root.SkeeriLivestockRegistration?.remainingEggs?.({seed,roomId:String(room.id),count:spec.babies})??0}; // The clutch count survives ruin re-entry; it never changes the hatchling encounter.

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
          rec.nest.anim.push({rig,root:rig.root,baseY:rig.root.position.y,baseYaw:rig.root.rotation.y,
            phase:(hash(identity+':phase')%628)/100}); // Keep the authored hatchling pose, coloured fur and glowing eyes in sync.
          const camera=cameraForBrood();
          if(camera?.getWorldPosition)rig.update?.(camera,'hatchling',rec.nest.elapsed); // FlyingAnimalRig otherwise shows the default adult flying sprites.
        }).catch(error=>root.__farmLog?.('[ruin-secrets] Baby Skeeri rig: '+error.message,'warn'));
      }
      registerControl({kind:'ruinSkeeriNest',object:nest,promptRoot:nest,floorY:floor,
        range:2,priority:16,touchIcon:'🐣', // Inspect uses normal Interact; a nearby nest must not override torch/combat Action 1.
        available:()=>!rec.disposed&&nearFloor(getPlayerY,floor),
        label:()=>spec.babies+' Planebent Skeeri Hatchling'+(spec.babies===1?'':'s')
          +(rec.nest.eggsRemaining?' · '+rec.nest.eggsRemaining+' fertile egg'+(rec.nest.eggsRemaining===1?'':'s'):' · empty clutch'),
        onPress:()=>{
          rec.discovered=true;
          const remaining=rec.nest.eggsRemaining; // Keeps the next egg's deterministic identity stable on re-entry.
          const result=root.SkeeriLivestockRegistration?.collectNestEgg?.({
            seed,roomId:String(room.id),count:spec.babies,theme:spec.theme,
            identity:String(seed)+':'+room.id+':egg:'+(spec.babies-remaining),
          });
          if(result?.ok)rec.nest.eggsRemaining=result.remaining;
          options.showToast?.(result?.message||'A hidden brood of planebent Skeeri.',result?.ok===true);
          return result;
        }});
    }
    rec.tick=dt=>{
      if(rec.disposed)return;
      const t=Math.min(.05,Math.max(0,Number(dt)||0));
      rec.sourceFlame?.update?.(t);
      if(rec.nest?.anim.length){
        rec.nest.elapsed+=t;
        const camera=cameraForBrood(); // One camera lookup per active-room tick, not one per hatchling.
        for(const baby of rec.nest.anim){
          baby.root.position.y=baby.baseY+.016*Math.sin(rec.nest.elapsed*2.4+baby.phase);
          baby.root.rotation.y=baby.baseYaw+.09*Math.sin(rec.nest.elapsed*1.1+baby.phase);
          if(camera?.getWorldPosition)baby.rig.update?.(camera,'hatchling',rec.nest.elapsed); // Reuses folded-wing rig presentation and character-facing logic.
        }
      }
      if(rec.gate&&rec.unlocked&&rec.gateProgress<1){
        rec.gateProgress=Math.min(1,rec.gateProgress+t*1.7);
        rec.gate.position.y=rec.gateY+rec.gateProgress*3;
      }
      if(rec.fireRecord&&!rec.unlocked&&rec.firePoint&&nearFloor(getPlayerY,floor)
        &&root.PersistentGroundFire?.intersects?.(options.mapId||MAP_ID,rec.firePoint.x,rec.firePoint.z,.38))unlock(); // A burning patch on another stacked story is NOT this switch.
      if(rec.melody&&!rec.unlocked){
        const p=getPlayerPosition?.(),standing=p&&nearFloor(getPlayerY,floor)
          &&Math.hypot(p.x-rec.platePoint.x,p.z-rec.platePoint.z)<.48;
        rec.melody.step(t,!!standing);
        rec.glyphs?.setVisible?.(!!standing); // The clue is disclosed by the hidden plate, never a conspicuous room-wide marker.
        const glow=rec.melody.snapshot?.();
        if(glow&&rec.scoreComposer?.advanceGlyphGlow){
          const notes=rec.glyphs?.group?.children?.filter?.(node=>node.userData?.melodyNoteIndex!==undefined)||[];
          for(let i=0;i<notes.length;i++)rec.scoreComposer.advanceGlyphGlow(notes[i],{
            current:i===glow.activeIndex,accepted:i<glow.progress,dt:t});
        }
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
    if(rec.chest?.opened){ // Opened caches remain visible and accessible after site restoration, without replaying the secret switch.
      rec.unlocked=true;rec.gateProgress=1;
      if(rec.gate)rec.gate.position.y=rec.gateY+3;
      if(spec.kind==='suspended'&&rec.cover)rec.cover.visible=false;
    }
    rec.snapshot=()=>({id:rec.id,kind:rec.kind,trigger:rec.kind==='closet'?rec.trigger:rec.suspension,
      tier:rec.tier,unlocked:rec.unlocked,gateProgress:rec.gateProgress,ignitionSource:rec.ignitionSource||null,projectileLinked:rec.linked,fireLinked:!!rec.fireId,
      art:{stone:'carved_smooth.png',mapped:!!root.HobunjiSurfaceStretchUV?.mapMesh,
        cover:rec.icePlacement?.iceLayer?'authored-ice-growth'
          :rec.netSkin?.userData?.dungeonNetAtlas|| (spec.kind==='suspended'?'textured-stone-fallback':null)},
      // Mobile Pixel Probe can identify texture-fallback cases without opening browser developer tools.
      chestOpened:rec.chest?.opened??null,babies:rec.babies,nestLoaded:rec.nest?.loaded||0,
      eggsRemaining:rec.nest?.eggsRemaining??0,
      nestDiscovered:rec.discovered});
    group.userData.ruinSecretSnapshot=rec.snapshot; // Pixel Probe resolves any clicked secret prop back to this room.
    rec.dispose=()=>{
      if(rec.disposed)return;rec.disposed=true;
      for(const control of controls)removeControl?.(control);
      for(const dispose of links)dispose();
      if(rec.fireId)fire?.unregisterTarget?.(rec.fireId);
      if(rec.melodyListener)root.removeEventListener?.('hobunji-kurraya-puzzle-note',rec.melodyListener);
      rec.melody?.stop?.();
      rec.plateArt?.dispose?.(); // Hao'uun plate decoration follows the same lifecycle as the main melody plates.
      rec.plateSignal?.dispose?.();
      for(const a of art)a.dispose?.();
      removeFootprints?.();
      rec.sourceFlame?.dispose?.();
      for(const record of colliders)DS?.remove?.(record.id);
      for(const id of surfaces)DS?.remove?.(id);
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