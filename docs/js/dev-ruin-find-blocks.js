// Find the Blocks — four-stage compound chamber shared by Puzzle Lab and generated dungeon wings.
// The ordinary V50 pusher/occupancy owns every block's horizontal motion;
// DungeonFire, KurrayaPuzzle and HronalWitchBombs own their existing triggers.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DevRuinFindBlocks=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const MAP_ID='map_i_dev_random_ruin';
  const BLOCK_SIZE=.82; // Used for the native push face and four pressure-plate landing checks.
  const FALL_ACCEL=14; // Shared vertical acceleration for freed ceiling and ledge blocks.
  const PLATE_REACH=.29; // Requires the block's center to settle on the actual plate tile.
  const STAIR_RISE=.36; // Individual winding-tile steps remain within ordinary ruin step-up height.
  const COLOR={stone:0x77736b,block:0x8c8880,plate:0xb79b56,solved:0x56cb8b,
    fire:0xff8e20,ice:0xbceeff,rope:0x6e4b30,mark:0xf3d78c}; // Shared visual palette for this room only.

  function create(options={}){
    const {THREE,kit,context,room,y:floorY,onSolved,isActive}=options;
    if(!THREE||!kit||!context||!room||typeof onSolved!=='function'||typeof isActive!=='function')
      throw new Error('Find the Blocks requires an active ruin and native puzzle services.');
    if(room.w<18||room.d<18)throw new Error('Find the Blocks needs a very-large (18 x 18 or larger) room.');
    const occupancy=root.DevRandomRuinTileOccupancy,game=root.DevRandomRuin;
    if(!occupancy?.addSolidBox||!game?.registerLabPushBlock)
      throw new Error('The native sliding-block collision adapter is unavailable.');
    const id='find-blocks-'+String(context.seed)+'-'+String(room.id||room.x+'-'+room.z);
    const solidOwner='find-the-blocks:'+id; // Each generated chamber releases only its own live obstacle footprints.
    const cx=Math.floor(room.x+room.w*.5)+.5,cz=Math.floor(room.z+room.d*.5)+.5; // Grid-centered origin shared by the four stages and plates.
    const offset=Math.max(4,Math.min(5,Math.floor(Math.min(room.w,room.d)*.29))); // Leaves walkable perimeter around every source.
    const roof=Number(context.ceilingY); // The actual V50 ceiling, not a raised artificial anchor that could hide a hanging target above the stone.
    const ceiling=context.ceilingY!=null&&Number.isFinite(roof)?roof:floorY+3.5;
    if(ceiling-floorY<2.65)throw new Error('Find the Blocks needs at least 2.65 units of ceiling clearance.');
    const group=new THREE.Group(); // Session-owned geometry is allocated only after validating the available room.
    group.name='dev_ruin_find_the_blocks';kit.group().add(group);
    const stairRise=Math.min(STAIR_RISE,(ceiling-floorY-BLOCK_SIZE-.22)/7); // Seven actual walkable steps end below the ceiling with space for the block.
    const initialPillarHeight=Math.min(3.35,ceiling-floorY-BLOCK_SIZE-.22); // The pillar is as tall as the chamber permits without clipping its carried block.
    const roll=Number(context.seed)>>>0; // Stable per-chamber seed; different floors and wings receive independent mixes.
    const variant=['melody','projectiles','witchBomb','ceilingRail'][roll%4]; // The tall pillar can be unlocked by four real puzzle systems.
    const netVariant=['fire','glyphs','movingTargets','melody'][Math.floor(roll/4)%4]; // Ceiling net bindings are independently varied.
    const stairMirror=!!(roll&2); // Flips the walkable winding approach without changing its achievable step height.
    const blocks=[],plates=[],targets=[],controls=[],disposers=[],burnIds=[],chips=[]; // Session-local ownership; no world save or drops.
    let disposed=false,solved=false,sinking=false,pillarHeight=initialPillarHeight,pillarBroken=false,pillarLowered=false;
    let melody=null,netChallenge=null,iceLayer=null,iceMelt=0,bombTube=null,hitCount=0; // Driven by tick, never by artificial completion switches.
    let bombTargetSignal=null,bombTargetFlash=0; // The reusable projectile switch briefly glows when it requests a bomb.
    const fire=root.DungeonFire,bombs=root.HronalWitchBombs;
    const alive=()=>!disposed&&isActive();
    const mat=(color,emissive=0,surface='carved')=>{
      // All block bodies, pressure plates, stairs, stone pillars, gates and rune insets use the same carved_smooth.png material as the rest of the dungeon.
      const carved=surface==='carved'?root.ProceduralFurniture?.makePartMaterial?.({
        materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never',
        color:'#7a746b'
      }):null;
      if(carved){
        return carved; // Interactive feedback lives in the separate glowing PNG glyphs, not the stone tint.
      }
      return new THREE.MeshStandardMaterial({color:surface==='carved'?0x7a746b:color,roughness:.82,metalness:.06}); // Headless fallback uses the same inert stone tint.
    };
    const newMesh=(name,geo,material,x,cy,z,parent=group)=>{
      const mesh=new THREE.Mesh(geo,material);
      mesh.name=name;mesh.position.set(x,cy,z);
      mesh.userData.devRuinFootprintIgnore=true; // The registered dynamic support/blocker owns collision, not a stale mesh scan.
      parent.add(mesh);return mesh;
    };
    const cube=(name,x,z,bottom,w,h,d,color=COLOR.stone,emissive=0,parent=group,surface='carved')=>
      newMesh(name,new THREE.BoxGeometry(w,h,d),mat(color,emissive,surface),x,bottom+h*.5,z,parent);
    const cylinder=(name,x,z,bottom,rad,h,color)=>
      newMesh(name,new THREE.CylinderGeometry(rad,rad,h,12),mat(color),x,bottom+h*.5,z);
    const stonePresent=()=>{
      if(disposed)return false;
      const height=Number(game.getPlayerGroundSupportY?.()); // Unqualified blocker probes must not project an upper-story column into an inactive lower story.
      return !kit.registerBlocker||!Number.isFinite(height)||Math.abs(height-floorY)<4.5;
    }; // Structural stone remains physically present even after its associated stage is solved.
    const solid=(name,x,z,halfX,halfZ,enabled=stonePresent)=>{
      if(kit.registerBlocker){
        // Stacked wing stories need height-aware obstacles. V50's ordinary footprint registry samples only the entry level.
        kit.registerBlocker({
          id:id+'-'+name,
          bounds:{minX:x-halfX,maxX:x+halfX,minZ:z-halfZ,maxZ:z+halfZ},
          enabled,
          blocksAt:(px,pz,_actorHeight,_record,radius,query)=>{
            const worldY=Number(query?.worldY??query?.y??query?.floorY);
            if(Number.isFinite(worldY)&&(worldY<floorY-.35||worldY>floorY+3.5))return false;
            const pad=Math.max(0,Number(radius)||0);
            return Math.abs(px-x)<=halfX+pad&&Math.abs(pz-z)<=halfZ+pad;
          }
        });
        return true;
      }
      return occupancy.addSolidBox(id+'-'+name,{cx:x,cz:z,halfX,halfZ},enabled,solidOwner);
    }; // Solo still uses its canonical footprint registry; layered stories use per-floor DynamicSurfaces blockers.
    const control=record=>{controls.push(record);if(kit.addControl)kit.addControl(record);else kit.state.controls.push(record);return record;};
    const support=(name,x,z,w,d,topY,enabled=()=>alive())=>kit.registerSurface({
      id:id+'-'+name,bounds:{minX:x-w*.5,maxX:x+w*.5,minZ:z-d*.5,maxZ:z+d*.5},
      topY,enabled,priority:23
    }); // Native DynamicSurfaces is authoritative for climbable tile and pillar tops.

    function makeBlock(name,x,z,bottom,available=false){
      const mesh=cube('find-block-'+name,x,z,bottom,BLOCK_SIZE,BLOCK_SIZE,BLOCK_SIZE,COLOR.block);
      const rune=cube('find-block-inset-'+name,0,0,BLOCK_SIZE*.5-.02,.32,.035,.32,COLOR.mark,0,mesh);
      rune.position.set(0,BLOCK_SIZE*.5+.008,0); // Slightly raised square top mark follows the moving block.
      root.FurniturePatternSurfaces?.attachStoneSignal?.(rune,{width:.26,height:.26,idleColor:'#d6b77e'}); // The top mark glows without repainting the block.
      mesh.userData.findBlocksAvailable=available;
      mesh.userData.findBlocksFalling=false;
      mesh.userData.findBlocksCanDrop=false;
      mesh.userData.findBlocksFloorY=floorY;
      if(!game.registerLabPushBlock(mesh,1))throw new Error('Could not register native sliding block '+name+'.');
      const record={name,mesh,phase:available?'ready':'locked',fallSpeed:0,landed:available};
      blocks.push(record);return record;
    }
    function startFall(block){
      if(!alive()||block.phase==='falling'||(block.phase==='ready'&&!block.mesh.userData.findBlocksCanDrop))return false;
      block.phase='falling';block.fallSpeed=0;
      block.mesh.userData.findBlocksFalling=true;
      block.mesh.userData.findBlocksAvailable=false;
      return true;
    }
    function finishFall(block){
      block.mesh.position.y=floorY+BLOCK_SIZE*.5;
      block.mesh.userData.findBlocksFalling=false;
      block.mesh.userData.findBlocksCanDrop=false;
      block.mesh.userData.findBlocksAvailable=true;
      block.phase='ready';block.landed=true;
    }
    function fireSource(){
      const x=cx,z=cz-3;
      const asset=root.DevRandomRuinFurniturePieces?.build?.('ruinStandingBrazier');
      const bowl=asset||cylinder('find-blocks-brazier',x,z,floorY,.48,.67,0x655345);
      if(asset){asset.position.set(x,floorY,z);asset.userData.devRuinFootprintIgnore=true;group.add(asset);}
      const flame=newMesh('find-blocks-brazier-flame',new THREE.ConeGeometry(.18,.49,7),
        new THREE.MeshBasicMaterial({color:COLOR.fire,transparent:true,opacity:.9}),x,floorY+1.05,z);
      control({kind:'findBlocksBrazier',object:bowl,promptRoot:bowl,point:{x,y:floorY,z},
        range:1.6,priority:36,claimAction1:true,touchIcon:'🔥',label:'Ignite Next Shot',
        onPress:()=>{
          if(!alive())return;
          const ready=fire?.armNextProjectile?.()===true;
          kit.deps?.showToast?.(ready?'Your next shot is aflame.':'Equip a ranged weapon first.',ready);
        }});
      return {bowl,flame};
    }
    function registerBurn(idSuffix,object,onBurn){
      const targetId=id+'-'+idSuffix; // Unregistered when the lab is rerolled or left.
      const target=fire?.registerTarget?.({
        id:targetId,object,active:true,contactPadding:.24,
        isActive:alive,
        onBurn:()=>{
          if(!alive())return false;
          return onBurn()!==false;
        }
      });
      if(!target)throw new Error('Could not register Dungeon Fire target '+idSuffix+'.');
      burnIds.push(targetId);
    }
    function netSource(){
      const x=cx-offset,z=cz-offset;
      const block=makeBlock('net',x,z,ceiling-1.66);
      const net=new THREE.Group();net.name='find-blocks-burnable-net';
      net.position.set(x,ceiling-.12,z);net.userData.devRuinFootprintIgnore=true;group.add(net);
      const skin=root.DungeonRopeArt?.createNetFrustum?.(.98,.98,1.0);
      if(skin){skin.userData.devRuinFootprintIgnore=true;net.add(skin);}
      else{
        const rope=mat(COLOR.rope,0,'rope');
        for(const dx of [-.45,.45])for(const dz of [-.45,.45])
          newMesh('net-cord',new THREE.CylinderGeometry(.026,.026,1.08,5),rope,dx,-.56,dz,net);
        cube('find-blocks-net-beam',0,0,-.12,1.1,.12,.12,COLOR.rope,0,net,'rope');
      }
      const hit=cube('find-blocks-net-fire-hit',x,z,ceiling-1.18,.95,1.12,.95,0x8c7551,0,group,'rope');
      hit.material.transparent=true;hit.material.opacity=0;hit.material.depthWrite=false;
      const release=()=>{net.visible=false;hit.visible=false;return startFall(block);}; // Every net trigger releases the same physical falling block.
      if(netVariant==='fire')registerBurn('net',hit,release);
      else{
        netChallenge=root.RuinLayerChallenges?.compose?.({
          THREE,parent:group,room:{x:cx-offset-1.5,z:cz-3.5,w:3,d:3},y:floorY,
          id:id+'-net-challenge',kind:netVariant==='glyphs'?'glyphObelisk'
            :netVariant==='movingTargets'?'ceilingRailTargets':'melodyEcho',
          mapId:MAP_ID,isActive:alive,onSolved:release,
          getPlayerPosition:kit.playerWorld,
          getPlayerY:()=>game.getPlayerGroundSupportY?.()??kit.playerWorld()?.y??floorY,
          music:root.MusicMinigame
        });
        if(!netChallenge)throw new Error('Could not mount the native net-release challenge '+netVariant+'.');
      }
      return block;
    }
    function iceSource(){
      const x=cx+offset,z=cz-offset;
      const block=makeBlock('ice',x,z,ceiling-1.85);
      const iceRoot=new THREE.Group();
      iceRoot.name='find-blocks-ceiling-icicles';iceRoot.position.set(x,ceiling-.1,z);
      iceRoot.userData.devRuinFootprintIgnore=true;group.add(iceRoot);
      const builder=root.IceStalagmiteCoverage,recipe=root.DungeonDoorIceCoverage?.scaledRecipe?.(2.2,id+'-ceiling',{
        count:16,density:1,iceHeightMin:1.15,iceHeightMax:1.7,radius:.25,iceFootprintPadding:.08
      });
      const ceilingIce=builder?.buildCeiling?.(THREE,iceRoot,{width:.96,depth:.96,height:1.65,recipe})||null; // Prefer the shared inverted furniture-ice authoring path used by ruin doors.
      if(ceilingIce?.layer)iceLayer=ceilingIce.layer; // Subsequent melt animation operates on the authored spikes, not their parent.
      if(!iceLayer&&builder?.build&&recipe){
        iceRoot.rotation.x=Math.PI; // Compatibility path for test doubles and older authoring exports without buildCeiling.
        const source=new THREE.Group(); // The furniture-editor ice builder receives the same invisible source geometry as its normal door treatment.
        const proxy=new THREE.Mesh(new THREE.BoxGeometry(.96,1.65,.96),new THREE.MeshBasicMaterial());
        proxy.userData.authoredPartId='find_blocks_ceiling_ice_source';proxy.position.y=.83;source.add(proxy);
        try{iceLayer=builder.build(THREE,source,recipe);}
        finally{proxy.geometry.dispose();proxy.material.dispose();}
        if(iceLayer?.userData?.surfaceGrowthStats?.spikes){
          iceLayer.traverse(node=>{node.userData.devRuinFootprintIgnore=true;});
          iceRoot.add(iceLayer);
        }else iceLayer=null;
      }
      if(!iceLayer)newMesh('fallback-icicle',new THREE.ConeGeometry(.55,1.65,7),mat(COLOR.ice,0,'ice'),
        0,.9,0,iceRoot);
      const hit=cube('find-blocks-ice-fire-hit',x,z,ceiling-1.92,1.05,1.65,1.05,COLOR.ice,0,group,'ice');
      hit.material.transparent=true;hit.material.opacity=0;hit.material.depthWrite=false;
      registerBurn('ice',hit,()=>{
        hit.visible=false;iceMelt=.001; // Retraction starts on real flaming-projectile contact.
        return true;
      });
      block.iceRoot=iceRoot;return block;
    }
    function climbingSource(){
      const x=cx-offset,z=cz+offset,top=floorY+stairRise*7;
      const block=makeBlock('climb',x,z,top,true);
      block.mesh.userData.findBlocksCanDrop=true; // Allows one supported block to be pushed off a ledge without bypassing other V50 courses.
      // A narrow winding walkable route, not invisible stairs or an interaction that teleports the player.
      // Each tile is separated by at most the normal step-up threshold.
      const side=stairMirror?-1:1; // Both mirrored paths end at the same climbable block dais.
      const path=[
        [x+4,z+side],[x+4,z],[x+3,z],[x+3,z-side],
        [x+2,z-side],[x+2,z],[x+1,z]
      ];
      path.forEach(([sx,sz],i)=>{
        const topY=floorY+stairRise*(i+1);
        cube('find-blocks-winding-step-'+i,sx,sz,floorY,.92,topY-floorY,.92,COLOR.stone);
        support('winding-step-'+i,sx,sz,.92,.92,topY);
      });
      cube('find-blocks-high-platform',x,z,floorY,2.2,top-floorY,2.2,COLOR.stone);
      support('climb-dais',x,z,2.2,2.2,top);
      return block;
    }
    function pillarSource(){
      const x=cx+offset,z=cz+offset;
      const block=makeBlock('pillar',x,z,floorY+pillarHeight);
      block.mesh.userData.findBlocksCanDrop=false;
      const stone=cube('find-blocks-tall-pillar',x,z,floorY,1.9,pillarHeight,1.9,
        variant==='witchBomb'?0x5f554c:COLOR.stone,variant==='witchBomb'?0x622600:0);
      solid('tower',x,z,.95,.95,()=>alive()&&!pillarBroken&&pillarHeight>.16);
      support('tower-top',x,z,1.9,1.9,()=>floorY+pillarHeight,()=>alive()&&!pillarBroken&&pillarHeight>.1);
      const triggerSink=()=>{
        if(!alive()||sinking||pillarLowered||pillarBroken)return false;
        sinking=true;
        root.RuinInteractionAudio?.mechanism?.(stone,{size:Math.max(1.9,pillarHeight)}); // The true tall stone pillar starts sinking, one cue per puzzle activation.
        kit.deps?.showToast?.('The tall stone pillar is sinking!',true);return true;
      };
      if(variant==='melody'||variant==='ceilingRail'){
        const challenge=root.RuinLayerChallenges?.compose?.({
          THREE,parent:group,room:{x:cx+1.5,z:cz-4.5,w:3,d:3},y:floorY, // Away from all four block plates and their pushing approaches.
          id:id+'-pillar-unlock',kind:variant==='melody'?'melodyEcho':'ceilingRailTargets',mapId:MAP_ID,
          isActive:alive,onSolved:triggerSink,
          getPlayerPosition:kit.playerWorld,
          getPlayerY:()=>game.getPlayerGroundSupportY?.()??kit.playerWorld()?.y??floorY,
          music:root.MusicMinigame,
          melodySurfaces:[
            {x,y:floorY+1.6,z:z-.976,yaw:Math.PI},
            {x:x-.976,y:floorY+1.6,z,yaw:-Math.PI/2}
          ] // Two exposed pillar faces give manual musicians a glowing note clue in the plate's line of sight.
        });
        if(!challenge)throw new Error('Could not compose the native '+variant+' challenge for the tall pillar.');
        melody=challenge; // Native challenge handles real instrument/ranged input, registration and cleanup.
      }else if(variant==='projectiles'){
        const locations=[[cx+1,cz+3],[cx+3,cz+1],[cx+5,cz+1]];
        locations.forEach(([px,pz],index)=>{
          const column=cube('find-blocks-target-pillar-'+index,px,pz,floorY,.95,1.75,.95,COLOR.stone);
          solid('target-pillar-'+index,px,pz,.47,.47);
          const alongX=Math.abs(px-cx)>=Math.abs(pz-cz); // Aimable face points toward the central floor, not into the opaque stone column.
          const faceX=alongX?px+Math.sign(cx-px)*.535:px;
          const faceZ=alongX?pz:pz+Math.sign(cz-pz)*.535;
          const marker=cube('find-blocks-projectile-glyph-'+index,faceX,faceZ,floorY+.86,
            alongX?.15:.56,.57,alongX?.56:.15,COLOR.fire,0x452300); // Thin exposed wall plaque hits before the pillar in the actual ranged sweep.
          const signal=root.FurniturePatternSurfaces?.attachStoneSignal?.(marker,{
            face:alongX?(px<cx?'right':'left'):(pz<cz?'front':'back'),
            width:.39,height:.4,idleColor:'#ffa64a',activeColor:'#65ffaf',
          }); // Projectile marks switch glow only, retaining the same stone PNG underneath.
          const target={id:id+'-target-'+index,object:marker,hitMesh:marker,active:false,
            hittable:()=>alive()&&!target.active,
            onHit:()=>{
              if(!alive()||target.active)return;
              target.active=true;hitCount++;signal?.setActive(true);
              if(hitCount===3)triggerSink();
            }};
          targets.push(target);kit.registerProjectileTarget(target);
        });
      }else{
        // No timed self-detonation: only a real Hronal witch-bomb explosion calls the native breakable callback.
        const crackMaterial=new THREE.MeshBasicMaterial({color:0xff7a17,depthTest:true});
        for(const n of [-1,0,1]){
          const crack=newMesh('find-blocks-orange-crack-'+n,new THREE.BoxGeometry(.045,1.28,.056),
            crackMaterial,(n*.2),0,.96,stone);
          crack.rotation.z=n*.27;
        }
        const unregister=bombs?.registerBreakable?.(stone,{
          id:id+'-cracked-pillar',mapId:MAP_ID,radius:3.7,
          onBreak:()=>{
            if(!alive()||pillarBroken)return false;
            pillarBroken=true;pillarHeight=0;stone.visible=false;startFall(block);
            // Small falling stone chips mark the blast; only the real bomb damages actors or the pillar.
            for(let i=0;i<12;i++){
              const a=i*Math.PI*2/12;
              const chip=cube('find-blocks-shattered-stone-'+i,x,z,floorY+1,
                .22,.16,.23,COLOR.stone);
              chips.push({mesh:chip,vx:Math.cos(a)*(1.8+i%3*.28),vz:Math.sin(a)*(1.8+i%2*.3),
                vy:1.7+(i%4)*.3,life:1.3});
            }
            kit.deps?.showToast?.('The cracked pillar shattered. Push its block to a plate!',true);
            return true;
          }
        });
        if(typeof unregister!=='function')throw new Error('Hronal witch-bomb breakable runtime is unavailable.');
        disposers.push(unregister);
        const tubeId=id+'-dispenser';
        const bx=x-5.6,bz=z+1.5; // Outside the actual blast radius: the player must pick up and throw a real witch-bomb.
        bombTube=new THREE.Group();bombTube.position.set(bx,ceiling-.08,bz);
        bombTube.name='find-blocks-witch-bomb-tube';
        bombTube.userData={devRuinFootprintIgnore:true,puzzleInstanceId:tubeId,
          authoredFurnitureData:{bombTubeExit:{x:0,y:-.9,z:0}}};
        group.add(bombTube);
        newMesh('find-blocks-tube-body',new THREE.CylinderGeometry(.46,.46,.85,12),
          mat(0x5b4d46),0,-.42,0,bombTube);
        const registered=bombs?.registerDispenser?.(MAP_ID,tubeId,bombTube,{bombFuseSeconds:18});
        if(!registered)throw new Error('Could not register the native Hronal witch-bomb dispenser.');
        disposers.push(()=>bombs.unregisterDispenser(MAP_ID,tubeId));
        const targetX=bx+1.25,targetZ=bz-.65; // Separate switch beside the tube, aimed toward the open chamber.
        cube('find-blocks-bomb-target-pedestal',targetX,targetZ,floorY,.66,.95,.66,COLOR.stone);
        solid('bomb-target-pedestal',targetX,targetZ,.31,.31);
        const marker=cube('find-blocks-bomb-projectile-target',targetX,targetZ-.375,floorY+.61,
          .56,.56,.12,COLOR.stone);
        bombTargetSignal=root.FurniturePatternSurfaces?.attachStoneSignal?.(marker,{
          face:'front',width:.44,height:.44,idleColor:'#ffae62',activeColor:'#65ffaf',
        }); // The glowing glyph is applied to carved-smooth stone, never to the tube itself.
        const target={id:tubeId+'-projectile-target',object:marker,hitMesh:marker,active:false,
          hittable:()=>alive(),onHit:()=>{
            if(!alive())return;
            bombTargetFlash=.3;bombTargetSignal?.setActive(true);
            bombs.dispenseFromMechanism(bombTube); // Factory still rejects repeats while its previous bomb is live.
          }};
        targets.push(target);kit.registerProjectileTarget(target); // No direct Action 1 interaction on the dispenser.
      }
      block.pillar=stone;return block;
    }
    function createPlates(){
      const positions=[[cx-1,cz-1],[cx+1,cz-1],[cx-1,cz+1],[cx+1,cz+1]]; // Plate centers share the blocks' 1-unit slide lattice; half-tile offsets make a plate impossible to fill.
      positions.forEach(([x,z],index)=>{
        const mesh=cube('find-blocks-pressure-plate-'+index,x,z,floorY-.025,.91,.06,.91,COLOR.stone);
        const line=cube('find-blocks-plate-frame-'+index,x,z,floorY+.04,.64,.04,.64,COLOR.stone);
        const signal=root.FurniturePatternSurfaces?.attachStoneSignal?.(line,{
          width:.48,height:.48,idleColor:'#e2ad62',activeColor:'#65ffaf',
        }); // A seated block lights the inset glyph; neither slab changes texture/color.
        mesh.userData.findBlocksPressurePlate=index;line.userData.devRuinFootprintIgnore=true;
        plates.push({mesh,signal,x,z,filled:false,lastVisualFilled:false,block:null});
      });
    }
    // Fixed sparse columns make real, visible obstructions rather than hard-coded block lanes.
    function ordinaryPillars(){
      for(const [n,x,z] of [[0,cx-3,cz-.5],[1,cx+3,cz-.5],[2,cx+.5,cz+4]]){
        cube('find-blocks-blocker-'+n,x,z,floorY,.94,2.05,.94,COLOR.stone);
        solid('normal-pillar-'+n,x,z,.46,.46);
      }
    }
    function releaseControls(){
      for(const item of controls){
        if(kit.removeControl)kit.removeControl(item);
        else{const i=kit.state.controls.indexOf(item);if(i>=0)kit.state.controls.splice(i,1);}
      }
      controls.length=0; // Solved rooms must not keep inactive brazier/bomb prompts that claim the player's attack action.
    }
    function openGate(){
      if(solved)return;
      solved=true;
      releaseControls();
      onSolved();
    }
    const gateX=cx,gateZ=room.z+room.d-1.1; // The far-side sealed doorway visibly rises on completion.
    const gate=options.showGate===false?null:cube('find-blocks-gate',gateX,gateZ,floorY,2.2,2.9,.3,COLOR.stone);
    const gateStart=gate?.position.y??0; // Layered wings already own a progression gate; never add a duplicate slab.
    if(gate)solid('gate',gateX,gateZ,1.1,.18,()=>alive()&&!solved);

    function teardown(){
      if(disposed)return;
      disposed=true;
      melody?.dispose?.();
      netChallenge?.dispose?.();
      for(const burn of burnIds)fire?.unregisterTarget?.(burn);
      for(const stop of disposers)stop();
      releaseControls();
      for(const block of blocks)game.unregisterLabPushBlock?.(block.mesh); // Release native V50 block collision and interactions, including partially installed rooms.
      occupancy?.clearSolids?.(solidOwner);
      kit.disposeObject(group);
    }
    try{
      createPlates();
      ordinaryPillars();
      fireSource();
      netSource();
      iceSource();
      climbingSource();
      pillarSource();
    }catch(error){
      try{teardown();}catch(cleanupError){root.console?.warn?.('[Find the Blocks] partial setup cleanup failed',cleanupError);}
      throw error; // Never leave a half-generated chamber registered as a playable stage.
    }

    const result={id,kind:'findBlocks',ready:true,linked:true,variant,netVariant,stairMirror,blocks,plates,
      get solved(){return solved;},
      tick(dt){
        if(!alive())return;
        const step=Math.max(0,Math.min(.05,Number(dt)||0));
        melody?.tick?.(step);
        melody?.animate?.(step);
        netChallenge?.tick?.(step);
        netChallenge?.animate?.(step);
        if(bombTargetFlash>0){
          bombTargetFlash=Math.max(0,bombTargetFlash-step);
          if(bombTargetFlash===0)bombTargetSignal?.setActive(false);
        }
        if(sinking){
          pillarHeight=Math.max(0,pillarHeight-step*1.45);
          const pillar=blocks[3].pillar;
          if(pillar){
            pillar.scale.y=Math.max(.001,pillarHeight/initialPillarHeight);
            pillar.position.y=floorY+pillarHeight*.5;
          }
          blocks[3].mesh.position.y=floorY+pillarHeight+BLOCK_SIZE*.5;
          if(pillarHeight<=.08){
            sinking=false;pillarLowered=true;pillarHeight=0;
            blocks[3].mesh.position.y=floorY+BLOCK_SIZE*.5;
            blocks[3].phase='ready';blocks[3].landed=true;
            blocks[3].mesh.userData.findBlocksAvailable=true;
          }
        }
        if(iceMelt>0&&iceMelt<1){
          iceMelt=Math.min(1,iceMelt+step/.85);
          if(iceLayer)root.IceStalagmiteCoverage?.setGrowth?.(iceLayer,1-iceMelt);
          if(iceMelt>=1){
            blocks[1].iceRoot.visible=false;
            startFall(blocks[1]);
          }
        }
        for(const b of blocks){
          if(b.phase==='ready'&&b.mesh.userData.findBlocksCanDrop&&!game.isSlidingPushBlock?.(b.mesh)){
            const high=Number(b.mesh.userData.findBlocksFloorY)+.55;
            const supportAtHeight=root.DynamicSurfaces?.sampleSupport?.(b.mesh.position.x,b.mesh.position.z,{
              minY:high,maxY:b.mesh.position.y+.05,pad:.01});
            if(!supportAtHeight)startFall(b);
          }
          if(b.phase!=='falling')continue;
          b.fallSpeed+=FALL_ACCEL*step;
          b.mesh.position.y=Math.max(floorY+BLOCK_SIZE*.5,b.mesh.position.y-b.fallSpeed*step);
          if(b.mesh.position.y<=floorY+BLOCK_SIZE*.5+.0001)finishFall(b);
        }
        for(const chip of chips){
          if(chip.life<=0)continue;
          chip.life-=step;chip.vy-=FALL_ACCEL*step;
          chip.mesh.position.x+=chip.vx*step;chip.mesh.position.z+=chip.vz*step;
          chip.mesh.position.y=Math.max(floorY+.07,chip.mesh.position.y+chip.vy*step);
          if(chip.life<=0)chip.mesh.visible=false;
        }
        let weighted=0; // Plate state is recalculated from live block positions, not latched when a block merely passes across.
        for(const plate of plates){
          const found=blocks.find(b=>b.phase==='ready'&&!game.isSlidingPushBlock?.(b.mesh)
            &&Math.abs(b.mesh.position.y-BLOCK_SIZE*.5-floorY)<.12
            &&Math.abs(b.mesh.position.x-plate.x)<PLATE_REACH
            &&Math.abs(b.mesh.position.z-plate.z)<PLATE_REACH);
          plate.block=found?.name||null;
          plate.filled=!!found;
          root.RuinInteractionAudio?.watchPlate?.(plate.mesh,plate.filled); // A pushed block seating on or leaving a stone socket clicks once.
          if (plate.filled !== plate.lastVisualFilled) {
            plate.signal?.setActive(plate.filled);
            plate.lastVisualFilled=plate.filled;
          } // Only occupancy transitions update glyphs; no per-frame stone tint writes.
          if(found)weighted++;
        }
        if(weighted===4)openGate();
        if(solved&&gate){
          gate.position.y=Math.min(gateStart+3.2,gate.position.y+step*3.6);
          root.RuinInteractionAudio?.watchMovement?.(gate,(gate.position.y-gateStart)/3.2); // Rumble on the physical gate's rise, not every solved frame.
        }
      },
      snapshot(){return {id,variant,netVariant,stairMirror,solved,ceilingY:ceiling,stairRise,initialPillarHeight,weighted:plates.filter(p=>p.filled).length,
        blocks:blocks.map(b=>({name:b.name,phase:b.phase,x:b.mesh.position.x,z:b.mesh.position.z,
          y:b.mesh.position.y,available:b.mesh.userData.findBlocksAvailable})),
        targets:targets.map(t=>({id:t.id,hit:t.active})),pillarHeight,
        melody:melody?{notes:melody.notes?.slice(),attempts:melody.attempts,
          heardNotes:melody.heardNotes?.slice(),inscription:melody.inscription?.diagnostics?.()}:null, // Mobile snapshot reveals manual input and plate-visible carved notes.
        iceMelt,fireReady:!!fire,witchBombReady:!!bombs};},
      dispose:teardown, // Both normal teardown and failed initialization use identical scoped cleanup.
    };
    return result;
  }

  return Object.freeze({create});
});
