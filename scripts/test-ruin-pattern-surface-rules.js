'use strict';
// Executes the ruin pattern rules module together with the real surface renderer:
// geometric face classes (world space), per-type rules, the false-pillar
// housing, staged Apply/Live editing, surface picking and the panel.
const assert = require('assert');
const fs = require('fs'), vm = require('vm');

class Vector3 {
  constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
  set(x,y,z){Object.assign(this,{x,y,z});return this;}
  copy(v){return this.set(v.x,v.y,v.z);}
  fromBufferAttribute(a,i){return this.set(a.array[i*3],a.array[i*3+1],a.array[i*3+2]);}
  subVectors(a,b){return this.set(a.x-b.x,a.y-b.y,a.z-b.z);}
  cross(b){return this.crossVectors(this.clone(),b);}
  crossVectors(a,b){return this.set(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);}
  clone(){return new Vector3(this.x,this.y,this.z);}
  negate(){return this.set(-this.x,-this.y,-this.z);}
  lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}
  normalize(){const n=Math.sqrt(this.lengthSq())||1;return this.set(this.x/n,this.y/n,this.z/n);}
  dot(b){return this.x*b.x+this.y*b.y+this.z*b.z;}
  applyMatrix4(m){const e=m.elements,{x,y,z}=this;return this.set(e[0]*x+e[4]*y+e[8]*z+e[12],e[1]*x+e[5]*y+e[9]*z+e[13],e[2]*x+e[6]*y+e[10]*z+e[14]);}
  applyMatrix3(m){const e=m.elements,{x,y,z}=this;return this.set(e[0]*x+e[3]*y+e[6]*z,e[1]*x+e[4]*y+e[7]*z,e[2]*x+e[5]*y+e[8]*z);}
}
class Matrix3 {constructor(){this.elements=[1,0,0,0,1,0,0,0,1];}copy(o){this.elements=[...o.elements];return this;}
  getNormalMatrix(m4){const e=m4.elements;this.elements=[e[0],e[1],e[2],e[4],e[5],e[6],e[8],e[9],e[10]];return this;}} // Rotation-only fixtures: the upper 3x3 is the normal matrix.
class Vector2 {constructor(x=0,y=0){this.x=x;this.y=y;}set(x,y){this.x=x;this.y=y;return this;}}
class Attribute {constructor(array,itemSize){this.array=Float32Array.from(array);this.itemSize=itemSize;this.count=this.array.length/itemSize;}}
class Geometry {constructor(){this.attributes={};this.userData={};}getAttribute(n){return this.attributes[n];}setAttribute(n,a){this.attributes[n]=a;return this;}computeVertexNormals(){}dispose(){this.disposed=true;}}
class Material {constructor(o){Object.assign(this,o);this.listeners={};}addEventListener(n,fn){this.listeners[n]=fn;}dispose(){this.listeners.dispose?.();this.disposed=true;}}
const IDENTITY=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
class Mesh {
  constructor(geometry,material){this.geometry=geometry;this.material=material;this.userData={};this.children=[];this.isMesh=!!geometry;this.name='';this.visible=true;this.uuid=Math.random().toString(36).slice(2);this.matrixWorld={elements:[...IDENTITY]};}
  add(...cs){for(const c of cs){c.parent=this;this.children.push(c);}return this;}
  remove(c){this.children=this.children.filter(x=>x!==c);c.parent=null;}
  traverse(fn){fn(this);for(const c of [...this.children])c.traverse?.(fn);}
  getWorldPosition(v){const e=this.matrixWorld.elements;return v.set(e[12],e[13],e[14]);}
}
const THREE={Matrix3,Vector2,Vector3,BufferGeometry:Geometry,Float32BufferAttribute:Attribute,Mesh,MeshBasicMaterial:Material,DoubleSide:2};

// Quad facing +z (or -z) of the given width (x) and height (y) at depth z.
function quad(width,height,z=0,facing=1){const w=width/2,h=height/2;return facing<0?[-w,-h,z, w,h,z, w,-h,z, -w,-h,z, -w,h,z, w,h,z]:[-w,-h,z, w,-h,z, w,h,z, -w,-h,z, w,h,z, -w,h,z];}
function meshOf(name,positions,matrix){const g=new Geometry();g.setAttribute('position',new Attribute(positions,3));const m=new Mesh(g,new Material({}));m.name=name;if(matrix)m.matrixWorld.elements=matrix;return m;}
function group(name,userData={}){const node=new Mesh(null,null);node.name=name;Object.assign(node.userData,userData);return node;}
const ROT_Z_90=[0,1,0,0, -1,0,0,0, 0,0,1,0, 0,0,0,1]; // Local x -> world y: a sideways piece.

