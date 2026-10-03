'use strict';
const assert = require('assert'); // Behavior assertions run without browser/network dependencies.
const fs = require('fs'), vm = require('vm'); // Loads the production surface renderer and editor handlers.

class Vector3 {
  constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
  fromBufferAttribute(a,i){this.x=a.array[i*a.itemSize];this.y=a.array[i*a.itemSize+1];this.z=a.array[i*a.itemSize+2];return this;}
  subVectors(a,b){this.x=a.x-b.x;this.y=a.y-b.y;this.z=a.z-b.z;return this;}
  cross(b){const x=this.y*b.z-this.z*b.y,y=this.z*b.x-this.x*b.z,z=this.x*b.y-this.y*b.x;Object.assign(this,{x,y,z});return this;}
  negate(){this.x=-this.x;this.y=-this.y;this.z=-this.z;return this;}
  normalize(){const n=Math.hypot(this.x,this.y,this.z)||1;this.x/=n;this.y/=n;this.z/=n;return this;}
  toArray(){return [this.x,this.y,this.z];}
  clone(){return new Vector3(this.x,this.y,this.z);}
  copy(v){Object.assign(this,{x:v.x,y:v.y,z:v.z});return this;}
  set(x,y,z){Object.assign(this,{x,y,z});return this;}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
  addScaledVector(v,n){this.x+=v.x*n;this.y+=v.y*n;this.z+=v.z*n;return this;}
  lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}
  length(){return Math.sqrt(this.lengthSq());}
  dot(b){return this.x*b.x+this.y*b.y+this.z*b.z;}
}
class Attribute {constructor(array,itemSize){this.array=Float32Array.from(array);this.itemSize=itemSize;this.count=this.array.length/itemSize;}}
class Geometry {
  constructor(){this.attributes={};this.userData={};}
  getAttribute(name){return this.attributes[name];}
  setAttribute(name,a){this.attributes[name]=a;return this;}
  computeVertexNormals(){}
  dispose(){this.disposed=true;}
}
class Material {
  constructor(options){Object.assign(this,options);this.listeners={};}
  addEventListener(name,fn){this.listeners[name]=fn;}
  dispose(){this.listeners.dispose?.();this.disposed=true;}
}
class Mesh {
  constructor(geometry,material){this.geometry=geometry;this.material=material;this.userData={};this.children=[];this.isMesh=true;this.matrixWorld={elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};}
  add(child){child.parent=this;this.children.push(child);}
  remove(child){this.children=this.children.filter(c=>c!==child);child.parent=null;}
  traverse(fn){fn(this);for(const child of this.children)child.traverse?.(fn);}
  clone(){const copy=new Mesh(this.geometry,this.material);copy.userData={...this.userData};for(const child of this.children)copy.add(child.clone());return copy;}
  updateMatrixWorld(){}
}
const THREE={Vector3,BufferGeometry:Geometry,Float32BufferAttribute:Attribute,Mesh,MeshBasicMaterial:Material,DoubleSide:2,RepeatWrapping:1000}; // Enough Three API to execute actual triangle selection and instance lifecycle.
const definitions=[{id:'rune-a',pattern:{motifDataUrl:'data:a'}},{id:'rune-b',pattern:{motifDataUrl:'data:b'}}]; // Deterministic unlockable catalog fixture.
const owned=new Set(); // Tracks actual unlock calls; entering/decorating cannot change it.
const sizes=[]; // Atlas extents verify density independently of normalized geometry UVs.
const canvases=[]; // Records shade references and shared compositor use.
const document={createElement(){const result={width:0,height:0,fill:null,getContext(){return {fillStyle:'',fillRect(){result.fill=this.fillStyle;},drawImage(source){result.fill=source.fill;}};}};canvases.push(result);return result;}};
let compositeCount=0; // Proves repeated instances reuse one pending tile build.
const window={THREE,PatternLibrary:{getById:id=>definitions.find(d=>d.id===id)?.pattern,getCatalog:()=>definitions,unlock:id=>{if(owned.has(id))return false;owned.add(id);return true;}},
  ClothingWeavingSystem:{async applyPatternStackToTintedImage(canvas,patterns,dye,key,shade){compositeCount++;sizes.push([canvas.width,canvas.height]);assert(!patterns[0].usageScaleMultiplier || patterns[0].usageScaleMultiplier <= 1,"no furniture-only fourfold magnification");assert.equal(shade.fill,'#c0c0c0','authored white must not be used as the shade-fill source');return canvas;}},
  HobunjiSpritePngSurface:{makeMaterial:(_T,_tex,_name,options)=>new Material(options),makeCanvasTexture:(_T,canvas)=>({canvas,dispose(){this.disposed=true;}})}};
