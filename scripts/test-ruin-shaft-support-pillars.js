#!/usr/bin/env node
'use strict';
// Shaft supports exercise the exact authored pillar recipe, even/odd footprints,
// mount-time geometry, deferred asset loading and disposal of a live ruin.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Supports=require('../docs/js/ruin-shaft-support-pillars.js');
const Jump=require('../docs/js/ruin-jump-shaft.js');
const source=JSON.parse(fs.readFileSync('docs/assets/models/furniture/data/pillar_square.json','utf8')); // The only authored square-pillar source.

class Node {
  constructor(){
    this.name='';this.children=[];this.userData={};this.parent=null;
    this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    this.scale={x:1,y:1,z:1,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
  }
  add(child){this.children.push(child);child.parent=this;}
  remove(child){this.children=this.children.filter(item=>item!==child);child.parent=null;}
  traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);}
}
class Geometry {
  constructor(...dimensions){this.dimensions=dimensions;this.disposed=false;}
  dispose(){this.disposed=true;}
}
class Material {dispose(){this.disposed=true;}}
class Mesh extends Node {
  constructor(geometry,material){super();this.isMesh=true;this.geometry=geometry;this.material=material;}
}
const THREE={Group:Node,Mesh,BoxGeometry:Geometry,MeshBasicMaterial:Material};
const near=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-7,message+': '+a+' vs '+b);
const native=Supports.recipeFromSquarePillar(source); // Derive the runtime overlay from the existing editable asset.
assert.equal(native.data.key,'pillar_square');
assert.equal(native.data.tileSpan.axis,'y');
near(native.data.tileSpan.baseHeight,1.75,'original top to bottom span');
assert.equal(source.parts.some(part=>part.tileSpanRole!==undefined),false,'source pillar furniture must not be mutated');
const byId=new Map(native.data.parts.map(part=>[part.id,part]));
for(const id of ['pillar_square_base0','pillar_square_base1'])assert.equal(byId.get(id).tileSpanRole,'start');
assert.equal(byId.get('pillar_square_shaft').tileSpanRole,'stretch');
assert.equal(byId.get('pillar_square_collar').tileSpanRole,'end');
assert.equal(byId.get('pillar_square_cap').tileSpanRole,'end');
assert.deepEqual(byId.get('pillar_square_shaft').tileSpanRoots,{
  start:{partId:'pillar_square_base1',face:'max'},
  end:{partId:'pillar_square_collar',face:'min'},
});
for(const [width,expected] of [[1,3],[2,2],[3,3],[4,2],[5,3],[6,2],[1.9,2],[3.1,3],[5.4,3]])
  assert.equal(Supports.footprintTiles({w:width}),expected,'rounded tile parity '+width);
assert.equal(Supports.layout({id:'p',w:2,x:8.5,z:9.5,y:12},-8,.45).footprintTiles,2);
assert.equal(Supports.layout({id:'bad',w:2,x:0,z:0,y:-9},-8,.45),null,'invalid height cannot create inverted stone');

for(const theme of ['tothal','hronal','kanthic']){
  const plan=Jump.compose({shaft:37,spacing:10,floors:4,theme,seed:42});
  assert(plan.ok);
  for(const p of plan.platforms){
    const dims=Supports.layout(p,plan.pit.bottomY,.45);
    assert(dims,'every verified platform receives a support');
    near(dims.x,p.x,'support centered on X');
    near(dims.z,p.z,'support centered on Z');
    near(dims.bottomY,plan.pit.bottomY,'foot sits on the pit basin');
    near(dims.bottomY+dims.height,p.y-.45,'capital flush with slab underside');
    assert([2,3].includes(dims.footprintTiles),'tile-sized base');
  }
}

