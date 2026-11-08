// Projected ruin fire shadows for the existing 2D darkness compositor.
// The actual masonry/doors/obelisks supply occluder bounds; no gameplay collision or 3D light material is changed.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinLightOcclusion=api;
})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const MAX_CASTERS=240,MAX_SHADOWS_PER_LIGHT=14,WALL_CAP=26,SCAN_INTERVAL_MS=1800; // Bounds the mobile draw cost; scene discovery is never repeated per torch.
  let cachedScene=null,cachedAt=-Infinity,cachedCandidates=[]; // Reused until a new dungeon/scene is mounted or the scene's props change.
  const boxCache=new WeakMap(); // Cache world-space bounds across sources; moving pillars refresh much more often than static masonry.
  const root=typeof self!=='undefined'?self:globalThis;
  let enabled=true; // Debug switch: RuinLightOcclusion.setEnabled(false) removes every projected shadow wedge.
  const stats={candidates:0,lights:0,shadows:0}; // Readable through the mobile debug console or Pixel Probe.
  const BLOCKER_NAME=/obelisk-.*-stone|pillar|column|wall|stone.door|push.*block|boulder|statue/i;
  const DECORATION_NAME=/ladder|rung|engraving|glyph|pattern|light|flame|sconce|roof|floor|ceiling|seal|shadow/i;
  const angularDifference=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
  function visibleThroughParents(node){
    for(let owner=node;owner;owner=owner.parent)if(owner.visible===false)return false;
    return true; // Hidden upper floors and unmounted decoration must not create black shadows.
  }
  function candidates(scene,now){
    if(scene===cachedScene&&now-cachedAt<SCAN_INTERVAL_MS)return cachedCandidates;
    cachedScene=scene;cachedAt=now;cachedCandidates=[];
    stats.lights=stats.shadows=0; // Mobile diagnostics describe the latest discovery window, rather than rising forever.
    const pillars=[],ordinary=[]; // Reserve shadow-caster capacity for tall moving obelisks, even if room walls traverse first.
    scene?.traverse?.(node=>{
      if(!node.isMesh||node.isInstancedMesh||!visibleThroughParents(node))return;
      const name=String(node.name||''),parentName=String(node.parent?.name||'');
      const role=String(node.userData?.interiorRuinRole||node.parent?.userData?.interiorRuinRole||'');
      const physics=node.userData||{};
      const solid=!!(physics.ruinInteriorWall||physics.transitDoor||physics.pushable||physics.blocksLight);
      if(node.userData?.devRuinFootprintIgnore||DECORATION_NAME.test(name)&&!solid)return;
      if(!BLOCKER_NAME.test(name+' '+parentName+' '+role)&&!solid)return; // Respect the existing ruin solid-object tags even when a mesh name is generic.
      const material=Array.isArray(node.material)?node.material[0]:node.material;
      if(!material||material.visible===false||material.transparent&&Number(material.opacity)<.5)return;
      const priority=/obelisk-.*-stone|pillar|column/i.test(name+' '+parentName+' '+role);
      if(priority&&pillars.length<64)pillars.push(node);
      else if(ordinary.length<MAX_CASTERS)ordinary.push(node);
    });
    cachedCandidates=pillars.concat(ordinary.slice(0,MAX_CASTERS-pillars.length));
    stats.candidates=cachedCandidates.length;
    return cachedCandidates;
  }
  // Wing and shaft walls are a few huge merged meshes; their bounding boxes enclose the
  // torches inside them, which (correctly, for a lone prop) casts no shadow — so a whole
  // wing leaked light through its own walls. The real collision grid is a better caster:
  // each floor's blocked cells, merged into short wall runs (<= 3 cells, so a torch
  // mounted in a wall only skips its own few cells), cached for a couple of seconds.
  const wallCache=new Map(),WALL_RUN=3,WALL_HEIGHT=2.3,WALL_CACHE_MS=2500;
  function wallRects(floor,now){
    const cached=wallCache.get(floor);
    if(cached&&now-cached.at<WALL_CACHE_MS)return cached;
    const map=root.DevRandomRuin?.getShaftCollisionMap?.(floor);
    const rects=[];
    if(map?.blocked?.length){
      const rows=new Map();
      for(const key of map.blocked){const [c,r]=key.split(',').map(Number);if(!rows.has(r))rows.set(r,[]);rows.get(r).push(c);}
      for(const [r,cols] of rows){
        cols.sort((a,b)=>a-b);
        for(let i=0;i<cols.length;){
          let j=i;while(j+1<cols.length&&cols[j+1]===cols[j]+1&&j-i+1<WALL_RUN)j++;
          rects.push({c0:cols[i],c1:cols[j]+1,r0:r,r1:r+1});i=j+1;
        }
      }
    }
    const entry={at:now,rects,y:Number(map?.y)||0,floorHeight:Number(map?.floorHeight)||4,floorCount:Number(map?.floorCount)||1};
    wallCache.set(floor,entry);return entry;
  }
  const tileBox={min:{x:0,y:0,z:0},max:{x:0,y:0,z:0}}; // Reused: shadowPolygon only reads it.
  function wallShadows(source,radiusTiles,project,now){
    const probe=wallRects(0,now);
    const floorHeight=probe.floorHeight||4,floor=Math.max(0,Math.min((probe.floorCount||1)-1,Math.round((Number(source.y)-1.3)/floorHeight)));
    const entry=floor===0?probe:wallRects(floor,now);
    const base=floor*floorHeight,out=[];
    const sx=Number(source.x),sz=Number(source.z);
    for(const rect of entry.rects){
      const nx=Math.max(rect.c0,Math.min(sx,rect.c1)),nz=Math.max(rect.r0,Math.min(sz,rect.r1));
      const distance=Math.hypot(nx-sx,nz-sz);
      if(distance>=radiusTiles)continue;
      tileBox.min.x=rect.c0;tileBox.min.y=base;tileBox.min.z=rect.r0;
      tileBox.max.x=rect.c1;tileBox.max.y=base+WALL_HEIGHT;tileBox.max.z=rect.r1;
      const hit=shadowPolygon(tileBox,source,radiusTiles,project);
      if(hit)out.push(hit);
    }
    return out;
  }
  function shadowPolygon(box,source,radiusTiles,project){
    const sx=Number(source.x),sz=Number(source.z);
    if(!Number.isFinite(sx)||!Number.isFinite(sz))return null;
    const nearestX=Math.max(box.min.x,Math.min(sx,box.max.x));
    const nearestZ=Math.max(box.min.z,Math.min(sz,box.max.z));
    const distance=Math.hypot(nearestX-sx,nearestZ-sz);
    if(distance>=radiusTiles||distance<.28)return null; // An attached wall torch must not shadow itself.
    if(sx>=box.min.x-.2&&sx<=box.max.x+.2&&sz>=box.min.z-.2&&sz<=box.max.z+.2)return null;
    if(box.max.y<source.y-2||box.min.y>source.y+.35)return null;
    const corners=[{x:box.min.x,z:box.min.z},{x:box.max.x,z:box.min.z},
      {x:box.max.x,z:box.max.z},{x:box.min.x,z:box.max.z}];
    const center=Math.atan2((box.min.z+box.max.z)/2-sz,(box.min.x+box.max.x)/2-sx);
    const angles=corners.map(c=>angularDifference(Math.atan2(c.z-sz,c.x-sx),center));
    const lo=angles.indexOf(Math.min(...angles)),hi=angles.indexOf(Math.max(...angles));
    const depth=Math.max(radiusTiles*1.8,Math.hypot(corners[lo].x-sx,corners[lo].z-sz)+2);
    const y=Math.max(box.min.y+.05,Math.min(source.y,box.max.y-.05)); // Cast at a height actually intersecting the solid.
    const edge=(corner)=>{
      const dx=corner.x-sx,dz=corner.z-sz,d=Math.hypot(dx,dz)||1;
      const near=project(corner.x,y,corner.z),far=project(sx+dx/d*depth,y,sz+dz/d*depth);
      return {near:near&&{x:near.x,y:near.y},far:far&&{x:far.x,y:far.y}}; // Some overlay projection callbacks reuse one mutable result object.
    };
    const a=edge(corners[lo]),b=edge(corners[hi]);
    const polygon=[a.near,a.far,b.far,b.near];
    return polygon.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y))?{polygon,distance}:null;
  }
  function projectedShadows({scene,source,radiusTiles,project,THREE,now=Date.now()}={}){ // `root` below is the global object.
    if(!enabled||!scene||!source||!(radiusTiles>0)||typeof project!=='function'||!THREE?.Box3)return [];
    const casters=candidates(scene,now),boxes=[];
    stats.lights++;
    for(const node of casters){
      if(!node.parent||!visibleThroughParents(node))continue;
      let cached=boxCache.get(node);
      const mobile=/obelisk|moving|door|push/i.test(String(node.name||'')+' '+String(node.parent?.name||''));
      if(!cached||now-cached.at>(mobile?30:1200)){
        node.updateWorldMatrix?.(true,false);
        cached={at:now,box:new THREE.Box3().setFromObject(node)};
        boxCache.set(node,cached);
      }
      const box=cached.box;
      if(box.isEmpty()||box.max.y-box.min.y<.35)continue;
      // Mesh origins are not necessarily centered on their world-space masonry geometry.
      const nearestX=Math.max(box.min.x,Math.min(source.x,box.max.x));
      const nearestZ=Math.max(box.min.z,Math.min(source.z,box.max.z));
      if(Math.hypot(nearestX-source.x,nearestZ-source.z)>=radiusTiles)continue;
      const hit=shadowPolygon(box,source,radiusTiles,project);
      if(hit)boxes.push(hit);
    }
    for(const hit of wallShadows(source,radiusTiles,project,now))boxes.push(hit); // Grid walls: precise per-run shadows for merged wing/shaft masonry.
    boxes.sort((a,b)=>a.distance-b.distance);
    const result=boxes.slice(0,MAX_SHADOWS_PER_LIGHT+WALL_CAP).map(entry=>entry.polygon);
    stats.shadows+=result.length;return result;
  }
  function withClip(ctx,polygons,draw){
    if(!polygons?.length||typeof ctx?.clip!=='function')return draw();
    ctx.save();
    try{
      for(const points of polygons){
        ctx.beginPath();ctx.rect(-100000,-100000,200000,200000);
        ctx.moveTo(points[0].x,points[0].y);
        for(let i=1;i<points.length;i++)ctx.lineTo(points[i].x,points[i].y);
        ctx.closePath();ctx.clip('evenodd'); // One exclusion per occluder: overlapping shadows must not cancel each other.
      }
      return draw();
    }finally{ctx.restore();}
  }
  return Object.freeze({setEnabled:on=>{enabled=on!==false;},isEnabled:()=>enabled,projectedShadows,shadowPolygon,withClip,debugSnapshot:()=>({...stats}),
    __test:Object.freeze({angularDifference})});
});
