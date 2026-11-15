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
      if(!secrets.planForRoom(roomSpec,seed,theme))continue;
      // Source rooms may have steps; corners are only suitable if their real standing heights match.
      const corners=[[1.55,1.55],[w-1.55,1.55],[1.55,d-1.55],[w-1.55,d-1.55]];
      if(!corners.every(([ox,oz])=>{
        const sample=kit.sampleSupport(bounds.minX+ox,bounds.minZ+oz);
        return sample&&Math.abs(Number(sample.y)-roomSpec.y)<.08;
      })){refused.push(String(room.id)+': corner has a step');continue;}
      const owner=secrets.create({room:roomSpec,seed,theme,ruinTier:context.tier,
        THREE:kit.THREE,parent:kit.group(),mapId:context.mapId||'map_i_dev_random_ruin',
        getPlayerPosition:()=>{const p=kit.playerWorld();return p&&{x:p.x,z:p.z};},
        getPlayerY:()=>kit.playerWorld()?.y,
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
    for(const owner of placements)
      if(Math.abs(Number(p.y)-owner.y)<1.25&&Math.hypot(p.x-owner.x,p.z-owner.z)<20)
        owner.tick?.(dt); // Room-local optional input and fire checks never scan faraway inactive rooms.
  }
  function snapshot(){
    return {placed:placements.length,refused:refused.slice(),
      rooms:placements.map(owner=>owner.snapshot?.())};
  }
  puzzles.registerComposer({id:'ruinHiddenSecrets',buildLate,update,clear,controls:()=>controls,snapshot});
  window.RuinHiddenSecretsNative=Object.freeze({snapshot});
})();