const storage=new Map(), panels=[];
const pieceJson={'pillar_square':{parts:[{id:'p1',name:'Square Tapered Shaft',patternScale:3}]}};
const catalog=['rune-a','rune-b','rune-c','rune-d','rune-e'].map(id=>({id,pattern:{motifDataUrl:'data:'+id}}));
const window={THREE,
  PatternLibrary:{getById:()=>null,getCatalog:()=>catalog,unlock:()=>true},
  ClothingWeavingSystem:{async applyPatternStackToTintedImage(canvas){return canvas;}},
  HobunjiSpritePngSurface:{makeMaterial:(_T,_t,_n,o)=>new Material(o),makeCanvasTexture:(_T,canvas)=>({canvas,image:canvas,dispose(){}})},
  DevCompanion:{registerPanel:spec=>panels.push(spec)},
};
const document={createElement(){return {width:0,height:0,style:{},getContext:()=>({fillRect(){},drawImage(){}}),click(){},remove(){}};},body:{appendChild(){}}};
const context={window,document,console,performance:{now:()=>Date.now()},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
  fetch:async url=>{const id=String(url).match(/data\/([^/]+)\.json$/)?.[1];if(url.includes('ruin-surface-rules'))return{ok:true,json:async()=>({defaultScale:4,minRegionHeight:1,minRegionWidth:.3,minSurfaceTiles:.25,maxAtlasPx:512,rules:{'obelisk_stone › Tapered Obelisk Shaft':{enabled:false}}})};return id&&pieceJson[id]?{ok:true,json:async()=>pieceJson[id]}:{ok:false};},
  setTimeout,clearTimeout,URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}},Blob:class{},encodeURIComponent};
// A browser that still holds pre-v2 tile edits gets "tile 4 all around".
storage.set('hobunjiRuinPatternRules.v1',JSON.stringify({defaultScale:6,rules:{ruin_wall:{scale:6},'x › y':{enabled:false}}}));
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/furniture-pattern-surfaces.js','utf8'),context);
vm.runInContext(fs.readFileSync('docs/js/ruin-pattern-surface-rules.js','utf8'),context);
const S=window.FurniturePatternSurfaces,R=window.RuinPatternSurfaceRules;
const engravings=mesh=>mesh.children.filter(c=>c.userData.furniturePattern);

