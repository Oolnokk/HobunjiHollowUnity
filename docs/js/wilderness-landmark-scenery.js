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
 {id:'harlyao_glyph_entropy',url:'assets/patterns/motif_harlyao_glyph_entropy.png'},
 {id:'harlyao_glyph_ignorance',url:'assets/patterns/motif_harlyao_glyph_ignorance.png'},
 {id:'harlyao_glyph_servitude',url:'assets/patterns/motif_harlyao_glyph_servitude.png'}
]); // Canonical collectible ruin wall motifs and their fallback image paths, selected deterministically per Tothal zone.
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
let unregisterStoneCollision=null; // Removes the current zone's stationary masonry colliders on shift or scene teardown.
let updateDebrisCollision=null; // Replaces temporary site-center boxes with real authored fragment footprints after async Debris-ifier loading.
const SOLID_LANDMARK_KINDS = new Set(['markedBoulder','witnessStone','stoneCairn','brokenPillar','deadTree']); // All permanent landmarks, including dead-tree trunks, use the same movement blocker.
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
 for(const item of layout.localeInstances||[])occupied.push({c:Number(item.x??item.col),r:Number(item.y??item.row),d:6}); // Retain existing anchor spacing while extending protection to the whole painted locale.
 // Keep authored floors free of scenery, even when their actual footprint is far from their entrance anchor.
 // The shared helper also inspects furniture whose footprint extends beyond painted locale tiles.
 for(const item of [...(layout.dens||[]),...(layout.animalDens||[])])occupied.push({c:Number(item.mouthAnchor?.x??item.x),r:Number(item.mouthAnchor?.y??item.y),d:5});
 for(const item of layout.rootTotems||[])occupied.push({c:Number(item.x),r:Number(item.y),d:4});
 if(layout.entry)occupied.push({c:Number(layout.entry.col??layout.entry.x),r:Number(layout.entry.row??layout.entry.y),d:8});
 const target=Math.max(10,Math.min(38,Math.round(cols*rows/630))),sites=[]; // Several dozen site markers per large wilderness, never a draw call per tile.
 for(let attempt=0;attempt<target*90&&sites.length<target;attempt++){
  const col=3+Math.floor(next()*(cols-6)),row=3+Math.floor(next()*(rows-6)),tile=at(col,row);
  if(!tile||tile.type!=='grass'||tile.water||tile.path||tile.incline||tile.ramp||tile.mapBoundary||tile.skipFloor||tile.generatedObjectType||tile.occupiedBy)continue; // Later scenery cannot overwrite even a temporarily stamped camp reservation.
  if([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const n=at(col+dx,row+dz);return!n||!['grass','weeds'].includes(n.type)||n.water||n.path||n.mapBoundary||n.occupiedBy||(n.elevTier||0)!==(tile.elevTier||0);}))continue;
  if([[1,1],[-1,-1],[1,-1],[-1,1]].some(([dx,dz])=>at(col+dx,row+dz)?.occupiedBy))continue; // A diagonal camp corner still intersects the visible stone's small overhang.
  if(root.WildernessObjectFootprints?.isTemporaryLocaleReserved?.(layout,col,row,1))continue; // Tribal and bandit tile views reserve their entire footprint on this source layout.
  if((layout.localeInstances||[]).some(locale=>root.WildernessObjectFootprints?.localeBlocksSite?.(locale,col,row,1.5) ?? Math.hypot(col-Number(locale.x??locale.col),row-Number(locale.y??locale.row))<6))continue;
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
   const motif=WITNESS_MOTIFS[hash(key+'|motif|'+original.id)%WITNESS_MOTIFS.length]; // Both the ruin pattern ID and the debug URL must describe the same engraving.
   sites[index]={...original,kind,name:'the '+dye.name+'-marked '+object,
    dyeName:dye.name,dyeId:dye.id,ink:dye.hex,
    patternId:motif.id,patternUrl:motif.url,
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
   const motif=WITNESS_MOTIFS[hash(key+'|motif|'+id)%WITNESS_MOTIFS.length]; // The relocated hunt anchor uses the exact same ruin motif pool as ordinary landmarks.
   sites.push({id,kind,name:'the '+dye.name+'-marked '+(isBoulder?'boulder':'broken pillar'),
    point:{col:start.col,row:start.row},yaw:hash(key+'|yaw|'+id)/4294967296*Math.PI*2,size:1,
    dyeName:dye.name,dyeId:dye.id,ink:dye.hex,
    patternId:motif.id,patternUrl:motif.url,
    unique:true,marked:true,blossomNear:start.id,treeReplaced:isBoulder,source:'generated-year-round-scenery'});
  }
 }
 root.WildernessObjectFootprints?.reserveScenery?.(layout,sites); // Temporary camps consult the same planned stone sites even when generated after this scene.
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
const SOURCE_PILLAR_PATTERN_KEY='pillar_square › Square Tapered Shaft'; // The intact V50 ruin pillar sets the tile scale; debris does not invent an independent layout.
function originalPillarPatternScale(){
 const config=root.RuinPatternSurfaceRules?.mergedConfig?.(); // One-time zone construction reads the same applied/repo rules as decorateRuin.
 const source=Number(config?.rules?.[SOURCE_PILLAR_PATTERN_KEY]?.scale),fallback=Number(config?.defaultScale);
 return Number.isFinite(source)&&source>0?source:Number.isFinite(fallback)&&fallback>0?fallback:4;
}
function engrave(mesh,site,stone=false) {
 const surface=root.FurniturePatternSurfaces; // The production ruin wall compositor and side-perimeter unwrap own all masonry pattern UVs.
 if(!surface?.applyPart){error='FurniturePatternSurfaces unavailable for wilderness engraving';return false;}
 mesh.userData.ownsWildernessWitnessBuffers=true; // Cleanup owns projected overlays only, never the shared quarry stone or authored masonry.
 mesh.userData.witnessDye={id:site.dyeId,name:site.dyeName,color:site.ink,motifUrl:site.patternUrl,patternId:site.patternId,unique:true};
 const scale=originalPillarPatternScale(); // Original pillars use tile 4 by default, not the previous wilderness-only .65 motif scale.
 const slots=stone?[
  {slot:'ruin-pillar-rock',selector:'all'}
 ]:[
  {slot:'ruin-pillar-entire-fragment',selector:'pillar-wrap'}
 ]; // A single mesh uses the exact intact side perimeter UV plus planar exposed ends; no redundant second atlas/draw call.
 const records=slots.map(slot=>({...slot,mode:'engraving',patternId:site.patternId,
  scale,opacity:.9,engravingCoreOpacity:.85,glowIntensity:0,glowPulseDepth:0,
  palette:['#b7a185',site.ink],maxAtlasPx:256,tilePx:256,minSurfaceTiles:0
 })); // Use the repo motif's own tiling/frame/mesh settings exactly as decorateRuin does; only the landmark ink and glow differ.
 const part=mesh.userData?.authoredPart; // Authored box vs natural rock decides the canonical pattern surface projection.
 surface.applyPart(mesh,{...part,kind:stone?'sphere':part?.kind||'box',patternSurfaces:records});
 const engraved=mesh.children.filter(child=>child.userData?.furniturePattern?.mode==='engraving'&&records.some(record=>record.slot===child.userData.furniturePattern.slot));
 mesh.userData.wildernessPatternSurfaces={expected:records.length,actual:engraved.length,scale}; // Mobile diagnostics catch a missing side/cap overlay without opening devtools.
 if(engraved.length!==records.length)error='Incomplete ruin pattern on '+(mesh.name||site.id)+': '+engraved.length+'/'+records.length;
 return engraved.length===records.length;
}