vm.runInNewContext(fs.readFileSync('docs/js/furniture-pattern-surfaces.js','utf8'),{window,document,performance:{now:()=>1000},console});
const api=window.FurniturePatternSurfaces; // Public production API used by furniture, ruin generation, and editor preview.
function box(){const geo=new Geometry();geo.setAttribute('position',new Attribute([-1,.05,-1.5, 1,.05,1.5, 1,.05,-1.5, -1,.05,-1.5, -1,.05,1.5, 1,.05,1.5, -1,-.05,1.5, 1,-.05,1.5, 1,.05,1.5],3));return new Mesh(geo,new Material({}));}
const pattern={slot:'carpet',mode:'cloth',selector:'top',patternId:'rune-a',palette:['#b7a185','#315b67'],scale:1}; // Used on real fixture triangles and restored overrides.
(async()=>{
  assert.equal(api.normalize({scale:NaN}).scale,1);
  assert.equal(api.normalize({scale:-3}).scale,.05);
  assert.equal(api.normalize({opacity:Infinity}).opacity,1);
  assert.equal(api.normalize({palette:['invalid']}).palette[0],'#b7a185');
  const curvedGeo=new Geometry(),ring=[]; // Eight connected cylinder panels expose projection discontinuities at changing face directions.
  for(let segment=0;segment<8;segment++) {
    const p=[Math.cos(segment*Math.PI/4),Math.sin(segment*Math.PI/4)],q=[Math.cos((segment+1)*Math.PI/4),Math.sin((segment+1)*Math.PI/4)]; // Adjacent panels deliberately duplicate their shared edge vertices.
    ring.push(p[0],-1,p[1],q[0],1,q[1],q[0],-1,q[1],p[0],-1,p[1],p[0],1,p[1],q[0],1,q[1]);
  }
  curvedGeo.setAttribute('position',new Attribute(ring,3));
  const curvedMesh=new Mesh(curvedGeo,new Material({})); // Runtime hooks must maintain shared UVs through non-uniform resizing.
  api.applyPart(curvedMesh,{kind:'cylinder',patternSurfaces:[{...pattern,selector:'sides'}]});
  const curvedOverlay=curvedMesh.children[0]; curvedOverlay.matrixWorld.elements[0]=2;curvedOverlay.onBeforeRender();
  const positions=curvedOverlay.geometry.getAttribute('position').array,curvedUv=curvedOverlay.geometry.getAttribute('uv').array,edges=new Map(); // Every join except the one closing unwrap seam must be continuous.
  for(let i=0;i<positions.length;i+=3) {
    const x=positions[i],z=positions[i+2]; // Back/front side projection changes are the original visible plane-separation failure.
    if(x>.99&&Math.abs(z)<.01) continue;
    const key=[x,positions[i+1],z].map(n=>n.toFixed(4)).join(','),u=curvedUv[i/3*2];
    if(edges.has(key)) assert(Math.abs(edges.get(key)-u)<1e-6,'adjacent curved panels must share the same pattern phase');
    edges.set(key,u);
  }
  const part={id:'rug',transform:{sx:2,sy:.1,sz:3},patternSurfaces:[pattern]},mesh=box(); // Top and side fixture tests exact face clipping.
  mesh.userData.authoredPart=part;
  api.applyPart(mesh,part);
  const overlay=mesh.children[0]; // Pattern child should contain only the two upward-facing triangles.
  assert.equal(overlay.geometry.getAttribute('position').count,6);
  assert.equal(part.patternSurfaces[0].scale,1,'shared authored records remain immutable');
  const uv=overlay.geometry.getAttribute('uv'); // World scale adjusts UV density only when dimensions change.
  overlay.onBeforeRender();const original=Float32Array.from(uv.array);
  overlay.matrixWorld.elements[0]=3;overlay.matrixWorld.elements[10]=2;overlay.onBeforeRender();
  assert.deepEqual([...uv.array],[...original],"UVs cover one complete atlas after resizing; image extent changes instead of repeating a crop");
  uv.needsUpdate=false;overlay.onBeforeRender();assert.equal(uv.needsUpdate,false,'unchanged frames must not rewrite UV buffers');
  await Promise.all([api.renderTile(pattern),api.renderTile({...pattern,scale:3})]);
  assert.equal(sizes.filter(size=>size[0]===256&&size[1]===256).length,1,'preview tile cache ignores per-instance geometric scale');
  assert(sizes.some(size=>size[0]===512&&size[1]===768),'first atlas covers the whole 2 by 3 surface');
  await Promise.resolve();assert.equal(api.debug(mesh)[0].status,'ready');
  api.applyOverrides(mesh,{rug:[{...pattern,scale:2}]});
  assert.equal(mesh.children.length,1);assert.equal(overlay.material.disposed,true);assert.equal(overlay.geometry.disposed,true);
  assert.equal(api.debug(mesh)[0].scale,2);assert.equal(part.patternSurfaces[0].scale,1);
  const cold=box();cold.userData.authoredPart=part;api.applyOverrides(cold,JSON.parse(JSON.stringify(mesh.userData.patternOverrides)));
  assert.equal(api.debug(cold)[0].scale,2,'serialized overrides survive cold restoration');
  const banner=box();api.applyPart(banner,{kind:'banner',transform:{sy:2},patternSurfaces:[{...pattern,selector:'all'}]});
  const shader={uniforms:{},vertexShader:'#include <begin_vertex>'};banner.children[0].material.onBeforeCompile(shader);banner.children[0].onBeforeRender();
  assert(shader.vertexShader.includes('hanging'));assert.equal(shader.uniforms.bannerTime.value,1);
  const root=box();root.name='Ruin wall';root.userData.ruinInteriorWall=true;
  const child=box();child.name='wall section';root.add(child);
  const first=api.decorateRuin(root,27),second=api.decorateRuin(root,27);
  assert.deepEqual([...first],[...second]);assert.equal(owned.size,0,'visiting/decorating a ruin must not unlock motifs');
  assert(api.unlockRuin(root).length>0);assert.equal(api.unlockRuin(root).length,0,'completion unlocks are idempotent');
  const glass=box(),pane=box();glass.userData.authoredPart={id:'pane'};pane.userData.daylightWindowSource={surfaceId:'pane:surface:front'};pane.material.visible=true;glass.add(pane);
  api.applyPart(glass,{patternSurfaces:[{...pattern,slot:'pane:surface:front',mode:'glass'}]});
  await api.renderTile({...pattern,mode:'glass'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pane.material.visible,false,'plain daylight pane must not cover the glass pattern');
  assert.equal(pane.userData.daylightWindowSource.patternMeshes.length,1);
  api.applyOverrides(glass,{pane:[]});assert.equal(pane.material.visible,true,'removing glass restores the existing pane');
  const sharedRecord={...pattern,palette:['#ab9981','#52796f']},sharedA=box(),sharedB=box(); // Different furniture may share one immutable GPU tile.
  api.applyPart(sharedA,{patternSurfaces:[sharedRecord]});api.applyPart(sharedB,{patternSurfaces:[sharedRecord]});
  await api.renderTile(sharedRecord);await new Promise(resolve=>setImmediate(resolve));
  const texture=sharedA.children[0].material.map; // Disposing one surface must leave the other surface's shared texture alive.
  assert.strictEqual(texture,sharedB.children[0].material.map);
  sharedA.children[0].material.dispose();texture.dispose();assert(!texture.disposed);
  sharedB.children[0].material.dispose();assert(texture.disposed);
  const elements = new Map(); // Minimal editor DOM retains actual handler functions rather than asserting source text.
  const element = id => { if (!elements.has(id)) elements.set(id,{value:'',checked:false,parentElement:{appendChild(){}},style:{}}); return elements.get(id); };
  const authorPart = {id:'editor-rug',kind:'box',transform:{sx:2,sy:.1,sz:3},patternSurfaces:[{...pattern}]}; // Existing default slot must be edited, not doubled on the selected face.
  const editorState = {parts:[authorPart]},surface={id:'editor-rug:surface:top',partId:'editor-rug',localNormal:new Vector3(0,1,0),localCentroid:new Vector3(0,.05,0),faceIndices:[0,1]}; // Canonical base-editor selection fixture.
  let windowMarks=0; // Verifies glass authoring invokes the actual exported daylight-author API.
  let modalOptions=null; // Captures the production author() wiring into PatternAuthoring rather than testing an unattached helper.
  const editorWindow = {RepoPatternLibrary:{preloadEditable:async()=>{},listCached:()=>[],getCachedEditableById:()=>null},PatternAuthoring:{openEditor:options=>{modalOptions=options;}},FurniturePatternSurfaces:api, FurnitureDaylightWindowAuthor:{markSelectedAsWindow(){windowMarks++;}}};
  const editorDocument = {createElement:()=>({style:{},appendChild(){},remove(){}}),getElementById:element}; // UI controls use the same IDs as the production author extension.
  let previewRenders=0,previewDisposed=0,contextLosses=0,controlsDisposed=0,observerDisconnected=0; // Isolated renderer and interaction resources must be released exactly once.
  class PreviewRenderer {constructor(){this.domElement={style:{}};}setPixelRatio(){}setSize(){}render(){previewRenders++;}dispose(){previewDisposed++;}forceContextLoss(){contextLosses++;}}
  class PreviewScene extends Mesh {constructor(){super();this.background=null;}}
  class PreviewBounds {setFromObject(){return this;}getCenter(v){return v.set(0,0,0);}getSize(v){return v.set(2,1,3);}}
  class PreviewColor {clone(){return this;}}
  class PreviewControls {constructor(){this.target=new Vector3();}update(){}addEventListener(){}removeEventListener(){}dispose(){controlsDisposed++;}}
  class PreviewObserver {observe(){}disconnect(){observerDisconnected++;}}
  const previewCamera={position:new Vector3(3,2,3),fov:50,clone(){return {...this,position:this.position.clone()};},lookAt(){},updateProjectionMatrix(){}}; // Camera starts from the existing furniture editor view.
  Object.assign(THREE,{WebGLRenderer:PreviewRenderer,Scene:PreviewScene,Box3:PreviewBounds,Color:PreviewColor});
  mesh.userData.type='part';mesh.userData.id=authorPart.id; // Real editor meshes use this selection identity.
  const previewScene=new PreviewScene(); // Lighting can be inherited without copying avatars or selection gizmos.
  vm.runInNewContext(fs.readFileSync('docs/tools/furniture-avatar-author/furniture-patterns.js','utf8'),{window:editorWindow,document:editorDocument,THREE,state:editorState,selectedSurface:()=>surface,selectedPart:()=>authorPart,root:mesh,scene:previewScene,camera:previewCamera,renderer:{},orbit:{target:new Vector3()},OrbitControls:PreviewControls,ResizeObserver:PreviewObserver,rebuildFurnitureMeshes(){},rebuildAll(){},queueUndoHistory(){},log(){}});
  editorWindow.FurniturePatternAuthor.refresh();element('fpMode').value='glass';element('fpApply').onclick();
  assert.equal(authorPart.patternSurfaces.length,1,'editing a default face slot must not create an overlapping duplicate');
  assert.equal(authorPart.patternSurfaces[0].mode,'glass');assert.equal(authorPart.patternSurfaces[0].opacity,.8);assert.equal(windowMarks,1);
  await element('fpAuthor').onclick();
  assert(modalOptions.mountPreview&&!modalOptions.renderPreview,'furniture authoring must mount the actual 3D preview instead of a flat tile');
  const mounted=modalOptions.mountPreview({replaceChildren(){}}); // Production mount borrows the source assembly's materials and geometry.
  const originalMaterial=mesh.material,originalGeometry=mesh.geometry; // Closing a preview must leave editor-owned resources alive.
  await mounted.update({motifDataUrl:'data:a'});await mounted.update({motifDataUrl:'data:b',meshRotationDeg:40});
  assert(previewRenders>=3,'draft updates must render the actual scene');
  mounted.dispose();mounted.dispose();
  assert.equal(previewDisposed,1);assert.equal(contextLosses,1);assert.equal(controlsDisposed,1);assert.equal(observerDisconnected,1);
  assert(!originalMaterial.disposed&&!originalGeometry.disposed,'source furniture resources must survive preview close');
  console.log('Furniture pattern normalization, clipping, scale, cache, overrides, wind, ruin unlocks and daylight integration passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
