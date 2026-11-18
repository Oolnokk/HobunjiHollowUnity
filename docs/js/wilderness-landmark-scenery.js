// Tothal-seeded wilderness scenery and grounded landmarks for any future treasure hunt.
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.WildernessLandmarkScenery=api;})(typeof window!=='undefined'?window:globalThis,function(root){
'use strict';
const PILLARS=['ruinPillarBroken','ruinPillarStump','ruinRubblePile']; // Existing Debris-ifier-authored masonry, never substitute intact procedural pillars.
const cache=new WeakMap(); // Folded zone layout + world-cycle identity -> stable physical landmark positions.
let deps=null,scene=null,group=null,area='',serial=0,report=null,error=null; // WildernessMap supplies live area and scene lifecycle; report/error feed mobile diagnostics.
function hash(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function rng(seed){let v=seed>>>0;return()=>{v=(Math.imul(v^(v>>>15),2246822507)+0x9e3779b9)>>>0;return(v>>>8)/16777216;};}
function tileLookup(layout){
 const t=layout.tiles;
 if(typeof t?.get==='function')return(c,r)=>t.get(c+','+r);
 if(Array.isArray(t)&&Array.isArray(t[0]))return(c,r)=>t[r]?.[c];
 if(Array.isArray(t)){const m=new Map(t.map(v=>[(v.c??v.col)+','+(v.r??v.row),v]));return(c,r)=>m.get(c+','+r);}
 return(c,r)=>t?.[c+','+r];
}
function planForLayout(zoneId,layout,identity='world:shift'){
 if(!layout?.cols||!layout?.rows)return[];
 const key=zoneId+':'+identity,old=cache.get(layout);
 if(old?.key===key)return old.sites;
 const next=rng(hash(key)),at=tileLookup(layout),cols=layout.cols,rows=layout.rows;
 const occupied=[]; // Preserve entrances, authored locales, totems and the wilderness spawn clearing.
 for(const item of layout.localeInstances||[])occupied.push({c:Number(item.x??item.col),r:Number(item.y??item.row),d:6});
 for(const item of [...(layout.dens||[]),...(layout.animalDens||[])])occupied.push({c:Number(item.mouthAnchor?.x??item.x),r:Number(item.mouthAnchor?.y??item.y),d:5});
 for(const item of layout.rootTotems||[])occupied.push({c:Number(item.x),r:Number(item.y),d:4});
 if(layout.entry)occupied.push({c:Number(layout.entry.col??layout.entry.x),r:Number(layout.entry.row??layout.entry.y),d:8});
 const target=Math.max(10,Math.min(38,Math.round(cols*rows/630))),sites=[]; // Several dozen site markers per large wilderness, never a draw call per tile.
 for(let attempt=0;attempt<target*90&&sites.length<target;attempt++){
  const col=3+Math.floor(next()*(cols-6)),row=3+Math.floor(next()*(rows-6)),tile=at(col,row);
  if(!tile||tile.type!=='grass'||tile.water||tile.path||tile.incline||tile.ramp||tile.mapBoundary||tile.skipFloor||tile.generatedObjectType)continue;
  if([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const n=at(col+dx,row+dz);return!n||!['grass','weeds'].includes(n.type)||n.water||n.path||n.mapBoundary||(n.elevTier||0)!==(tile.elevTier||0);}))continue;
  if(occupied.some(p=>Number.isFinite(p.c)&&Number.isFinite(p.r)&&Math.hypot(col-p.c,row-p.r)<p.d))continue;
  if(sites.some(p=>Math.hypot(col-p.point.col,row-p.point.row)<9))continue;
  const roll=next(),kind=roll<.38?'stoneCairn':roll<.78?'brokenPillar':'deadTree';
  const name=kind==='stoneCairn'?'a stone cairn':kind==='brokenPillar'?'a broken stone pillar':'a dead tree';
  sites.push({id:zoneId+':'+sites.length,kind,name,point:{col,row},yaw:next()*Math.PI*2,size:.75+next()*.5,source:'generated-year-round-scenery'});
 }
 cache.set(layout,{key,sites});return sites;
}
function identity(){return String(deps?.tothalWorldId?.()||'world')+':'+String(deps?.currentTothalYear?.()||'shift');}
function landmarksFor(zoneId,layout){return planForLayout(zoneId,layout,identity());}
function elevation(site){const n=Number(deps?.TILE)||64,p=site.point,y=root.ClimbSystem?.groundYAt?.((p.col+.5)*n,(p.row+.5)*n);return y==null||!Number.isFinite(y)?0:y;}
function ignoreHits(node,shared=false){node.traverse?.(part=>{if(part.isMesh||part.isInstancedMesh)part.raycast=()=>{};if(shared&&part.geometry)part.userData.festivalSharedFoliage=true;});}
function cairns(T,host,sites){
 const list=sites.filter(s=>s.kind==='stoneCairn');if(!list.length)return;
 const mesh=new T.InstancedMesh(new T.DodecahedronGeometry(.22,0),new T.MeshLambertMaterial({color:0x929a91,flatShading:true}),list.length*7);
 const dummy=new T.Object3D(),tint=new T.Color();let index=0;
 for(const site of list){const rand=rng(hash(site.id)),base=elevation(site);
  for(let i=0;i<7;i++){const tier=i<4?0:i<6?1:2,orbit=tier===0?.27:tier===1?.15:0,angle=site.yaw+i*2.4,scale=site.size*(.8+rand()*.4);
   dummy.position.set(site.point.col+.5+Math.cos(angle)*orbit,base+.19+tier*.31,site.point.row+.5+Math.sin(angle)*orbit);
   dummy.rotation.set(rand()*.4,rand()*Math.PI*2,rand()*.4);
   dummy.scale.set(scale*(.8+rand()*.3),scale*(.65+rand()*.3),scale*(.8+rand()*.3));dummy.updateMatrix();
   mesh.setMatrixAt(index,dummy.matrix);mesh.setColorAt?.(index,tint.setHex([0x777f79,0xa3aaa1,0x868d88][Math.floor(rand()*3)]));index++;
  }
 }
 mesh.count=index;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
 mesh.name='wilderness-stone-cairns';mesh.raycast=()=>{};mesh.userData.wildernessLandmarkScenery=true;mesh.userData.ownsWildernessCairnBuffers=true;host.add(mesh);
}
function deadwood(host,sites){
 for(const site of sites.filter(s=>s.kind==='deadTree')){
  const tree=root.FoliageGenerator?.buildDeadTreeMesh?.(site.point.col,site.point.row);
  if(!tree){error='FoliageGenerator.buildDeadTreeMesh unavailable';continue;}
  tree.name='wilderness-dead-tree-landmark';tree.position.set(site.point.col+.5,elevation(site),site.point.row+.5);
  tree.rotation.y=site.yaw;tree.scale.multiplyScalar(site.size);tree.userData.wildernessLandmarkScenery=true;
  ignoreHits(tree,true);host.add(tree); // Decorative only, never entered into harvestable tree indices.
 }
}
async function debris(host,sites,ticket,zoneId){
 const author=root.AuthoredFurniture;if(!author?.load||!author?.buildGroup){error='Authored Debris-ifier masonry unavailable';return;}
 try{
  const pieces=await Promise.all(PILLARS.map(key=>author.load(key)));
  if(ticket!==serial||host.parent!==scene||zoneId!==area)return;
  for(const site of sites.filter(s=>s.kind==='brokenPillar')){
   const built=author.buildGroup(pieces[hash(site.id)%PILLARS.length]);if(!built)continue;
   built.name='wilderness-broken-stone-pillar';built.position.set(site.point.col+.5,elevation(site),site.point.row+.5);
   built.rotation.y=site.yaw;built.scale.multiplyScalar(site.size);built.userData.wildernessLandmarkScenery=true;
   ignoreHits(built);host.add(built);
  }
 }catch(e){error='Could not render debrisified pillars: '+String(e?.message||e);root.__farmLog?.('[wilderness-landmarks] '+error,'warn');}
}
function clear(){
 serial++;
 group?.traverse?.(node=>{if(node.userData?.ownsWildernessCairnBuffers){node.geometry?.dispose?.();node.material?.dispose?.();}}); // Per-zone instanced cairn buffers are owned; shared foliage and authored-furniture buffers are not.
 group?.parent?.remove?.(group);group=null;scene=null;area='';
}
function update(){
 const zone=deps?.getCurrentArea?.(),layout=deps?._zoneLayouts?.get?.(zone),active=root.GridTileAccessors?.getActiveScene?.();
 if(!layout||!active||!String(zone).startsWith('map_')){if(group)clear();return;}
 if(scene===active&&area===zone&&group?.parent===active)return;
 clear();const T=root.THREE;if(!T?.Group||!T?.InstancedMesh||!T?.DodecahedronGeometry)return;
 const sites=landmarksFor(zone,layout),host=new T.Group();host.name='wilderness-year-round-landmarks';
 host.userData.wildernessLandmarkScenery=true;active.add(host);scene=active;group=host;area=zone;
 report={zone,count:sites.length,stoneCairns:sites.filter(s=>s.kind==='stoneCairn').length,brokenPillars:sites.filter(s=>s.kind==='brokenPillar').length,deadTrees:sites.filter(s=>s.kind==='deadTree').length};
 cairns(T,host,sites);deadwood(host,sites);debris(host,sites,serial,zone);
}
function debugSnapshot(){return{activeZone:area,attached:!!group?.parent,drawRoots:group?.children?.length||0,plan:report,lastError:error};}
function init(injected){clear();deps=injected;error=null;root.DevCompanion?.registerStateProvider?.('wildernessLandmarkScenery',debugSnapshot);}
return Object.freeze({init,update,clear,planForLayout,landmarksFor,debugSnapshot});
});