// Every authored stone fragment is marked, including chips; one wrapped overlay per part keeps the draw-call budget no worse than before.

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
  ignoreHits(tree,true);root.HobunjiOutlines?.markShellOutline?.(tree);host.add(tree); // Native bark uses the standard shell layer; unharvestable tree trunks still block movement.
 }
}
function authoredDebrisBoxes(built){
 const T=root.THREE; // Use the same Three.js world-space box measurement as RuinSites; no duplicate collision geometry.
 if(!T?.Box3)return[];
 built.updateMatrixWorld?.(true); // Authored part transforms include the placed group's yaw, scale, and ground elevation.
 const parts=[...new Set([...(built.userData?.meshById?.values?.()||[])])]; // The author's original meshes, not decorative engraving overlays.
 if(!parts.length)built.traverse?.(mesh=>{if(mesh.isMesh&&mesh.geometry&&mesh.userData?.authoredPart?.id)parts.push(mesh);});
 const boxes=[]; // One immutable world-space rectangle/height per authored stone fragment, calculated only when the zone loads.
 for(const mesh of parts){
  if(!mesh?.isMesh||!mesh.geometry)continue;
  const box=new T.Box3().setFromObject(mesh); // Native authored tapered shaft, fallen cap, and every rubble chip have their own bounds.
  if(box.isEmpty()||![box.min.x,box.max.x,box.min.z,box.max.z,box.min.y,box.max.y].every(Number.isFinite))continue;
  if(box.max.x<=box.min.x||box.max.z<=box.min.z)continue;
  boxes.push({minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z,minY:box.min.y,maxY:box.max.y});
 }
 return boxes;
}
async function debris(host,sites,ticket,zoneId){
 const author=root.AuthoredFurniture;if(!author?.load||!author?.buildGroup){error='Authored Debris-ifier masonry unavailable';return;}
 try{
  const pieces=await Promise.all(PILLARS.map(key=>author.load(key)));
  if(ticket!==serial||host.parent!==scene||zoneId!==area)return;
  const finishedBoxes=new Map(); // One batch replaces all preview colliders after the complete async debris build; no per-fragment reindexing.
  for(const site of sites.filter(s=>s.kind==='brokenPillar')){
   const variant=site.marked?hash(site.id)%2:hash(site.id)%PILLARS.length; // Marked pillars must not resolve to a loose rubble pile.
   const built=author.buildGroup(pieces[variant]);if(!built)continue;
   built.name='wilderness-broken-stone-pillar';built.position.set(site.point.col+.5,elevation(site),site.point.row+.5);
   built.rotation.y=site.yaw;built.scale.multiplyScalar(site.size);built.userData.wildernessLandmarkScenery=true;
   const boxes=authoredDebrisBoxes(built);if(boxes.length)finishedBoxes.set(site.id,boxes); // Until ready, the provisional central stone stays solid.
   built.userData.wildernessLandmarkSitePoint={...site.point}; // The authored pillar, not a proxy, is the sense target.
   if(site.marked)built.updateMatrixWorld?.(true); // Surface UV density includes the final authored part + wilderness scale on its first atlas build.
   if(site.marked){
    const parts=built.userData?.meshById;
    const targets=[...new Set([...(parts?.values?.()||[])].filter(mesh=>mesh?.isMesh&&mesh.geometry))]; // All original authored masonry fragments, not only shafts/caps, retain the full wrap.
    if(!targets.length)built.traverse?.(mesh=>{if(mesh.isMesh&&mesh.userData?.authoredPart?.id&&mesh.geometry)targets.push(mesh);}); // Old authored builders without meshById still pattern all stone fragments.
    built.userData.wildernessDyeId=site.dyeId; // Mobile diagnostics can identify the ink of the entire broken pillar.
    built.userData.wildernessPatternedParts=targets.filter(mesh=>engrave(mesh,site)).length; // The shaft, base, broken ends and small chips all receive one continuous authentic ruin pattern projection.
    if(!built.userData.wildernessPatternedParts)error='No stone faces were available for '+site.id;
   }
   prepareStaticRuinVisual(built); // Cull static authored debris fragments; preserve explicitly unculled billboards.
   ignoreHits(built);host.add(built);
  }
  if(ticket===serial&&host.parent===scene&&zoneId===area){
   updateDebrisCollision?.(finishedBoxes); // Reuse the same movement/NPC/projectile provider, not a separate debris collision service.
   if(report){report.authoredDebrisSites=finishedBoxes.size;report.authoredDebrisParts=[...finishedBoxes.values()].reduce((n,boxes)=>n+boxes.length,0);}
  }
 }catch(e){error='Could not render debrisified pillars: '+String(e?.message||e);root.__farmLog?.('[wilderness-landmarks] '+error,'warn');}
}
// Mirrors cairns()'s actual seeded stone transforms at zone-build time. The collision
// footprint includes every rotated stone's visible corners without per-frame mesh raycasts.
function cairnPhysicalBoxes(site){
 const geo=cairnArt(root.THREE)?.geometry; // Same cached cliff-mapped geometry rendered by every instanced cairn course.
 if(!geo?.computeBoundingBox)return null;
 if(!geo.boundingBox)geo.computeBoundingBox();
 const bounds=geo.boundingBox;
 if(!bounds||![bounds.min.x,bounds.max.x,bounds.min.y,bounds.max.y,bounds.min.z,bounds.max.z].every(Number.isFinite))return null;
 const rand=rng(hash(site.id)),size=site.size,centerX=site.point.col+.5,centerZ=site.point.row+.5;
 const baseY=elevation(site);
 let bottom=baseY-.055*size;
 const boxes=[]; // One rectangle per stacked course allows landing on lower visible stones without floating on the upper cap.
 for(const [width,height,depth] of CAIRN_STONES){
  const offset=(rand()-.5)*.08*size; // Matches the instance offset call order in cairns().
  const yaw=site.yaw+(rand()-.5)*1.5; // Matches the per-course random yaw call order in cairns().
  const x=centerX+Math.cos(site.yaw)*offset,z=centerZ+Math.sin(site.yaw)*offset;
  const cosine=Math.cos(yaw),sine=Math.sin(yaw);
  const result={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity,minY:Infinity,maxY:-Infinity};
  for(const bx of [bounds.min.x*width*size,bounds.max.x*width*size]){
   for(const bz of [bounds.min.z*depth*size,bounds.max.z*depth*size]){
    const wx=x+bx*cosine+bz*sine,wz=z-bx*sine+bz*cosine;
    result.minX=Math.min(result.minX,wx);result.maxX=Math.max(result.maxX,wx);
    result.minZ=Math.min(result.minZ,wz);result.maxZ=Math.max(result.maxZ,wz);
   }
  }
  const midY=bottom+height*size/2;
  result.minY=Math.min(result.minY,midY+bounds.min.y*height*size);
  result.maxY=Math.max(result.maxY,midY+bounds.max.y*height*size);
  const INSTANCE_EPSILON=.0005; // Three r128 stores instanced transforms as float32; keep their rounded outer corners physically included.
  result.minX-=INSTANCE_EPSILON;result.maxX+=INSTANCE_EPSILON;
  result.minZ-=INSTANCE_EPSILON;result.maxZ+=INSTANCE_EPSILON;
  boxes.push(result);
  bottom+=(height-.055)*size;
 }
 return boxes;
}
function registerStoneCollision(zone,sites){
 unregisterStoneCollision?.();unregisterStoneCollision=null;updateDebrisCollision=null; // Each Shift invalidates the old geometry and asynchronous callback.
 const bySite=new Map(); // Site id -> world-space stone rectangles; the initial pillar box stays solid while its authored mesh loads.
 for(const site of sites.filter(s=>SOLID_LANDMARK_KINDS.has(s.kind))){
  const x=site.point.col+.5,z=site.point.row+.5,y=elevation(site);
  const size=Math.max(.6,Number(site.size)||1);
  const isQuarryStone=site.kind==='markedBoulder'||site.kind==='witnessStone';
  const quarry=isQuarryStone?root.OreRockTextures?.smallStoneArt?.(root.THREE)?.geometry:null; // Reuse the already-rendered single stone, not a guessed boulder silhouette.
  if(quarry&&!quarry.boundingBox)quarry.computeBoundingBox?.(); // One cached source-geometry measurement for all witness sites.
  const bounds=quarry?.boundingBox;
  const half=isQuarryStone&&bounds?Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x),Math.abs(bounds.min.z),Math.abs(bounds.max.z))
   :(site.kind==='deadTree'?.32:site.kind==='stoneCairn'?.46:.36)*size;
  const height=isQuarryStone&&bounds?.max?Math.max(.1,.52+bounds.max.y)
   :(site.kind==='deadTree'?4.2:1.25)*size; // Other scenery stays on the existing cheap finite trunk/rock model.
  const cairnBoxes=site.kind==='stoneCairn'?cairnPhysicalBoxes(site):null; // Four measured course footprints preserve real stepped landings.
  const fallback={minX:x-half,maxX:x+half,minZ:z-half,maxZ:z+half,minY:y-.05,maxY:y+height};
  bySite.set(site.id,(cairnBoxes?.length?cairnBoxes:[fallback]).map(box=>({...box,siteId:site.id,kind:site.kind})));
 } // Ordinary cairns/trees/rocks retain their cheap collider; authored debris becomes per-part precise.
 const BUCKET_TILES=8; // Same spatial index shape used by RuinSites to avoid scanning every piece on each movement probe.
 let columns=new Map(),allBoxes=[]; // Immutable snapshot swapped after one-time or async scene rebuild.
 function rebuild(){
  const next=new Map(),boxes=[...bySite.values()].flat(); // At most a few dozen sites and small authored fragments.
  for(const box of boxes){
   const left=Math.floor(box.minX/BUCKET_TILES),right=Math.floor(box.maxX/BUCKET_TILES);
   const top=Math.floor(box.minZ/BUCKET_TILES),bottom=Math.floor(box.maxZ/BUCKET_TILES);
   for(let bx=left;bx<=right;bx++){
    let rows=next.get(bx);if(!rows){rows=new Map();next.set(bx,rows);}
    for(let bz=top;bz<=bottom;bz++){
     let bucket=rows.get(bz);if(!bucket){bucket=[];rows.set(bz,bucket);}
     bucket.push(box);
    }
   }
  }
  allBoxes=boxes;columns=next;
 }
 rebuild();
 const blockers=root.AreaFootprintBlockers; // Shared player, NPC, and projectile collision service; renders remain raycast-inert.
 if(!bySite.size||!blockers?.register)return bySite.size;
 updateDebrisCollision=(resolved)=>{
  let changed=false;
  for(const [id,boxes] of resolved||[]){
   if(!bySite.has(id)||!Array.isArray(boxes)||!boxes.length)continue;
   bySite.set(id,boxes.map(box=>({...box,siteId:id,kind:'brokenPillar'})));changed=true;
  }
  if(changed)rebuild(); // Once after the authored fragments finish loading; no geometry traversals during movement.
 };
 function touches(box,minX,maxX,minZ,maxZ,worldY){
  return maxX>=box.minX&&minX<=box.maxX&&maxZ>=box.minZ&&minZ<=box.maxZ
   &&(worldY==null||(worldY>=box.minY-.05&&worldY<=box.maxY+.05));
 }
 function nearby(x,z,half,visit){
  const minX=x-half,maxX=x+half,minZ=z-half,maxZ=z+half;
  const left=Math.floor(minX/BUCKET_TILES),right=Math.floor(maxX/BUCKET_TILES);
  const top=Math.floor(minZ/BUCKET_TILES),bottom=Math.floor(maxZ/BUCKET_TILES);
  const cellCount=(right-left+1)*(bottom-top+1);
  if(![left,right,top,bottom,cellCount].every(Number.isSafeInteger)||cellCount<=0||cellCount>64)
   return allBoxes.some(box=>visit(box,minX,maxX,minZ,maxZ));
  for(let bx=left;bx<=right;bx++){
   const rows=columns.get(bx);if(!rows)continue;
   for(let bz=top;bz<=bottom;bz++){
    for(const box of rows.get(bz)||[])if(visit(box,minX,maxX,minZ,maxZ))return true;
   }
  }
  return false;
 }
 unregisterStoneCollision=blockers.register('wilderness-landmark-stones',{area:zone,
  blocksBox(x,z,half,worldY){
   if(!Number.isFinite(x)||!Number.isFinite(z))return false;
   return nearby(x,z,Number.isFinite(half)?Math.max(0,half):0,
    (box,minX,maxX,minZ,maxZ)=>touches(box,minX,maxX,minZ,maxZ,worldY));
  },
  supportAt(x,z,maxY){
   if(!Number.isFinite(x)||!Number.isFinite(z))return null;
   let best=null; // The same static part footprint owns both side contact and landing height.
   nearby(x,z,0,(box)=>{
    if(box.kind==='deadTree'||!Number.isFinite(box.maxY)||box.maxY>maxY)return false; // Tall trunks stay trunks, not jump platforms.
    const inset=.055; // Require the player's centre securely on top, not just grazing a chip or edge.
    if(box.maxX-box.minX<=inset*2||box.maxZ-box.minZ<=inset*2)return false;
    if(x<box.minX+inset||x>box.maxX-inset||z<box.minZ+inset||z>box.maxZ-inset)return false;
    if(!best||box.maxY>best.y)best={y:box.maxY,kind:'landmark',id:box.siteId};
    return false; // Keep scanning the same small bucket for the highest overlapped piece.
   });
   return best;
  }
 });
 return bySite.size;
}
function clear(){
 serial++;
 unregisterStoneCollision?.();unregisterStoneCollision=null;updateDebrisCollision=null; // No stale obstacle or async update may survive a shift/zone.
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
 root.NearbyVolumeCollision?.invalidate?.(); // Removed deadwood roots must never retain invisible physics if the active Three.js scene object is reused.
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
 report.solidStoneColliders=registerStoneCollision(zone,sites); // Same curated placement list owns both visible rocks and their physical colliders.
 report.authoredDebrisSites=0;report.authoredDebrisParts=0; // Dev Companion shows when async stone fragments replace provisional site footprints.
 cairns(T,host,sites);witnessStone(T,host,sites);deadwood(host,sites);debris(host,sites,serial,zone);
 root.NearbyVolumeCollision?.invalidate?.(); // The tree-root spatial index must rebuild after new scenery (especially landmark deadwood) joins this zone.
}
function objectAt(zoneId,targetScene,point){
  if(area!==zoneId||scene!==targetScene||!group?.parent||!Number.isFinite(point?.col)||!Number.isFinite(point?.row))return null;
  return group.children.find(node=>node.userData?.wildernessLandmarkSitePoint?.col===point.col
   &&node.userData?.wildernessLandmarkSitePoint?.row===point.row)||null; // Bounded to scene-local roots, never a world traversal.
 }
 function debugSnapshot(){
 const cairnGroup=group?.getObjectByName?.('wilderness-stone-cairns'); // On-demand mobile check of spatial cairn culling.
 const marker=group?.getObjectByName?.('wilderness-dye-inscribed-witness-stone'); // Mobile debug can verify that the route's dyed rock is visibly rendered, not just planned.
 const engraving=marker?.children?.find?.(child=>child.userData?.furniturePattern);
 const pillars=group?.children?.filter(node=>node.userData?.wildernessDyeId)||[]; // On-demand mobile diagnostics, never traversed in the render loop.
 const pillarPatterns={ready:0,loading:0,failed:0,missing:0}; // Detect visible/pending/error atlas states on *every* authored stone, not just geometry ownership.
 for(const pillar of pillars){
  const parts=pillar.userData?.meshById;
  const meshes=[...(parts?.values?.()||[])].filter(mesh=>mesh?.isMesh&&mesh.geometry);
  for(const mesh of meshes){
   const overlays=mesh.children.filter(child=>child.userData?.furniturePattern?.mode==='engraving');
   if(!overlays.length){pillarPatterns.missing++;continue;}
   for(const overlay of overlays){
    const status=overlay.userData.furniturePattern.status;
    if(status==='ready'&&overlay.visible)pillarPatterns.ready++;
    else if(status==='loading')pillarPatterns.loading++;
    else pillarPatterns.failed++;
   }
  }
 } // Never touch these part maps during ordinary rendering; mobile debugging should reveal invisible pattern atlases.
 return{activeZone:area,attached:!!group?.parent,drawRoots:group?.children?.length||0,plan:report,lastError:error,
  stoneCollision:{registered:!!unregisterStoneCollision,siteCount:report?.solidStoneColliders||0,
   jumpSupport:!!root.AreaFootprintBlockers?.supportAt}, // Mobile confirms raised stone landing is connected. // Dev Companion can diagnose missing colliders on mobile.
  cairnRendering:{chunks:cairnGroup?.children?.length||0,cliffMappedFaces:cliffCairnArt?.patchCount||0,
   frustumTracked:cairnGroup?.children?.filter?.(mesh=>mesh.userData?.hobunjiInstanceBounds===true)?.length||0},
  patternedPillarParts:pillars.reduce((total,node)=>total+(node.userData?.wildernessPatternedParts||0),0),pillarPatterns,
  dyedWitness:{present:!!marker,color:marker?.userData?.witnessDye?.color||null,
   motif:marker?.userData?.witnessDye?.motifUrl||null,patternId:marker?.userData?.witnessDye?.patternId||null,
   engraving:engraving?.userData?.furniturePattern?.status||'unavailable',
   patternScale:marker?.userData?.wildernessPatternSurfaces?.scale||null,
   fullSurface:marker?.userData?.wildernessPatternSurfaces?.actual===marker?.userData?.wildernessPatternSurfaces?.expected,
   nonGlowing:!engraving?.userData?.engravingGlowMesh,
   runeVisible:!!marker?.children?.some?.(child=>child.userData?.ruinStoneSignalGlyph)}};
}
function init(injected){clear();deps=injected;error=null;root.DevCompanion?.registerStateProvider?.('wildernessLandmarkScenery',debugSnapshot);}
return Object.freeze({init,update,clear,planForLayout,landmarksFor,objectAt,debugSnapshot});
});
