// Tothal-seeded wilderness scenery and grounded landmarks for any future treasure hunt.
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.WildernessLandmarkScenery=api;})(typeof window!=='undefined'?window:globalThis,function(root){
'use strict';
const PILLARS=['ruinPillarBroken','ruinPillarStump','ruinRubblePile']; // Existing Debris-ifier-authored masonry, never substitute intact procedural pillars.
const WITNESS_DYES = Object.freeze([
 {
  "id": "dye:CLOTH:bright_red",
  "name": "bright red",
  "hex": "#ff6666"
 },
 {
  "id": "dye:CLOTH:bright_red_orange",
  "name": "bright red-orange",
  "hex": "#ff8c66"
 },
 {
  "id": "dye:CLOTH:bright_orange",
  "name": "bright orange",
  "hex": "#ffb366"
 },
 {
  "id": "dye:CLOTH:bright_yellow_orange",
  "name": "bright yellow-orange",
  "hex": "#ffd966"
 },
 {
  "id": "dye:CLOTH:bright_yellow",
  "name": "bright yellow",
  "hex": "#ffff66"
 },
 {
  "id": "dye:CLOTH:bright_yellow_green",
  "name": "bright yellow-green",
  "hex": "#b3ff66"
 },
 {
  "id": "dye:CLOTH:bright_green",
  "name": "bright green",
  "hex": "#66ff66"
 },
 {
  "id": "dye:CLOTH:bright_green_blue",
  "name": "bright green-blue",
  "hex": "#66ffff"
 },
 {
  "id": "dye:CLOTH:bright_blue",
  "name": "bright blue",
  "hex": "#66ccff"
 },
 {
  "id": "dye:CLOTH:bright_blue_indigo",
  "name": "bright blue-indigo",
  "hex": "#8c66ff"
 },
 {
  "id": "dye:CLOTH:bright_indigo",
  "name": "bright indigo",
  "hex": "#b366ff"
 },
 {
  "id": "dye:CLOTH:bright_indigo_violet",
  "name": "bright indigo-violet",
  "hex": "#d966ff"
 },
 {
  "id": "dye:CLOTH:bright_violet",
  "name": "bright violet",
  "hex": "#ff66ff"
 }
]); // Thirteen real bright cloth dye swatches; each can occur at most once per zone.
const WITNESS_MOTIFS = Object.freeze([
 'assets/patterns/motif_harlyao_glyph_entropy.png',
 'assets/patterns/motif_harlyao_glyph_ignorance.png',
 'assets/patterns/motif_harlyao_glyph_servitude.png'
]); // Three existing ruin engraving motifs, deterministically shuffled per Tothal zone; never invent a pattern filename.
function witnessDyes(seed) {
 const catalog=root.SCRATCHBONES_CONFIG?.game?.dyes?.catalog || []; // The authored in-game dye catalog is the color/name authority.
 const dyes=WITNESS_DYES.map(choice=>{
  const match=catalog.find?.(entry=>entry.id===choice.id);
  return {...choice,name:typeof match?.label==='string'?match.label.toLowerCase():choice.name,
   hex:/^#[0-9a-f]{6}$/i.test(match?.hex||'')?match.hex:choice.hex};
 }); // Spoken dye and render swatch agree, including when the runtime catalog differs.
 const random=rng(hash(seed+'|distinct-markings'));
 for(let i=dyes.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[dyes[i],dyes[j]]=[dyes[j],dyes[i]];}
 const seen=new Set(); // Two differently named dyes must not share a rendered swatch within the same zone.
 return dyes.filter(dye=>{
  const color=dye.hex.toLowerCase();
  if(seen.has(color))return false;
  seen.add(color);return true;
 }); // Reuse is allowed across zones, never between marked objects in one zone.
}
const cache=new WeakMap(); // Folded zone layout + world-cycle identity -> stable physical landmark positions.
let deps=null,scene=null,group=null,area='',serial=0,report=null,error=null,renderedLayout=null,renderedIdentity=''; // Used by update() to invalidate the physical marker when either the layout or the Tothal generation changes.
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
 const blossomStarts=(layout.localeInstances||[]).filter(instance=>String(instance.localeId||'').startsWith('locale_five_blossoms_')
  &&Number.isInteger(instance.blossomStartLandmark?.col)&&Number.isInteger(instance.blossomStartLandmark?.row))
  .map(instance=>({id:instance.localeId,...instance.blossomStartLandmark}))
  .sort((a,b)=>a.id.localeCompare(b.id))
  .filter((entry,index,list)=>list.findIndex(other=>other.col===entry.col&&other.row===entry.row)===index); // Each stamped blossom reserves a short, uniquely patterned opening landmark.
 const occupied=[]; // Preserve entrances, authored locales, totems and the wilderness spawn clearing.
 for(const start of blossomStarts)occupied.push({c:start.col,r:start.row,d:5}); // Ordinary random cairns never overlap the replacement debris.
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
 if(sites.length||blossomStarts.length){
  if(sites.length&&!sites.some(site=>site.kind==='brokenPillar')&&sites.length>1){
   const replacement=sites.find(site=>site.kind==='deadTree')||sites[1];
   replacement.kind='brokenPillar';replacement.name='a broken stone pillar'; // Every substantial zone keeps real patterned pillar debris.
  }
  const dyes=witnessDyes(key);
  const regularBudget=Math.max(0,dyes.length-blossomStarts.length); // Reserve a distinct real dye for each local hunt marker first.
  let dyeIndex=0;
  const marked=(index,dye,starting=false)=>{
   const original=sites[index],pillar=original.kind==='brokenPillar';
   const kind=starting?'witnessStone':pillar?'brokenPillar':'markedBoulder';
   const object=starting?'standing stone':pillar?'broken pillar':'boulder';
   sites[index]={...original,kind,name:'the '+dye.name+'-marked '+object,
    dyeName:dye.name,dyeId:dye.id,ink:dye.hex,
    patternUrl:WITNESS_MOTIFS[hash(key+'|motif|'+original.id)%WITNESS_MOTIFS.length],
    unique:true,marked:true,source:'generated-year-round-scenery'}; // Every dyed object has a unique swatch within the zone.
  };
  let firstIndex=-1;
  if(sites.length&&regularBudget){
   firstIndex=sites.findIndex(site=>site.kind==='stoneCairn');
   if(firstIndex<0)firstIndex=sites.findIndex(site=>site.kind==='deadTree');
   if(firstIndex<0)firstIndex=sites.length>1?1:0;
   marked(firstIndex,dyes[dyeIndex++],true);
  }
  const candidates=sites.map((site,index)=>({site,index})).filter(({site,index})=>index!==firstIndex
   &&(site.kind==='brokenPillar'||site.kind==='stoneCairn'));
  candidates.sort((a,b)=>Number(b.site.kind==='brokenPillar')-Number(a.site.kind==='brokenPillar')
   ||hash(key+'|'+a.site.id)-hash(key+'|'+b.site.id));
  for(let i=0;i<candidates.length&&dyeIndex<regularBudget;i++)marked(candidates[i].index,dyes[dyeIndex++]);
  for(const start of blossomStarts){
   const dye=dyes[dyeIndex++];if(!dye)break;
   const isBoulder=start.replacedTree; // A real copse becomes a patterned boulder; open ground receives an authored broken pillar.
   const kind=isBoulder?'markedBoulder':'brokenPillar';
   const id=zoneId+':blossom-start:'+start.id;
   sites.push({id,kind,name:'the '+dye.name+'-marked '+(isBoulder?'boulder':'broken pillar'),
    point:{col:start.col,row:start.row},yaw:hash(key+'|yaw|'+id)/4294967296*Math.PI*2,size:1,
    dyeName:dye.name,dyeId:dye.id,ink:dye.hex,
    patternUrl:WITNESS_MOTIFS[hash(key+'|motif|'+id)%WITNESS_MOTIFS.length],
    unique:true,marked:true,blossomNear:start.id,treeReplaced:isBoulder,source:'generated-year-round-scenery'});
  }
 }
 cache.set(layout,{key,sites});return sites;
}
function identity(){return String(deps?.tothalWorldId?.()||'world')+':'+String(deps?.currentTothalYear?.()||'shift');}
function landmarksFor(zoneId,layout){return planForLayout(zoneId,layout,identity());}
function elevation(site){const n=Number(deps?.TILE)||64,p=site.point,y=root.ClimbSystem?.groundYAt?.((p.col+.5)*n,(p.row+.5)*n);return y==null||!Number.isFinite(y)?0:y;}
function ignoreHits(node,shared=false){node.traverse?.(part=>{if(part.isMesh||part.isInstancedMesh)part.raycast=()=>{};if(shared&&part.geometry)part.userData.festivalSharedFoliage=true;});}
// Each face uses the same source, color treatment and nine-slice UV unwrap as an actual cliff.
const CAIRN_STONES=[[.86,.28,.74],[.66,.25,.59],[.48,.22,.43],[.29,.17,.28]]; // Four overlapping, irregularly rotated stones per cairn.
const CAIRN_CHUNK_TILES=24; // Keeps independent instanced bounds small enough for useful camera/frustum culling.
let cliffCairnArt=null; // One owned cliff-mapped geometry and cached material shared by every cairn chunk and Tothal Shift.
function cairnArt(T){
 if(cliffCairnArt)return cliffCairnArt;
 const quarry=root.OreRockTextures?.smallStoneArt?.(T); // Supplies the actual six-sided quarry-rock geometry, not a new cuboid.
 if(!quarry?.geometry||!quarry?.material){error='Missing small-stone art for cairns';return null;}
 const natural=root.NaturalSurfaceMaterials,stretch=root.HobunjiSurfaceStretchUV; // Same cliff tint, PNG and connected-surface solver as wilderness cliffs.
 if(!natural?.naturalizeMesh||!stretch?.mapMesh){error='Cliff surface material or stretch mapper unavailable for cairns';return quarry;}
 const original=quarry.geometry.clone(); // Never modify/dispose the quarry buffers used by ordinary rubble and witness stones.
 const template=new T.Mesh(original,quarry.material); // Temporary mesh lets the existing natural-surface pipeline assign its exact cliff material.
 try{
  natural.naturalizeMesh(template,'cliffs');
  const mapping=stretch.mapMesh(template,{label:'wilderness cairn stone faces'}); // Separate full PNG on each polygon face, stretched to that face.
  if(!mapping?.patchCount||!template.material?.map)throw new Error('Cliff surface UV or texture was not assigned');
  if(template.geometry!==original)original.dispose?.(); // The seam-capable mapper created its own owned geometry.
  cliffCairnArt={geometry:template.geometry,material:template.material,patchCount:mapping.patchCount}; // Reused for all stone sizes without re-unwrapping.
  return cliffCairnArt;
 }catch(reason){
  if(template.geometry!==original)template.geometry.dispose?.();
  original.dispose?.();
  error='Could not prepare cliff-textured cairns: '+String(reason?.message||reason);
  return quarry; // Fail open with the previous quarry stones, rather than losing the landmark.
 }
}
function cairns(T,host,sites){
 const list=sites.filter(s=>s.kind==='stoneCairn');if(!list.length)return;
 const art=cairnArt(T);if(!art)return;
 const batches=new Map(); // Spatially partitioned sites prevent one wilderness-wide instance sphere from keeping every cairn visible.
 for(const site of list){
  const key=Math.floor(site.point.col/CAIRN_CHUNK_TILES)+','+Math.floor(site.point.row/CAIRN_CHUNK_TILES);
  if(!batches.has(key))batches.set(key,[]);
  batches.get(key).push(site);
 }
 const parent=new T.Group();parent.name='wilderness-stone-cairns';parent.userData.wildernessLandmarkScenery=true;
 const dummy=new T.Object3D(); // Reused temporary transform; matrices are written once when the zone is generated.
 for(const [key,chunk] of batches){
  const mesh=new T.InstancedMesh(art.geometry,art.material,chunk.length*CAIRN_STONES.length);
  let index=0; // Tracks the four matrices contributed by every stone stack in this chunk.
  for(const site of chunk){
   const rand=rng(hash(site.id)),size=site.size;
   let bottom=elevation(site)-.055*size; // Embed the footing and overlap each tier.
   for(const [width,height,depth] of CAIRN_STONES){
    const offset=(rand()-.5)*.08*size;
    dummy.position.set(site.point.col+.5+Math.cos(site.yaw)*offset,bottom+height*size/2,site.point.row+.5+Math.sin(site.yaw)*offset);
    dummy.rotation.y=site.yaw+(rand()-.5)*1.5;
    dummy.scale.set(width*size,height*size,depth*size);
    dummy.updateMatrix();
    mesh.setMatrixAt(index++,dummy.matrix);
    bottom+=(height-.055)*size;
   }
  }
  mesh.instanceMatrix.needsUpdate=true;
  mesh.name='wilderness-cairn-chunk-'+key;mesh.raycast=()=>{};
  mesh.frustumCulled=false; // Three r128 cannot use a base geometry's sphere for scattered instances; the render-only view culler uses tagged instance bounds.
  mesh.userData.wildernessLandmarkScenery=true;mesh.userData.terrainJigsawIgnore=true;
  mesh.userData.hobunjiWildernessDistanceCull=true; // Also permits existing zone-distance and scissored-replay culling.
  root.InstancedMeshBounds?.tag?.(mesh); // Registers accurate per-chunk world bounds with InstancedMeshViewCull.
  parent.add(mesh);
 }
 host.add(parent);
}
function prepareStaticRuinVisual(group){
 group.traverse?.(node=>{
  if(!node.isMesh||node.isSkinnedMesh||node.isInstancedMesh||!node.geometry?.getAttribute?.('position'))return;
  if(node.frustumCulled===false)return; // Preserve deliberate no-cull sprite billboards, shader-displaced engraving glows and animated decals.
  node.frustumCulled=true; // Regular authored stone uses its own geometry sphere, never a zone-wide owner bound.
  node.userData.hobunjiWildernessDistanceCull=true; // Only static, ordinarily frustum-cullable meshes enter the render-only distance pass.
  if(!node.geometry.boundingSphere)node.geometry.computeBoundingSphere?.(); // Reuse authored local bounds in subsequent camera passes.
 });
}
function engrave(mesh,site,stone=false) {
 const surface=root.FurniturePatternSurfaces; // Reuse ruin surface projection and its cached GPU atlas.
 mesh.userData.ownsWildernessWitnessBuffers=true; // Cleanup owns just the marker's decal buffers, not the original geometry.
 mesh.userData.witnessDye={id:site.dyeId,name:site.dyeName,color:site.ink,motifUrl:site.patternUrl,unique:true};
 surface?.applyPart?.(mesh,{patternSurfaces:[{
  slot:'sides',selector:'sides',mode:'engraving',scale:.9,opacity:.9,glowIntensity:.15,
  pattern:{motifUrl:site.patternUrl,motifScale:.75,tiling:false},
  palette:['#e6e0d1',site.ink],glowColor:site.ink,maxAtlasPx:256,tilePx:128
 }]});
 const rune=surface?.attachStoneSignal?.(mesh,{face:'front',width:.45,height:.5,idleColor:site.ink});
 if(stone&&rune?.glyph?.position)rune.glyph.position.z=.57; // Natural irregular rock requires clearance beyond its facets.
}
function witnessStone(T,host,sites){
 for(const site of sites.filter(s=>s.kind==='witnessStone'||s.kind==='markedBoulder')){
  const art=root.OreRockTextures?.smallStoneArt?.(T); // Use the same permanent quarry PNG mesh as wilderness rubble.
  if(!art){error='OreRockTextures.smallStoneArt unavailable for patterned stone';continue;}
  const rock=new T.Mesh(art.geometry,art.material);
  rock.name=site.kind==='witnessStone'?'wilderness-dye-inscribed-witness-stone':'wilderness-dye-inscribed-boulder';
  rock.position.set(site.point.col+.5,elevation(site)+.52,site.point.row+.5);
  rock.rotation.y=site.yaw;
  rock.userData.wildernessLandmarkScenery=true;
  rock.userData.wildernessLandmarkSitePoint={...site.point}; // Existing stone root is the perception silhouette for the verified anchor.
  rock.userData.terrainJigsawIgnore=true;
  rock.userData.hobunjiWildernessDistanceCull=true; // Marked ruin stones use their own ordinary mesh frustum and wilderness distance bounds.
  rock.frustumCulled=true;
  rock.raycast=()=>{}; // This permanent marking is unbreakable and does not steal player input.
  host.add(rock);engrave(rock,site,true);
 }
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
   const variant=site.marked?hash(site.id)%2:hash(site.id)%PILLARS.length; // Marked pillars must not resolve to a loose rubble pile.
   const built=author.buildGroup(pieces[variant]);if(!built)continue;
   built.name='wilderness-broken-stone-pillar';built.position.set(site.point.col+.5,elevation(site),site.point.row+.5);
   built.rotation.y=site.yaw;built.scale.multiplyScalar(site.size);built.userData.wildernessLandmarkScenery=true;
   built.userData.wildernessLandmarkSitePoint={...site.point}; // The authored pillar, not a proxy, is the sense target.
   if(site.marked){
    const parts=built.userData?.meshById;
    const shaft=parts?.get?.('stump')||parts?.get?.('stub')||parts?.get?.('base'); // Actual authored pillar shaft receives the engraving.
    if(shaft)engrave(shaft,site,false);
    built.userData.wildernessDyeId=site.dyeId; // Mobile diagnostics can name the color on a given pillar.
   }
   prepareStaticRuinVisual(built); // Off-camera debris-ifier parts are individually frustum and distance culled.
   ignoreHits(built);host.add(built);
  }
 }catch(e){error='Could not render debrisified pillars: '+String(e?.message||e);root.__farmLog?.('[wilderness-landmarks] '+error,'warn');}
}
function clear(){
 serial++;
 const witness=[]; // Every scene-local painted rock and pillar owns disposable engraving atlas children.
 group?.traverse?.(node=>{
  if(node.userData?.ownsWildernessWitnessBuffers)witness.push(node); // Never dispose shared quarry/pillar base geometry.
 });
 // Release per-zone InstancedMesh renderer state, but never dispose the shared cliff/quarry geometries or material.
 const cairnGroup=group?.children?.find(node=>node.name==='wilderness-stone-cairns');
 for(const chunk of cairnGroup?.children||[])chunk.dispose?.(); // One instance matrix per spatial chunk; its owning mesh may release GPU bookkeeping on Shift.
 
 for(const rock of witness){
  for(const child of [...rock.children]){
   if(child.userData?.furniturePattern || child.userData?.ruinStoneSignalGlyph){
    child.material?.dispose?.(); // The ruin pattern owner releases its retained atlas and glow via its material dispose hook.
    child.geometry?.dispose?.();
   }
  }
  // Only scene-local engravings are disposed; the base stone and authored pillar geometry remain shared.
 }
 group?.parent?.remove?.(group);group=null;scene=null;area='';renderedLayout=null;renderedIdentity='';
}
function update(){
 const zone=deps?.getCurrentArea?.(),layout=deps?._zoneLayouts?.get?.(zone),active=root.GridTileAccessors?.getActiveScene?.();
 if(!layout||!active||!String(zone).startsWith('map_')){if(group)clear();return;}
 const currentIdentity=identity(); // Recomputed on each zone check; a Tothal cycle can change while preserving the same layout object.
 if(scene===active&&area===zone&&group?.parent===active&&renderedLayout===layout&&renderedIdentity===currentIdentity)return;
 clear();const T=root.THREE;if(!T?.Group||!T?.InstancedMesh)return;
 const sites=landmarksFor(zone,layout),host=new T.Group();host.name='wilderness-year-round-landmarks';
 host.userData.wildernessLandmarkScenery=true;active.add(host);scene=active;group=host;area=zone;renderedLayout=layout;renderedIdentity=currentIdentity;
 report={zone,count:sites.length,stoneCairns:sites.filter(s=>s.kind==='stoneCairn').length,brokenPillars:sites.filter(s=>s.kind==='brokenPillar').length,deadTrees:sites.filter(s=>s.kind==='deadTree').length,
 witness:sites.find(s=>s.kind==='witnessStone')?.name||null,
 marked:sites.filter(s=>s.marked).map(s=>({kind:s.kind,dyeId:s.dyeId,at:s.point}))}; // Diagnostics verify distinct dyes per generated zone.
 cairns(T,host,sites);witnessStone(T,host,sites);deadwood(host,sites);debris(host,sites,serial,zone);
}
function objectAt(zoneId,targetScene,point){
  if(area!==zoneId||scene!==targetScene||!group?.parent||!Number.isFinite(point?.col)||!Number.isFinite(point?.row))return null;
  return group.children.find(node=>node.userData?.wildernessLandmarkSitePoint?.col===point.col
   &&node.userData?.wildernessLandmarkSitePoint?.row===point.row)||null; // Bounded to scene-local roots, never a world traversal.
 }
 function debugSnapshot(){
 const cairnGroup=group?.getObjectByName?.('wilderness-stone-cairns'); // Lets the mobile Dev Companion verify bounded instancing without developer tools.
 const marker=group?.getObjectByName?.('wilderness-dye-inscribed-witness-stone'); // Mobile debug can verify that the route's dyed rock is visibly rendered, not just planned.
 const engraving=marker?.children?.find?.(child=>child.userData?.furniturePattern);
 return{activeZone:area,attached:!!group?.parent,drawRoots:group?.children?.length||0,plan:report,lastError:error,
  cairnRendering:{chunks:cairnGroup?.children?.length||0,cliffMappedFaces:cliffCairnArt?.patchCount||0,
   frustumTracked:cairnGroup?.children?.filter?.(mesh=>mesh.userData?.hobunjiInstanceBounds===true)?.length||0},
  dyedWitness:{present:!!marker,color:marker?.userData?.witnessDye?.color||null,
   motif:marker?.userData?.witnessDye?.motifUrl||null,engraving:engraving?.userData?.furniturePattern?.status||'unavailable',
   runeVisible:!!marker?.children?.some?.(child=>child.userData?.ruinStoneSignalGlyph)}};
}
function init(injected){clear();deps=injected;error=null;root.DevCompanion?.registerStateProvider?.('wildernessLandmarkScenery',debugSnapshot);}
return Object.freeze({init,update,clear,planForLayout,landmarksFor,objectAt,debugSnapshot});
});
