// Native V50 room adapter for RuinHiddenSecrets. Runs after required room composers;
// only currently unclaimed, flat, large rooms may host optional discoveries.
(() => {
  'use strict';
  const puzzles=window.DevRandomRuinSimplePuzzles;
  const secrets=window.RuinHiddenSecrets;
  if(!puzzles?.registerComposer||!secrets?.create)return;
  const placements=[]; // The native room composer owns each scene's optional cache/nest lifecycle.
  const controls=[]; // Exposed through the V50 interaction resolver, never a global input hook.
  const refused=[]; // Human-readable placement reasons for mobile ruin diagnostics.
  function clear(){
    for(const secret of placements)secret.dispose?.();
    placements.length=0;controls.length=0;refused.length=0;
  }
  function buildLate(kit,context,_rng,usedRooms){
    if(context.singleRoomTrial||context.hachutu===true)return;
    const seed=Number(context.seed)||0,theme=context.theme||window.DevRandomRuin?.getState?.()?.theme||'hronal';
    const rooms=(context.meta?.rooms||[]).filter(room=>!usedRooms.has(room.id));
    for(const room of rooms){
      if(placements.length>=3)break; // Cheaply cap animated secret mechanisms in an already busy V50 interior.
      const bounds=kit.roomBounds(context.meta,room);
      const w=bounds.maxX-bounds.minX,d=bounds.maxZ-bounds.minZ;
      if(w<10||d<10)continue; // A secret cannot displace the player's main room puzzle or doorway.
      const x=(bounds.minX+bounds.maxX)*.5,z=(bounds.minZ+bounds.maxZ)*.5;
      const support=kit.sampleSupport(x,z);
      if(!support||!Number.isFinite(Number(support.y))){refused.push(String(room.id)+': no floor support');continue;}
      const roomSpec={id:'v50-'+room.id,kind:'challenge-room',challenge:'pressurePlate',
        x:bounds.minX,z:bounds.minZ,w,d,y:Number(support.y)};
      const planned=secrets.planForRoom(roomSpec,seed,theme); // Plan once; extra validation must never re-roll the selected type.
      if(!planned)continue;
      // Use the same corner-sized, floor-anchored layout as RuinHiddenSecrets; the old
      // adapter rejected all four corners before checking the actual optional puzzle footprint.
      const sites=planned.kind==='closet'
        ?[[1.55,1.55],[2.6,2.55],[3.3,1.95],[4.6,3.4]]
        :planned.kind==='suspended'?[[1.55,1.55],[2.6,2.55],[2.5,2.35]]
        :[[1.55,1.55],[2.6,2.55]];
      const grounded=(corner,dx,dz)=>{
        const left=(corner&1)===0,top=(corner&2)===0;
        const px=(left?bounds.minX:bounds.maxX)+(left?dx:-dx);
        const pz=(top?bounds.minZ:bounds.maxZ)+(top?dz:-dz);
        if(px<bounds.minX+.55||px>bounds.maxX-.55||pz<bounds.minZ+.55||pz>bounds.maxZ-.55)return false;
        const sample=kit.sampleSupport(px,pz);
        return !!sample&&Math.abs(Number(sample.y)-roomSpec.y)<=.12
          &&window.DevRandomRuinTileOccupancy?.solidAt?.(px,pz,.22,roomSpec.y)!==true;
      };
      const validCorner=Array.from({length:4},(_,offset)=>(planned.corner+offset)%4)
        .find(corner=>sites.every(([dx,dz])=>grounded(corner,dx,dz)));
      if(validCorner===undefined){refused.push(String(room.id)+': optional puzzle has no grounded, reachable corner');continue;}
      const owner=secrets.create({room:roomSpec,seed,theme,ruinTier:context.tier,
        allowBrood:placements.filter(entry=>entry.babies>0).length<1, // Only one supplementary native-V50 brood per ruin.
        THREE:kit.THREE,parent:kit.group(),mapId:context.mapId||'map_i_dev_random_ruin',
        getPlayerPosition:()=>{const p=kit.playerWorld();return p&&{x:p.x,z:p.z};},
        getPlayerY:()=>{const physical=window.DevRandomRuin?.getPlayerGroundSupportY?.(); // Physical supported feet, not presentation/bob offsets.
          return Number.isFinite(physical)?physical:kit.playerWorld()?.y;},
        addControl:c=>controls.push(c),
        removeControl:c=>{const index=controls.indexOf(c);if(index>=0)controls.splice(index,1);},
        showToast:kit.deps?.showToast,
      });
      if(owner){placements.push(owner);usedRooms.add(room.id);}
    }
  }
  function update(kit,_now,dt){
    const p=kit.playerWorld();
    if(!p)return;
    const floor=window.DevRandomRuin?.getPlayerGroundSupportY?.(); // Every stacked room checks the actor's real occupied story.
    const actualY=Number.isFinite(floor)?floor:p.y;
    for(const owner of placements)
      if(Math.abs(Number(actualY)-owner.y)<1.25&&Math.hypot(p.x-owner.x,p.z-owner.z)<20)
        owner.tick?.(dt); // Room-local optional input and fire checks never scan faraway inactive rooms.
  }
  function snapshot(){
    return {placed:placements.length,refused:refused.slice(),
      rooms:placements.map(owner=>owner.snapshot?.())};
  }
  puzzles.registerComposer({id:'ruinHiddenSecrets',buildLate,update,clear,controls:()=>controls,snapshot});
  window.RuinHiddenSecretsNative=Object.freeze({snapshot});
})();