(async()=>{
  await R.ready;
  assert.equal(R.mergedConfig().defaultScale,4,'old local tile sizes are dropped: tile 4 all around');
  assert.equal(R.mergedConfig().rules['x › y'].enabled,false,'old on/off edits survive the migration');

  const root=group('ruin_interior_complex');
  const wall=meshOf('ruin_wall_wn_0',quad(8,4));wall.userData.ruinInteriorWall=true;root.add(wall);
  const otherWall=meshOf('ruin_wall_ws_3',quad(6,4));otherWall.userData.ruinInteriorWall=true;root.add(otherWall);
  const upright=group('repo_furniture_pillar_square');const shaft=meshOf('Square Tapered Shaft',quad(1.2,4));const plinth=meshOf('Wide Stone Plinth',quad(1.5,.3));upright.add(shaft,plinth);root.add(upright);
  const sideways=group('repo_furniture_pillar_square',{interiorRuinRole:'baseboard'});const lyingShaft=meshOf('Square Tapered Shaft',quad(.6,4),ROT_Z_90);sideways.add(lyingShaft);root.add(sideways);
  const housing=group('',{squarePillarHousing:true});housing.matrixWorld.elements=[...IDENTITY];
  const westWall=meshOf('',[...quad(.9,2.9,.4,1),...quad(.9,2.9,.35,-1)]);const eastWall=meshOf('',quad(.9,2.9,.4,1));const nicheSideSegment=meshOf('',quad(.9,.95,.4,1));const housingPlinth=meshOf('',quad(1.5,.23,.5,1));housing.add(westWall,eastWall,nicheSideSegment,housingPlinth);root.add(housing);
  const seal=group('interior_plateau_seals');const sealPlane=meshOf('',quad(2,3));seal.add(sealPlane);root.add(seal);
  const ladder=group('dev_ruin_stone_ladder_1');const rail=meshOf('',quad(.12,3));ladder.add(rail);root.add(ladder);
  window.DevRandomRuin={getRuntimeContext:()=>({root,scene:root})};
  await R.preloadPieces(root);

  const regions=R.analyze(lyingShaft,root);
  assert.equal(regions[0].cls,'narrow','a sideways baseboard shaft is short in the world, so it is a trim');
  assert.equal(R.analyze(shaft,root)[0].cls,'broad');
  assert.deepEqual(R.analyze(westWall,root).map(r=>r.cls).sort(),['broad','inner'],'false pillar walls: outer face broad, inside face inner');

  S.decorateRuin(root,7);
  const types=root.userData.ruinPatternTypes;
  assert.equal(engravings(wall).length,1,'flat wall face is patterned');
  assert.equal(engravings(wall)[0].userData.furniturePattern.scale,4,'default tile 4');
  assert.equal(engravings(shaft).length,1,'upright pillar shaft is patterned');
  assert.equal(engravings(shaft)[0].userData.furniturePattern.scale,3,'Furniture Author piece scale wins over the default');
  assert.equal(engravings(lyingShaft).length,0,'sideways baseboard shaft stays plain');
  assert.equal(engravings(plinth).length,0,'short plinth stays plain');
  assert.equal(engravings(westWall).length,1,'false pillar outer face is patterned');
  assert.equal(engravings(westWall)[0].geometry.getAttribute('position').count,6,'inner (hidden) face is not patterned');
  assert.equal(engravings(westWall)[0].userData.furniturePattern.patternId,engravings(eastWall)[0].userData.furniturePattern.patternId,'one false pillar shares one motif');
  const motif=mesh=>engravings(mesh)[0].userData.furniturePattern.patternId;
  assert.equal(motif(otherWall),motif(wall),'every wall in a ruin shares one motif');
  assert.equal(motif(westWall),motif(shaft),'every pillar in a ruin (false pillars included) shares one motif');
  assert.equal(S.surfaceCategory('ruin_wall',''),'wall');
  assert.equal(S.surfaceCategory('false pillar (part)',''),'pillar');
  assert.equal(S.surfaceCategory('pillar_square › Square Tapered Shaft',' wall'),'pillar','the mesh\'s own type beats an ancestor wall role');
  assert.equal(engravings(nicheSideSegment).length,1,'the false pillar\'s split niche-side wall segments are patterned like the real shaft face');
  assert.equal(engravings(housingPlinth).length,0,'the false pillar\'s plinth stays plain like a real one');
  assert.equal(engravings(sealPlane).length,0,'seal planes are name-excluded');
  assert.equal(engravings(rail).length,0,'thin ladder rails are trims');
  assert.equal(types.get('false pillar (part)').meshes,4,'housing parts read as one false-pillar type');
  assert(types.get('dev_ruin_stone_ladder (part)'),'every ruin mesh gets a type');

  const panel=panels.find(p=>p.id==='ruin-patterns');
  assert(panel.when());
  // Staged: switch the wall off, nothing changes until Apply.
  panel.onAction('toggle',{key:'ruin_wall'});
  assert.equal(engravings(wall).length,1,'staged edit leaves the ruin alone');
  assert(panel.render().summary.includes('unapplied'));
  panel.onAction('apply',{});
  assert.equal(engravings(wall).length,0);
  // Face classes: enable trims on the pillar shaft type -> the sideways one is patterned too.
  panel.onAction('live',{});
  panel.onAction('class',{key:'pillar_square › Square Tapered Shaft',cls:'narrow'});
  assert.equal(engravings(lyingShaft).length,1,'narrow class switch patterns trims of that type');
  panel.onAction('class',{key:'pillar_square › Square Tapered Shaft',cls:'narrow'});
  assert.equal(engravings(lyingShaft).length,0);
  // Turning on a type that has no broad faces turns on its trims.
  panel.onAction('toggle',{key:'dev_ruin_stone_ladder (part)'});
  assert.equal(engravings(rail).length,1);
  // Tile for all.
  panel.onAction('scale-all',{scale:2});
  assert.equal(engravings(westWall)[0].userData.furniturePattern.scale,2);
  assert.equal(engravings(shaft)[0].userData.furniturePattern.scale,3,'piece scale still wins over the all-types default');
  panel.onAction('scale-all',{scale:4});
  // Pick: a fake raycaster hit identifies the wall's face.
  window.THREE.Raycaster=class{setFromCamera(){}intersectObject(){return [{object:westWall,faceIndex:2}];}};
  window.THREE.BoxHelper=class extends Mesh{constructor(){super(null,new Material({}));}};
  R.pickAt(0,0,{});
  const picked=R.getSelection();
  assert.equal(picked.key,'false pillar (part)');assert.equal(picked.cls,'inner','second quad of the west wall is its inside face');
  assert(panel.render().actions.some(a=>String(a.group).startsWith('Picked: false pillar (part)')),'picked surface shows at the top of the panel');
  // Export carries the applied rules.
  const config=R.mergedConfig();
  assert.equal(config.rules.ruin_wall.enabled,false);
  assert.equal(config.rules['obelisk_stone › Tapered Obelisk Shaft'].enabled,false,'repo rules are kept in the export');
  assert.equal(R.stepScale(4,1),5);assert.equal(R.stepScale(1.5,-1),1.25);
  console.log('ruin pattern surface rules ok');
})().catch(error=>{console.error(error);process.exit(1);});
