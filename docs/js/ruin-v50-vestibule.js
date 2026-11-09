// RuinV50Vestibule — place one native V50 entrance chamber directly beside the shared shaft.
// The V50 doorway becomes the shaft approach; arrival is at the far side of that room.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinV50Vestibule=api;
})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const SIDES={north:{dx:0,dz:-1,hub:'S'},east:{dx:1,dz:0,hub:'W'},
    south:{dx:0,dz:1,hub:'N'},west:{dx:-1,dz:0,hub:'E'}};
  function compose({meta,seed,LayerPlan,ShaftHub,Connector,tileScale=2,anchor=256,gap=6,plinthTrial=false,tier=null,theme=null}={}){
    const orientation=SIDES[meta?.entrance?.side];
    if(!orientation||!LayerPlan?.compose||!ShaftHub?.compose||!Connector?.entranceOutside)
      throw new Error('V50 entrance cannot be oriented toward a physical shaft.');
    const plan=LayerPlan.compose({seed,spacing:64,anchorX:anchor,anchorZ:anchor,
      shaftSize:45,floorHeight:16,nativeV50:true,plinthTrial,theme,groundEntranceSide:orientation.hub,
      ...(LayerPlan.tierOptions?.(tier)||{})}); // A rarity tier overrides floors, shaft size, wing counts and traversal (js/ruin-layer-plan.js TIERS).
    if(!plan.ok)throw new Error('V50 vestibule shaft plan invalid: '+plan.checks.filter(c=>!c.ok).map(c=>c.name).join(','));
    const portals=plan.floors.flatMap(f=>[
      ...f.wings.map(w=>({floor:f.floor,side:w.side})),
      ...(f.nativePort?[{floor:f.floor,side:f.nativePort.side}]:[]),
    ]);
    const shell=ShaftHub.compose({seed,floors:plan.floorCount,chambers:false,
      wall:plan.options.shaftWall,shaft:plan.options.shaftSize,
      spacing:plan.options.floorHeight,traversal:plan.options.shaftTraversal,entranceSide:orientation.hub,portals,
      originX:anchor-Math.floor((plan.options.shaftSize+plan.options.shaftWall*2)/2),
      originZ:anchor-Math.floor((plan.options.shaftSize+plan.options.shaftWall*2)/2)});
    if(!shell.ok)throw new Error('V50 vestibule shaft geometry is invalid.');
    const mouth={x:Math.floor(shell.grid.colToX(shell.entrance.col+.5)),
      z:Math.floor(shell.grid.rowToZ(shell.entrance.row+.5))};
    const raw=Connector.entranceOutside(meta,{x:0,z:0},tileScale);
    if(!raw)throw new Error('V50 vestibule has no exterior door.');
    const padX=mouth.x-orientation.dx*gap-raw.x;
    const padZ=mouth.z-orientation.dz*gap-raw.z;
    if(padX<4||padZ<4)throw new Error('V50 vestibule approaches negative map coordinates.');
    return {plan,padX,padZ,mouth,entranceSide:orientation.hub,
      distance:gap,side:meta.entrance.side};
  }
  function spawnAcrossRoom({meta,padX,padZ,tileScale=2,floorSet}={}){
    const room=meta?.rooms?.find(r=>r.id===meta?.entrance?.roomId)||meta?.rooms?.[0];
    if(!room||!floorSet?.size)throw new Error('V50 vestibule has no walkable native chamber.');
    const side=meta.entrance.side,cs=(Number(meta.cellSize)||.5)*tileScale;
    // The spawn sits near the wall opposite V50's existing open doorway.
    const wantedX=side==='east'?room.col+2:side==='west'?room.col+room.w-3:room.col+room.w/2;
    const wantedZ=side==='south'?room.row+2:side==='north'?room.row+room.h-3:room.row+room.h/2;
    let best=null;
    for(let z=room.row+1;z<room.row+room.h-1;z++)
      for(let x=room.col+1;x<room.col+room.w-1;x++){
        const wx=padX+(x+.5)*cs,wz=padZ+(z+.5)*cs;
        const tile=Math.floor(wx)+','+Math.floor(wz);
        if(!floorSet.has(tile))continue;
        const score=(x-wantedX)**2+(z-wantedZ)**2;
        if(!best||score<best.score)best={x:wx,z:wz,score};
      }
    if(!best)throw new Error('V50 vestibule has no valid opposite-wall spawn.');
    return {x:best.x,z:best.z};
  }
  return Object.freeze({compose,spawnAcrossRoom});
});
