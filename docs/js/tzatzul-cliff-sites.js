// Tzatzul bird-only cliff spires: no walkable terrain cells, no climb links.
(() => {
 'use strict';
 if(window.TzatzulCliffSites)return;
 const ZONES=['map_northern_cliffs','map_western_slope']; // Approved cliff territories.
 const areas=new Map(); // Owns scene meshes, perch registration and disposal.
 const debug={builds:0,releases:0,lastError:null}; // Mobile census.
 function plan(area,network,limit=2) {
  if(!ZONES.includes(area)||!network?.balconies?.length||!network.cols||!network.rows)return [];
  const out=[]; // Chosen without affecting the random creature/treasure streams.
  for(const s of [...network.balconies].sort((a,b)=>String(a.id).localeCompare(String(b.id)))) {
   if(out.length>=Math.max(0,Math.min(2,limit)))break;
   if(!s?.base?.footprint?.length||![s.x,s.z,s.y,s.normal?.x,s.normal?.z].every(Number.isFinite))continue;
   const len=Math.hypot(s.normal.x,s.normal.z);if(len<.1)continue;
   const dx=s.normal.x/len,dz=s.normal.z/len;
   const distance=Math.max(3.8,(Number(s.depth)||1)+2.4);
   const x=s.x+dx*distance,z=s.z+dz*distance,y=s.y+1.7;
   if(x<2||z<2||x>=network.cols-2||z>=network.rows-2)continue;
   if(out.some(p=>Math.hypot(p.x-x,p.z-z)<14))continue;
   if((network.balconies||[]).some(p=>Math.abs(p.y-y)<3.2&&Math.hypot(p.x-x,p.z-z)<2.7))continue;
   if((network.routes||[]).some(r=>(r.nodes||[]).some(p=>Math.abs(p.y-y)<2.1&&Math.hypot(p.x-x,p.z-z)<2.7)))continue;
   const slot=out.length; // Stable deterministic nest number, shared with the authored cave locale index.
   const id='tzatzul:'+area+':'+s.id;
   const caveMapId='map_i_den_tzatzul_'+area+'_'+slot; // Normal cave-internal map ID for game.js's existing building loader.
   out.push({id,caveMapId,slot,shelfId:s.id,x,z,y,dx,dz,
    height:Math.max(3.5,y-(Number(s.base.y)||s.y-3)+.55),
    perchId:id+':bird-perch',caveId:id+':cave',climbable:false});
  }
  return out;
 }
 function draw(s,scene,T) {
  const root=new T.Group(); // A single owner makes full scene unload cheap.
  root.name='tzatzul-nest-spire:'+s.shelfId;
  root.position.set(s.x,s.y-s.height/2,s.z);
  root.userData.tzatzulNest={id:s.id,caveId:s.caveId,caveMapId:s.caveMapId,climbable:false,encounterReady:!!window.TzatzulNestInterior?.isNestMap?.(s.caveMapId)}; // The cave is accessed through the carrier's native building transition.
  const base=new T.MeshBasicMaterial({color:0x45463f,side:T.DoubleSide});
  const rock=new T.Mesh(new T.CylinderGeometry(1.05,.32,s.height,7,3),base);
  window.NaturalSurfaceMaterials?.naturalizeMesh?.(rock,'cliffs','world-stretch'); // Canonical carved_smooth rock texture.
  const black=new T.MeshBasicMaterial({color:0x050607,side:T.DoubleSide});
  const mouth=new T.Mesh(new T.CircleGeometry(.38,12),black);
  mouth.name='tzatzul-dark-cave-mouth'; // Named geometry distinguishes visible sealed nest from future enterable cave runtime.
  mouth.rotation.y=Math.atan2(s.dx,s.dz);
  mouth.position.set(s.dx*1.05,s.height*.3,s.dz*1.05);
  const rim=new T.Mesh(new T.TorusGeometry(.40,.08,5,12),rock.material);
  rim.position.copy(mouth.position);rim.rotation.y=mouth.rotation.y;
  const crown=new T.Mesh(new T.TorusGeometry(.60,.13,5,9),rock.material);
  crown.rotation.x=Math.PI/2;crown.position.y=s.height/2;
  for(const m of [rock,mouth,rim,crown]) {m.userData.terrainJigsawIgnore=true;root.add(m);}
  scene.add(root);
  return {root,geo:[rock.geometry,mouth.geometry,rim.geometry,crown.geometry],material:[base,black]}; // Do not dispose shared natural cliff material.
 }
 function releaseArea(area) {
  const s=areas.get(area);if(!s)return false;areas.delete(area);
  for(const p of s.roosts)window.PerchSupport?.unregister?.(area,p.id);
  for(const a of s.art){a.root.parent?.remove(a.root);a.geo.forEach(g=>g.dispose?.());a.material.forEach(m=>m.dispose?.());}
  debug.releases++;return true;
 }
 function releaseInactive(current){for(const area of [...areas.keys()])if(area!==current)releaseArea(area);}
 function ensure(area,{zoneScenes,scene:given,network:givenNet,TILE=64}={}) {
  if(!ZONES.includes(area))return [];
  const network=givenNet||window.CliffRouteNetwork?.forArea?.(area);
  const scene=given||zoneScenes?.get?.(area)?.scene,T=window.THREE;
  if(!network||!scene?.add||!T?.CylinderGeometry||!window.PerchSupport?.point)return [];
  const prev=areas.get(area);if(prev?.network===network&&prev.scene===scene)return prev.roosts;
  if(prev)releaseArea(area);
  const roosts=[],art=[];
  try {
   for(const s of plan(area,network)){
    const support=window.PerchSupport.point(s.perchId,s.x*TILE,s.z*TILE,s.y);
    if(!window.PerchSupport.register(area,support))continue;
    roosts.push({id:s.perchId,support,caveMapId:s.caveMapId,shelf:{id:s.shelfId,x:s.x,z:s.z,y:s.y},site:s}); // Record first so a render exception cannot leak a registered bird perch.
    const mesh=draw(s,scene,T);art.push(mesh);
   }
   areas.set(area,{scene,network,roosts,art});debug.builds++;debug.lastError=null;
   return roosts;
  }catch(error){
   for(const r of roosts)window.PerchSupport.unregister(area,r.id);
   for(const a of art){a.root.parent?.remove(a.root);a.geo.forEach(g=>g.dispose?.());a.material.forEach(m=>m.dispose?.());}
   debug.lastError=String(error);
   window.__farmLog?.('[tzatzul] nest spire: '+debug.lastError,'warn','wildlife');
   return [];
  }
 }
 window.TzatzulCliffSites=Object.freeze({ZONES,plan,ensure,releaseArea,releaseInactive,
  snapshot:()=>({...debug,areas:[...areas].map(([area,s])=>({area,count:s.roosts.length,
   nests:s.roosts.map(r=>({id:r.site.id,x:r.site.x,z:r.site.z,y:r.site.y,climbable:false}))}))})});
})();