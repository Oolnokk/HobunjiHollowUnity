#!/usr/bin/env node
'use strict';
// Visual polish regression: V50-style reliefs follow the same per-story
// visibility as the authored puzzle wings. No separate rendering loop is added.
const assert=require('node:assert/strict');
class Group {
  constructor(){this.children=[];this.userData={};this.parent=null;this.name='';this.visible=true}
  add(child){this.children.push(child);child.parent=this}
  remove(child){this.children=this.children.filter(item=>item!==child);child.parent=null}
  updateMatrixWorld(){}
  traverse(fn){fn(this);for(const child of this.children)child.traverse?.(fn)}
}
class Geometry {dispose(){this.disposed=true}}
class Material {constructor(){this.map={disposed:false,dispose(){this.disposed=true}}}dispose(){this.disposed=true}}
class Mesh {
  constructor(geometry,material){
    this.geometry=geometry;this.material=material;this.isMesh=true;this.children=[];
    this.name='';this.userData={};this.parent=null;
    this.position={set:(x,y,z)=>{this.xyz=[x,y,z]}};
    this.rotation={y:0};
  }
  traverse(fn){fn(this)}
}
class Matrix4 {
  multiplyMatrices(_parent,instance){this.point=instance.point;return this}
}
class Vector3 {
  setFromMatrixPosition(matrix){Object.assign(this,matrix.point);return this}
}
class InstancedMesh {
  constructor(name,cells){
    this.name=name;this.isInstancedMesh=true;this.count=cells.length;
    this.cells=cells;this.matrixWorld={};
  }
  updateWorldMatrix(){}
  getMatrixAt(index,matrix){matrix.point=this.cells[index]}
  traverse(fn){fn(this)}
}
const previous={materials:globalThis.ProceduralFurniture,patterns:globalThis.FurniturePatternSurfaces,playable:globalThis.RuinLayerPlayable};
let decorated=0; // Records actual calls into the shared pattern-decorating pipeline.
globalThis.ProceduralFurniture={makePartMaterial:()=>new Material()};
globalThis.FurniturePatternSurfaces={decorateRuin:()=>{decorated++;return ['sample-motif']}};
globalThis.RuinLayerPlayable={collect:wing=>wing.tiles}; // Wing-specific 3D footprints must win over overlapping projected floors.
try{
  const Style=require('../docs/js/ruin-multifloor-v50-style.js');
  const scene=new Group();
  const cells=Array.from({length:28},(_,index)=>({x:40+index,y:5,z:80}));
  scene.add(new InstancedMesh('floor1-N-wall-ns',cells));
  scene.add(new InstancedMesh('floor2-E-wall-ew',cells.map(cell=>({...cell,y:9}))));
  const story1=new Set(cells.map(cell=>Math.floor(cell.x)+','+(Math.floor(cell.z)-1)));
  const story2=new Set(cells.map(cell=>Math.floor(cell.x)+','+(Math.floor(cell.z)+1)));
  for(const cell of cells)story2.add((Math.floor(cell.x)+1)+','+Math.floor(cell.z));
  const ruin={localeRoot:new Group(),shaftConnection:{},shaftHubPlan:{floors:[
    {wings:[{id:'floor1-N',tiles:story1}]},
    {wings:[{id:'floor2-E',tiles:story2}]},
  ]}};
  const projected=new Set([...story1,...story2]); // Intentionally conflicting floor footprints at identical X/Z.
  const hub={options:{floors:3,spacing:4},grid:{
    rows:1,cols:1,isSolid:()=>false,canStand:()=>false,
  }};
  let playerY=0;
  const cleanup=Style.apply({rec:{scene,floorSet:projected},ruin,hub,seed:23,
    THREE:{Group,Mesh,Matrix4,Vector3,BoxGeometry:Geometry,MeshBasicMaterial:Material},
    getPlayerY:()=>playerY});
  assert.equal(typeof cleanup,'function');
  assert.equal(typeof cleanup.tick,'function');
  const root=scene.children.find(child=>child.name==='ruin-v50-engraved-masonry');
  assert(root,'V50 engraving group must be registered in the actual scene');
  const f1=root.children.find(child=>child.name==='ruin-v50-masonry-floor-1');
  const f2=root.children.find(child=>child.name==='ruin-v50-masonry-floor-2');
  assert(f1?.children.length>0&&f2?.children.length>0,'both story groups need real wall reliefs');
  assert(f1.children[0].xyz[2]<80,
    'first story engravings face their own chamber even though an upper floor projects onto the opposite side');
  assert.equal(f1.visible,false,'first upper-floor engraving hidden when player is at the entrance');
  assert.equal(f2.visible,false,'second upper-floor engraving hidden when player is at the entrance');
  playerY=4;cleanup.tick();
  assert.equal(f1.visible,true,'story 1 masonry appears at its elevation');
  assert.equal(f2.visible,false,'story 2 masonry stays hidden below it');
  playerY=8;cleanup.tick();
  assert.equal(f2.visible,true,'story 2 masonry appears when player reaches it');
  assert(decorated===1,'use the existing V50 furniture-pattern decoration once for all stories');
  assert(ruin.localeRoot.userData.ruinPatternIds.includes('sample-motif'),
    'collectible wall motifs remain available to the ruin reward system');
  const material=f1.children[0].material;
  cleanup();
  assert(material.disposed&&material.map.disposed,'the V50 material and its cloned PNG texture must both be released');
  assert(!scene.children.includes(root),'all decorative floor groups must leave the scene on reroll');
  console.log('ok V50 shaft masonry: floor-aware visibility, collectible patterns, owned cleanup');
}finally{
  globalThis.ProceduralFurniture=previous.materials;
  globalThis.FurniturePatternSurfaces=previous.patterns;
  globalThis.RuinLayerPlayable=previous.playable;
}
