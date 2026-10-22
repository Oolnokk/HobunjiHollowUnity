'use strict';
const assert = require('node:assert/strict'); // Exercises shipped authoring and dressing behavior without a browser download.
const fs = require('node:fs'); // Loads the actual editor, furniture records, and runtime owners.
const vm = require('node:vm'); // Isolates editor functions and asynchronous dressing lifetimes.
const editor = fs.readFileSync('docs/tools/furniture-avatar-author/index.html', 'utf8'); // Source of the real import/framing functions.
const readFurniture = key => JSON.parse(fs.readFileSync(`docs/config/furniture-authored/${key}.json`, 'utf8')); // Same records consumed in-game and by the editor.
class Vector {
  constructor(x=0,y=0,z=0) { Object.assign(this,{x,y,z}); }
  set(x,y,z) { Object.assign(this,{x,y,z});return this; }
  copy(v) { Object.assign(this,{x:v.x,y:v.y,z:v.z}); return this; }
  add(v) { this.x+=v.x;this.y+=v.y;this.z+=v.z;return this; }
  length() { return Math.hypot(this.x,this.y,this.z); }
  multiplyScalar(s) { this.x*=s;this.y*=s;this.z*=s;return this; }
  normalize() { return this.multiplyScalar(1/this.length()); }
} // Only vector arithmetic is mocked; camera fit and default texture selection execute production code.
class Bounds {
  setFromObject(root) { this.size=root.size;this.center=root.center;return this; }
  isEmpty() { return false; }
  getCenter(out) { return out.copy(this.center); }
  getSize(out) { return out.copy(this.size); }
}
const framing = editor.slice(editor.indexOf('function frameFurniture(){'),editor.indexOf('\nfunction setCameraView')); // Selects the shared function used by every import path.
for (const size of [new Vector(5,3,1),new Vector(300,20,10),new Vector(1,100,1)]) {
  for (const rect of [{width:1200,height:600},{width:320,height:650}]) {
    const root={size,center:new Vector(18,4,-7)}; // Non-origin furniture verifies that framing also updates the target.
    const camera={fov:42,position:new Vector(),lookAt(){},updateProjectionMatrix(){}}; // Captures fit distance and clip-plane updates.
    const context={THREE:{Box3:Bounds,Vector3:Vector,MathUtils:{degToRad:v=>v*Math.PI/180}},root,camera,canvas:{getBoundingClientRect:()=>rect},state:{parts:[]},orbit:{target:new Vector(),update(){}},log(){}}; // Actual viewport dimensions drive the production fit.
    vm.runInNewContext(framing,context);context.frameFurniture();
    const distance=Math.hypot(camera.position.x-root.center.x,camera.position.y-root.center.y,camera.position.z-root.center.z); // Camera-to-target distance after framing.
    const radius=size.length()/2; // Furthest possible imported corner from the measured center.
    const halfFov=Math.min(camera.fov*Math.PI/360,Math.atan(Math.tan(camera.fov*Math.PI/360)*rect.width/rect.height)); // Independent projection boundary.
    assert(distance*Math.sin(halfFov)>radius,'all model corners fit the smaller viewport dimension');
    assert(camera.near<distance-radius && camera.far>distance+radius,'clip planes contain the complete import');
    assert(context.orbit.maxDistance>distance,'large furniture can still be zoomed farther out');
    assert.deepEqual(context.orbit.target,root.center,'orbit follows the imported bounds');
  }
}
const defaults = editor.slice(editor.indexOf('function defaultSurfaceSetting('),editor.indexOf('\nfunction ensureSurfaceSetting')); // Imported runtime furniture must retain PNGs without requiring saved surface overrides.
const textureContext={window:{HOBUNJI_ASSET_BASE:'../../assets/'},humanize:v=>v,normalizeQuarterTurn:v=>Number(v)||0,isPartCapSurface:(_part,group)=>!!group.cap}; // Minimal editor helpers; default selection executes unchanged.
vm.runInNewContext(defaults,textureContext);
const cloth=readFurniture('festivalArch').parts.find(part=>part.materialRole==='fabric'); // Real authored pennant with fill color.
const clothTexture=textureContext.defaultSurfaceSetting({},cloth).texture; // Same default used when loadData rebuilds recognized surfaces.
assert.equal(clothTexture.source,'../../assets/textures/canvas.png');
assert.equal(clothTexture.mapping,'stretch');
assert.equal(clothTexture.fillEnabled,true);
assert.equal(clothTexture.fillColor,cloth.materialFillColor);
const capTexture=textureContext.defaultSurfaceSetting({cap:true},{...cloth,materialCapTexture:'boards.png',materialCapRotationDeg:90}).texture; // Cap and side PNGs remain independently selectable.
assert.equal(capTexture.source,'../../assets/textures/boards.png');assert.equal(capTexture.rotationDeg,90);
assert.equal(textureContext.defaultSurfaceSetting({cap:false},{...cloth,materialCapTexture:'canvas.png',materialRotationDeg:90,materialCapRotationDeg:0}).texture.rotationDeg,90,'shared cap/side PNG keeps independent rotations');
assert.equal(textureContext.defaultSurfaceSetting({}, {...cloth,textureDataUrl:'data:image/png;base64,AA=='}).texture.source,'data:image/png;base64,AA==','explicit imported PNG keeps precedence');
const currentBuild=vm.runInNewContext(editor.match(/const CURRENT_BUILD_FURNITURE_JSON = (\[[^;]+\]);/)[1]); // Executes the actual pinned-build fallback catalog.
const index=JSON.parse(fs.readFileSync('docs/config/furniture-authored/index.json','utf8')); // Shared authored furniture index.
for(const key of ['festivalStage','festivalDanceFloor','festivalArch','festivalGifts','festivalAncestors','festivalBlossoms','festivalFeast','festivalSweets','festivalMasks','festivalBunting','servingTable','servingPot','bowlStack']){
  assert(currentBuild.includes(`docs/config/furniture-authored/${key}.json`),`${key} can import before merging into main`);
  assert(index.furniture.some(entry=>entry.key===key),`${key} is registered in the authored index`);
}
class Group {
  constructor(){this.children=[];this.userData={};this.scale=new Vector(1,1,1);this.position=new Vector();this.rotation={y:0};}
  add(child){child.parent?.remove(child);this.children.push(child);child.parent=this;}
  remove(child){this.children=this.children.filter(candidate=>candidate!==child);child.parent=null;}
  updateMatrixWorld(){}
  traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);}
} // Scene ownership is enough to test dressing readiness/disposal without duplicating rendering.
(async()=>{
  let resolvePending=null,built=0; // Controls a load that completes after its layout is disposed.
  const window={THREE:{Group},AuthoredFurniture:{peek:()=>null,load:()=>new Promise(resolve=>{resolvePending=resolve;}),buildGroup:()=>{built++;return new Group();}}}; // Geometry construction is counted at the actual runtime boundary.
  vm.runInNewContext(fs.readFileSync('docs/js/festival-props.js','utf8'),{window});
  const root=new Group(); // Ordinary host furniture owns the delayed dressing.
  window.FestivalProps.decorate(root,{key:'tableSmall',festivalDecoration:'gifts'});
  window.FestivalProps.dispose(root);resolvePending(readFurniture('festivalGifts'));
  await Promise.resolve();assert.equal(built,0,'disposed festival layouts cannot attach late meshes');
  window.AuthoredFurniture.peek=key=>readFurniture(key);
  const live=new Group(); // A cached dressing attaches immediately through the same builder.
  window.FestivalProps.decorate(live,{key:'tableSmall',festivalDecoration:'gifts'});
  assert.equal(built,1);assert.equal(live.children[0].children.length,1);
  window.FestivalProps.decorate(new Group(),{key:'festivalStage',festivalDecoration:'bandstand'});
  assert.equal(built,1,'complete structural furniture does not get a second duplicate visual');
  let finishStructure=null,structureBuilds=0,disposedMaterials=0,disposedTextures=0,disposedGeometries=0; // Counts allocations/releases when an arch completes its cold load or is removed first.
  const pendingStructure=new Promise(resolve=>{finishStructure=resolve;}); // Shared loader promise mirrors AuthoredFurniture's real cache.
  const structureWindow={THREE:{Group},ProceduralFurniture:{buildPartMesh:()=>new Group(),buildFurnitureGroup:()=>new Group()},AuthoredFurniture:{peek:()=>null,load:()=>pendingStructure,buildGroup(){
    structureBuilds++;
    const authored=new Group(),mesh=new Group(); // The shared builder owns material/texture clones on each authored part.
    mesh.userData.authoredPartId='arch-beam';
    mesh.geometry={dispose(){disposedGeometries++;}};
    mesh.material={map:{dispose(){disposedTextures++;}},dispose(){disposedMaterials++;}};
    authored.add(mesh);authored.userData.meshById=new Map([['arch-beam',mesh]]);return authored;
  }}}; // Runs the real async upgrade owner, rather than simulating its continuation ordering.
  vm.runInNewContext(fs.readFileSync('docs/js/furniture-vessel-runtime.js','utf8'),{window:structureWindow,console});
  vm.runInNewContext(fs.readFileSync('docs/js/festival-props.js','utf8'),{window:structureWindow});
  const arch=structureWindow.ProceduralFurniture.buildFurnitureGroup('festivalArch'); // Cold construction starts the canonical asynchronous upgrade first.
  structureWindow.FestivalProps.decorate(arch,{key:'festivalArch',festivalArchWidth:6});
  const removedArch=structureWindow.ProceduralFurniture.buildFurnitureGroup('festivalArch'); // A second instance disappears before either asset resolves.
  structureWindow.FestivalProps.decorate(removedArch,{key:'festivalArch',festivalArchWidth:5});
  structureWindow.FestivalProps.dispose(removedArch);
  finishStructure(readFurniture('festivalArch'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(structureBuilds,1,'a removed structure must not allocate late materials or geometry');
  const span=arch.children.find(child=>child.name==='festival-arch-span'); // The clear span belongs to the visual assembly, not the placement transform.
  assert.equal(span.scale.x,1.5);assert.equal(arch.scale.x,1);
  assert.equal(arch.userData.meshById.get('arch-beam').parent,span,'cold-loaded arch meshes inherit the authored span');
  arch.scale.x=2;assert.equal(span.scale.x,1.5,'gizmo changes cannot compound the intrinsic clear span');
  structureWindow.FestivalProps.dispose(arch);structureWindow.FestivalProps.dispose(arch);
  assert.equal(disposedMaterials,1);assert.equal(disposedTextures,1);assert.equal(disposedGeometries,1,'each festival-owned GPU resource is released exactly once');
  const mapEditor=fs.readFileSync('docs/tools/map-editor/index.html','utf8'); // Map preview has its own furniture catalog and document-relative assets.
  const mapCatalog=vm.runInNewContext(mapEditor.slice(mapEditor.indexOf('const DECOR ='),mapEditor.indexOf('\n};',mapEditor.indexOf('const DECOR ='))+3)+';DECOR;'); // Executes the actual catalog used for selection, resize pruning, and 3D preview.
  const previewMap={id:'festival-preview',decor:['festivalStage','festivalDanceFloor','festivalArch'].map((key,index)=>({key,id:key,col:10+index*5,row:8,festivalArchWidth:6}))}; // New editor placements omit event-only decoration metadata.
  const previewRoot=new Group(),previewWindow={...structureWindow,ProceduralFurniture:{buildFurnitureGroup:()=>new Group()}}; // Captures which real records survive the map preview catalog gate.
  const previewContext={window:previewWindow,DECOR:mapCatalog,PROCESSORS:{},activeMap:()=>previewMap,mapWorldInfo:()=>({offsetC:0,offsetR:0}),editingLayoutId:null,TerrainPreview:{NORMAL_TOP:0,PLATEAU_UNIT:1,sampleVisualHeight:()=>0},activeDecor:map=>map.decor,_3dSelected:null,three3d:{placementMeshes:new Map()}}; // Dependencies outside furniture construction remain inert.
  vm.runInNewContext(mapEditor.slice(mapEditor.indexOf('function spawnPreviewPlacements('),mapEditor.indexOf('\n// Footprint placeholder box',mapEditor.indexOf('function spawnPreviewPlacements('))),previewContext);
  previewContext.spawnPreviewPlacements(previewRoot,{cols:60,rows:50});
  assert.equal(previewRoot.children.length,3,'the map editor must render every festival structure');
  for(const child of previewRoot.children)assert.equal(child.userData.festivalStructure,true,'fresh editor placements use festival resource ownership too');
  const assetScript=[...mapEditor.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(match=>match[1].includes('window.__hobunjiFurnitureConfigBase =')); // Evaluates the editor's startup asset paths before its renderer loads.
  const assetWindow={};vm.runInNewContext(assetScript[1],{window:assetWindow});assert.equal(assetWindow.__hobunjiFurnitureAssetBase,'../../assets/','nested map previews resolve PNGs from docs/assets');
  console.log('Festival furniture PNG imports, catalogs, mobile/large framing, span transforms and GPU resource disposal passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