async function run(){
  const previous=globalThis.AuthoredFurniture;
  const previousSpan=globalThis.FurnitureTileSpan;
  const buildCalls=[],spanCalls=[],released=[];
  try{
    globalThis.AuthoredFurniture={
      buildGroup(data){
        buildCalls.push(data);
        const group=new Node();
        group.userData.meshById=new Map();
        for(const part of data.parts){
          const mesh=new Mesh(new Geometry(part.transform.sx,part.transform.sy,part.transform.sz),new Material());
          mesh.userData.authoredPartId=part.id;
          group.add(mesh);group.userData.meshById.set(part.id,mesh);
        }
        return group;
      },
      setTileSpan(group,height){
        spanCalls.push(height);
        group.userData.activeHeightSpan=height;
        return {enabled:true,errors:[]};
      },
    };
    globalThis.FurnitureTileSpan={release(mesh){released.push(mesh);}}; // A stretched authored part must release its hidden original geometry.
    const plan=Jump.compose({shaft:37,spacing:10,floors:3,theme:'tothal',seed:101});
    const root=new Node();
    const runtime=Supports.mount(plan,{THREE,parent:root,slabThickness:.45,loadTemplate:()=>source});
    assert.equal(root.children.length,plan.platforms.length,'placeholder exists immediately for every slab');
    assert.equal(runtime.getState().fallback,plan.platforms.length);
    assert(root.children.every(holder=>holder.children.length===1),'exactly one temporary pillar per slab');
    await runtime.ready;
    const state=runtime.getState();
    assert.equal(state.authored,plan.platforms.length,'all placeholders upgrade to canonical authored parts');
    assert.equal(state.fallback,0);
    assert.equal(state.failures,0);
    assert.equal(state.bases2x2+state.bases3x3,plan.platforms.length);
    assert.equal(buildCalls.length,plan.platforms.length);
    assert.equal(spanCalls.length,plan.platforms.length);
    for(let i=0;i<plan.platforms.length;i++){
      const p=plan.platforms[i],holder=root.children[i],visual=holder.children[0],tiles=Supports.footprintTiles(p);
      assert.equal(visual.name,'authored-pillar-square-'+p.id);
      near(holder.position.x,p.x,'live pillar X matches platform');
      near(holder.position.z,p.z,'live pillar Z matches platform');
      near(holder.position.y,plan.pit.bottomY,'live pillar begins in pit');
      near(spanCalls[i],p.y-.45-plan.pit.bottomY,'stretch target is underside');
      near(visual.scale.x,tiles/.78,'base exactly two or three tiles wide');
      near(visual.scale.z,tiles/.78,'base exactly two or three tiles deep');
      assert.equal(visual.userData.devRuinFootprintIgnore,true,'pillar does not block walking or provide fall support');
      assert(visual.children.every(child=>child.userData.devRuinFootprintIgnore),'every authored mesh stays non-physical');
    }
    runtime.dispose();
    assert.equal(root.children.length,0,'no old pillar group survives zone teardown');
    assert.equal(released.length,plan.platforms.length*5,'every authored part releases tile-span source');
    const until=buildCalls.length;
    runtime.dispose();
    assert.equal(buildCalls.length,until,'dispose idempotent');

    let finish;
    const lateParent=new Node();
    const late=Supports.mount(plan,{THREE,parent:lateParent,loadTemplate:()=>new Promise(resolve=>{finish=resolve;})});
    await Promise.resolve(); // Start the intentionally unresolved source read.
    late.dispose();
    finish(source);
    await late.ready;
    assert.equal(lateParent.children.length,0,'stale asynchronous source never recreates a disposed ruin');
    assert.equal(buildCalls.length,until,'no post-teardown authored meshes are built');

    const missingParent=new Node();
    const missing=Supports.mount(plan,{THREE,parent:missingParent,loadTemplate:()=>null});
    await missing.ready;
    assert.equal(missing.getState().authored,0,'missing source retains temporary stone structure');
    assert.equal(missing.getState().fallback,plan.platforms.length,'missing source is visible in mobile diagnostics');
    missing.dispose();
  }finally{
    if(previous===undefined)delete globalThis.AuthoredFurniture;
    else globalThis.AuthoredFurniture=previous;
    if(previousSpan===undefined)delete globalThis.FurnitureTileSpan;
    else globalThis.FurnitureTileSpan=previousSpan;
  }
  console.log('ruin shaft square support pillars: ok');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
