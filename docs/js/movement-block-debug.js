// MovementBlockDebug — console helper: "why can't I walk that way?"
//   MovementBlockDebug.explain()           probes 8 directions around the player
//   MovementBlockDebug.explain({reach:.6}) probes further out
// Mirrors game.js canOccupyAt/canPlayerOccupy: closed interior doors, the footprint registry (with the provider id
// that blocked), table furniture, tile speed (solid/void tiles), DynamicSurfaces blockers and, inside a ruin, the
// shaft voxel grid. Reads only globals; changes nothing.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MovementBlockDebug=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const DIRS=[['E',1,0],['SE',.7071,.7071],['S',0,1],['SW',-.7071,.7071],['W',-1,0],['NW',-.7071,-.7071],['N',0,-1],['NE',.7071,-.7071]];
  function reasonsAt(wx,wz,half,feetY,ctx){
    const out=[],T=ctx.TILE,area=ctx.area;
    if(root.InteriorDoorTiles?.blocksBox?.(area,wx,wz,half))out.push('closed interior door');
    const ids=root.AreaFootprintBlockers?.explain?.(area,wx,wz,half,null)||[];
    for(const id of ids)out.push('footprint:'+id);
    if(root.FurnitureTableSystem?.blocksBox?.(area,wx,wz,half,null))out.push('furniture table');
    if(ctx.tileSpeedAt){
      for(const [dx,dz] of [[-half,-half],[half,-half],[-half,half],[half,half]]){
        if(ctx.tileSpeedAt((wx+dx)*T,(wz+dz)*T,null)===null){out.push('tile not walkable at '+Math.floor(wx+dx)+','+Math.floor(wz+dz));break;}
      }
    }
    const b=root.DynamicSurfaces?.blockerAt?.(wx,wz,{worldY:feetY,radius:half,actorHeight:1.25});
    if(b)out.push('dynamic blocker:'+b.id);
    const floors=root.DevRandomRuin?.getShaftCollisionMap;
    if(floors&&area==='map_i_dev_random_ruin'){
      for(let f=0;f<8;f++){
        const m=floors(f);if(!m)break;
        if(Math.abs((Number(m.y)||0)-feetY)>1.5)continue;
        if(m.blocked?.has?.(Math.floor(wx)+','+Math.floor(wz))||(Array.isArray(m.blocked)&&m.blocked.includes(Math.floor(wx)+','+Math.floor(wz))))out.push('ruin shaft wall cell (floor '+f+') at '+Math.floor(wx)+','+Math.floor(wz));
      }
    }
    return out;
  }
  function explain({reach=.35,half=.2}={}){
    const dbg=root.__climbDebug,player=dbg?.getPlayer?.();
    if(!player)return 'no player';
    const ctx={TILE:64,area:dbg.getCurrentArea?.(),tileSpeedAt:dbg.tileSpeedAt};
    const feetY=Number(player.physicalFeetY)||0,px=player.x/ctx.TILE,pz=player.y/ctx.TILE;
    const report={area:ctx.area,tile:Math.floor(px)+','+Math.floor(pz),feetY:+feetY.toFixed(2),here:reasonsAt(px,pz,half,feetY,ctx),directions:{}};
    for(const [name,dx,dz] of DIRS){
      const r=reasonsAt(px+dx*reach,pz+dz*reach,half,feetY,ctx);
      report.directions[name]=r.length?r:'clear';
    }
    return report;
  }
  return Object.freeze({explain,reasonsAt});
});
