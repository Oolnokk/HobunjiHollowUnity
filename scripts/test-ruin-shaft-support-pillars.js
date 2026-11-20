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
    this.rotation={x:0};
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
class Material {
  constructor(options={}){Object.assign(this,options);this.disposals=0;}
  dispose(){this.disposals++;}
}
class Mesh extends Node {
  constructor(geometry,material){super();this.isMesh=true;this.geometry=geometry;this.material=material;}
}
const THREE={Group:Node,Mesh,BoxGeometry:Geometry,PlaneGeometry:Geometry,MeshBasicMaterial:Material};
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
const shaft=byId.get('pillar_square_shaft').transform;
const rise=byId.get('pillar_square_base1').transform,neck=byId.get('pillar_square_collar').transform;
near(shaft.y-shaft.sy/2,rise.y+rise.sy/2,'shaft starts exactly at top of raised foot');
near(shaft.y+shaft.sy/2,neck.y-neck.sy/2,'shaft ends exactly under collar before stretching');
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
        group.userData.authoredFurnitureData=data;
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
    const pillarStone=new Material(); // Model the material borrowed from the shaft runtime.
    const runtime=Supports.mount(plan,{THREE,parent:root,slabThickness:.45,material:pillarStone,loadTemplate:()=>source});
    assert.equal(root.children.length,plan.platforms.length,'placeholder exists immediately for every slab');
    assert.equal(runtime.getState().fallback,plan.platforms.length);
    assert(root.children.every(holder=>holder.children.length===1),'exactly one temporary pillar per slab');
    for(let i=0;i<plan.platforms.length;i++){
      const slab=plan.platforms[i],fallback=root.children[i].children[0];
      const pieces=new Map(fallback.children.map(node=>[node.name,node]));
      const foot=pieces.get('foot'),shaft=pieces.get('stone-shaft'),capital=pieces.get('capital');
      near(foot.geometry.dimensions[0],Supports.footprintTiles(slab)*.75,'loading foot matches slim even/odd sizing');
      assert(fallback.children.every(piece=>piece.material===pillarStone),'loading pieces use the supplied material');
      assert(capital.geometry.dimensions[0]<=slab.w,'fallback capital does not overhang platform width');
      assert(capital.geometry.dimensions[2]<=slab.d,'fallback capital does not overhang platform depth');
      near(shaft.position.y-shaft.geometry.dimensions[1]/2,.16,'fallback shaft meets foot');
      near(shaft.position.y+shaft.geometry.dimensions[1]/2,
        capital.position.y-capital.geometry.dimensions[1]/2,'fallback shaft meets capital');
    }
    await runtime.ready;
    const state=runtime.getState();
    assert.equal(state.authored,plan.platforms.length,'all placeholders upgrade to canonical authored parts');
    assert.equal(state.fallback,0);
    assert.equal(state.failures,0);
    assert.equal(state.narrowBases+state.wideBases,plan.platforms.length);
    assert.equal(buildCalls.length,plan.platforms.length);
    assert.equal(spanCalls.length,plan.platforms.length);
    for(let i=0;i<plan.platforms.length;i++){
      const p=plan.platforms[i],holder=root.children[i],visual=holder.children[0],tiles=Supports.footprintTiles(p);
      assert.equal(visual.name,'authored-pillar-square-'+p.id);
      near(holder.position.x,p.x,'live pillar X matches platform');
      near(holder.position.z,p.z,'live pillar Z matches platform');
      near(holder.position.y,plan.pit.bottomY,'live pillar begins in pit');
      near(spanCalls[i],p.y-.45-plan.pit.bottomY,'stretch target is underside');
      const parts=new Map(visual.userData.authoredFurnitureData.parts.map(part=>[part.id,part]));
      near(parts.get('pillar_square_base0').transform.sx,tiles*.75,'slim base is 1.5 or 2.25 tiles wide');
      near(parts.get('pillar_square_base0').transform.sz,tiles*.75,'slim base is 1.5 or 2.25 tiles deep');
      assert(parts.get('pillar_square_cap').transform.sx<=p.w,'capital stays within platform width');
      assert(parts.get('pillar_square_cap').transform.sz<=p.d,'capital stays within platform depth');
      assert(parts.get('pillar_square_shaft').transform.sx<parts.get('pillar_square_cap').transform.sx,'shaft tapers beneath capital');
      assert.equal(visual.userData.devRuinFootprintIgnore,true,'pillar does not block walking or provide fall support');
      assert(visual.children.every(child=>child.userData.devRuinFootprintIgnore),'every authored mesh stays non-physical');
      assert(visual.children.every(piece=>piece.material===pillarStone),'authored pieces use the supplied material');
    }
    runtime.dispose();
    assert.equal(pillarStone.disposals,0,'disposing supports leaves their material to its owner');
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

    // A temporary network error must be retried on the next ruin, not cached as permanent missing furniture.
    const previousDocument=globalThis.document,previousFetch=globalThis.fetch;
    try{
      globalThis.document={};
      let requests=0;
      globalThis.fetch=async()=>++requests===1
        ? {ok:false,status:503}
        : {ok:true,json:async()=>source};
      const offline=Supports.mount(plan,{THREE,parent:new Node()});
      await offline.ready;
      assert.equal(offline.getState().authored,0,'first network failure leaves the safe placeholder');
      offline.dispose();
      const recovered=Supports.mount(plan,{THREE,parent:new Node()});
      await recovered.ready;
      assert.equal(requests,2,'second ruin must retry the original authored asset');
      assert.equal(recovered.getState().authored,plan.platforms.length,'recovered asset upgrades every pillar');
      recovered.dispose();
      const previousFactory=globalThis.ProceduralFurniture;
      const texture={name:'carved_smooth.png'}; // Model the shared texture cache on the production material path.
      globalThis.ProceduralFurniture={makePartMaterial:part=>new Material({...part,map:texture})};
      try{
        for(const theme of ['hronal','tothal','kanthic']){
          const themedPlan=Jump.compose({shaft:37,spacing:10,floors:3,theme,seed:101});
          const parent=new Node();
          const shaft=Jump.mount(themedPlan,{THREE,parent,DynamicSurfaces:{registerSurface(){},clearScope(){}}});
          const meshes=()=>themedPlan.platforms.map(p=>{
            const group=parent.children[0];
            const slab=group.children.find(node=>node.name===p.id).children[0];
            const pillar=group.children.find(node=>node.name==='shaft-structural-pillar-'+p.id).children[0];
            return {slab,pillar};
          }); // Read the scene graph through the normal shaft mount.
          const slabFinish=meshes()[0].slab.material;
          const pillarFinish=meshes()[0].pillar.children[0].material;
          assert.notEqual(pillarFinish,slabFinish,'ground X-ray edits must stay on the slab');
          assert.deepEqual(pillarFinish,slabFinish,'the pillar and slab have identical carved stone finishes');
          assert.equal(pillarFinish.map,slabFinish.map,'the two materials share one texture');
          slabFinish.colorWrite=false; // Simulate the compositor preparing the slab for depth replay.
          assert.notEqual(pillarFinish.colorWrite,false,'pillars remain outside the floor material transaction');
          for(const {pillar} of meshes())assert(pillar.children.every(piece=>piece.material===pillarFinish));
          await new Promise(resolve=>setImmediate(resolve));
          assert.equal(shaft.getState().supportPillars.authored,themedPlan.platforms.length);
          for(const {pillar} of meshes())assert(pillar.children.every(piece=>piece.material===pillarFinish));
          shaft.dispose();
          assert.equal(slabFinish.disposals,1,'the shaft releases the slab material exactly once');
          assert.equal(pillarFinish.disposals,1,'the shaft releases the pillar material exactly once');
        }
      }finally{
        if(previousFactory===undefined)delete globalThis.ProceduralFurniture;
        else globalThis.ProceduralFurniture=previousFactory;
      }
    }finally{
      if(previousDocument===undefined)delete globalThis.document;
      else globalThis.document=previousDocument;
      if(previousFetch===undefined)delete globalThis.fetch;
      else globalThis.fetch=previousFetch;
    }
  }finally{
    if(previous===undefined)delete globalThis.AuthoredFurniture;
    else globalThis.AuthoredFurniture=previous;
    if(previousSpan===undefined)delete globalThis.FurnitureTileSpan;
    else globalThis.FurnitureTileSpan=previousSpan;
  }
  console.log('ruin shaft square support pillars: ok');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
