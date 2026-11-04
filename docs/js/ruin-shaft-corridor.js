// RuinShaftCorridor — ordinary walkable 2D hallway from an existing ruin entrance
// to the shared multi-floor shaft, with no onPress warp or scene transition.
// Routes through clear exterior space instead of cutting the existing V50 puzzles.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinShaftCorridor=api;
})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const dirs=[[1,0],[0,1],[-1,0],[0,-1]];
  const key=(x,z)=>x+','+z;
  function route({start,end,width=3,existing=new Set(),mainBounds,shaftBounds,maxX,maxZ}={}){
    const a={x:Math.floor(Number(start?.x)),z:Math.floor(Number(start?.z))};
    const b={x:Math.floor(Number(end?.x)),z:Math.floor(Number(end?.z))};
    const w=Math.max(1,Math.min(5,Math.floor(Number(width)||3)));
    if(![a.x,a.z,b.x,b.z,maxX,maxZ].every(Number.isFinite)||maxX<2||maxZ<2)
      return {ok:false,reason:'missing finite corridor boundaries'};
    const within=(p,box)=>box&&p.x>=box.minX&&p.x<box.maxX&&p.z>=box.minZ&&p.z<box.maxZ;
    const bounds=p=>p.x>=1&&p.z>=1&&p.x<maxX-1&&p.z<maxZ-1;
    if(!bounds(a)||!bounds(b))return {ok:false,reason:'entry or shaft mouth outside map'};
    const goal=key(b.x,b.z),origin=key(a.x,a.z);
    const pass=p=>bounds(p)&&(key(p.x,p.z)===origin||key(p.x,p.z)===goal||
      (!within(p,mainBounds)&&!within(p,shaftBounds)&&!existing.has(key(p.x,p.z))));
    const queue=[a],parents=new Map([[origin,null]]);
    let head=0;
    while(head<queue.length&&!parents.has(goal)){
      const cell=queue[head++];
      for(const [dx,dz] of dirs){
        const point={x:cell.x+dx,z:cell.z+dz},k=key(point.x,point.z);
        if(parents.has(k)||!pass(point))continue;
        parents.set(k,key(cell.x,cell.z));queue.push(point);
        if(k===goal)break;
      }
    }
    if(!parents.has(goal))return {ok:false,reason:'no physical exterior route from ruin entrance to shaft'};
    const path=[];
    for(let cursor=goal;cursor!==null;cursor=parents.get(cursor)){
      const [x,z]=cursor.split(',').map(Number);path.push({x,z});
    }
    path.reverse();
    const tiles=new Set(),half=Math.floor(w/2); // Three-cell-wide walkable hall, narrowed near authored door openings.
    for(let i=0;i<path.length;i++){
      const p=path[i];
      const radius=i<3||i>path.length-4?0:half;
      for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
        const cell={x:p.x+dx,z:p.z+dz};
        if(bounds(cell)&&(key(cell.x,cell.z)===origin||key(cell.x,cell.z)===goal||
          !within(cell,mainBounds)&&!within(cell,shaftBounds)&&!existing.has(key(cell.x,cell.z))))
          tiles.add(key(cell.x,cell.z));
      }
    }
    return {ok:true,path,tiles:[...tiles].map(k=>k.split(',').map(Number)),length:path.length-1,
      corners:path.slice(1,-1).filter((p,i)=>{const prior=path[i],next=path[i+2];return (p.x-prior.x)!==(next.x-p.x)||(p.z-prior.z)!==(next.z-p.z);}).length};
  }
  // Coalesce corridor cells into rectangles, avoiding hundreds of separate
  // DynamicSurfaces scans for a single long hallway.
  function rectangles(tiles){
    const byRow=new Map(); // Row -> sorted walkable columns.
    for(const cell of tiles||[]){
      const c=Number(cell?.[0]),r=Number(cell?.[1]);
      if(!Number.isInteger(c)||!Number.isInteger(r))continue;
      if(!byRow.has(r))byRow.set(r,new Set());
      byRow.get(r).add(c);
    }
    const output=[],rows=[...byRow.keys()].sort((a,b)=>a-b);
    let active=new Map(),lastRow=null;
    for(const r of rows){
      const spans=[];
      for(const c of [...byRow.get(r)].sort((a,b)=>a-b)){
        const last=spans[spans.length-1];
        if(last&&last.maxC+1===c)last.maxC=c;
        else spans.push({minC:c,maxC:c,minR:r,maxR:r});
      }
      if(lastRow!==null&&r!==lastRow+1){for(const p of active.values())output.push(p);active.clear();}
      const next=new Map();
      for(const p of spans){
        const name=p.minC+','+p.maxC,prev=active.get(name);
        if(prev){prev.maxR=r;next.set(name,prev);}
        else next.set(name,p);
      }
      for(const [name,p] of active)if(!next.has(name))output.push(p);
      active=next;lastRow=r;
    }
    for(const p of active.values())output.push(p);
    return output;
  }
  return Object.freeze({route,rectangles});
});
