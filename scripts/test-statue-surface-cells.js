#!/usr/bin/env node
'use strict';
// Validate actual animal ColorFill and the Statue Author's two-pass mapper.
// No DOM or GPU: small RGBA fixtures prove individual shading and one full-size
// brightness-alpha material overlay, without a crop or per-region texture restart.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const colorSource=fs.readFileSync('docs/js/color-fill.js','utf8');
const furnitureSource=fs.readFileSync('docs/js/procedural-furniture.js','utf8');
const start=furnitureSource.indexOf('  function statueMaterialColor(');
const end=furnitureSource.indexOf('  const statueOverlayAtlasCache=',start);
assert.ok(start>0&&end>start,'Real connected-cell and overlay painter is required');
const context={window:{}};
vm.runInNewContext(colorSource,context,{filename:'color-fill.js'});
vm.runInNewContext(furnitureSource.slice(start,end)+'\nthis.paint=paintStatueSurfaceCells;',context,
  {filename:'procedural-furniture.js:painter'});
const paint=context.paint;
const w=42,h=26;
const idx=(x,y)=>4*(y*w+x); // Pixels are indexed in one shared portrait-wide frame.
const source=new Uint8ClampedArray(w*h*4);
const overlay=new Uint8ClampedArray(source.length);
const write=(x,y,r,g,b,a=255)=>source.set([r,g,b,a],idx(x,y));
function cell(left,right,top,bottom,shift=0){
  for(let y=top;y<=bottom;y++){
    const l=left+(y>top+6?shift:0),r=right+(y>top+7?shift:0);
    for(let x=l;x<=r;x++){
      const edge=y===top||y===bottom||x===l||x===r;
      const color=edge?[0,0,0]:(x===l+2&&y===top+2?[245,245,245]:[210,168,137]);
      write(x,y,...color);
    }
  }
}
cell(3,16,2,20,2);
cell(23,38,4,22,-2);
write(12,11,100,80,60); // Two brightness values within the first region.
write(30,12,120,100,85); // A darker pixel in region two.
write(33,12,255,255,255); // White must be recolored, not left as a bright eye.
const before=source.slice();
const color=[174,181,196];
const white=()=>{for(let p=0;p<overlay.length;p+=4)overlay.set([255,255,255,255],p);};
const pix=(data,x,y)=>Array.from(data.slice(idx(x,y),idx(x,y)+4));
white();
const natural=paint(source,overlay,w,h,{preserveInk:true,baseColor:color});
assert.equal(natural.stats.mode,'animal-cell-shading-global-brightness-overlay');
assert.equal(natural.stats.regions,2,'Independent black-outlined regions must be recolored separately');
assert.ok(natural.stats.inkPixels>70,'Original dark ink must be identified');
assert.ok(natural.stats.painted>150,'Both connected interior regions were filled');
assert.equal(natural.stats.overlayPixels,0,'White overlay has zero alpha everywhere');
assert.deepEqual(source,before,'Source sprite is not mutated');
assert.deepEqual(pix(natural.data,3,8),pix(before,3,8),'Opaque black stroke is untouched');
assert.deepEqual(pix(natural.data,0,0),pix(before,0,0),'Transparent exterior is untouched');
assert.deepEqual(pix(natural.data,33,12).slice(0,3),color,'Brightest white in cell becomes chosen statue tint');
assert.ok(pix(natural.data,30,12)[0]<color[0]*.6,'Darker interior preserves its relative source darkness');
assert.ok(pix(natural.data,12,11)[0]<color[0]*.5,'A different region also preserves its own dark shade');
const brightnessRatio = pix(natural.data,12,11)[0]/Math.max(1,pix(natural.data,10,11)[0]);
assert.ok(brightnessRatio<.62,'Each enclosed region gets its own brightest-pixel shading reference');

for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const grayscale=Math.round(255*x/(w-1)); // One uninterrupted overlay across BOTH enclosed cells.
  overlay.set([grayscale,grayscale,grayscale,255],idx(x,y));
}
const global=paint(source,overlay,w,h,{preserveInk:true,baseColor:color,overlayPeak:1});
assert.equal(global.stats.regions,2);
assert.ok(global.stats.overlayPixels>100);
assert.ok(global.stats.meanOverlayAlpha>0&&global.stats.meanOverlayAlpha<1);
assert.ok(pix(global.data,6,11)[0]<pix(natural.data,6,11)[0],
  'Dark material at the left side produces an opaque gray/dark overlay');
assert.ok(pix(global.data,35,12)[0]>=pix(global.data,6,11)[0],
  'Right side is lighter because one global texture frame continues across cell boundaries');
assert.deepEqual(pix(global.data,3,8),pix(before,3,8),'Overlay cannot replace original black strokes');
assert.deepEqual(pix(global.data,0,0),pix(before,0,0),'Overlay cannot fill transparent space');
assert.equal(pix(global.data,30,12)[3],before[idx(30,12)+3],'Overlay never changes source alpha');

const solid=new Uint8ClampedArray(source.length);
for(let y=4;y<18;y++)for(let x=4;x<17;x++)solid.set([0,0,0,255],idx(x,y));
white();
const fallback=paint(solid,overlay,w,h,{preserveInk:true,baseColor:color});
assert.equal(fallback.stats.fallbackAllBlack,true,'All-black weapon sprites remain tintable');
assert.equal(fallback.stats.regions,1);
assert.deepEqual(pix(fallback.data,10,11).slice(0,3),color);
const repeated=paint(source,overlay,w,h,{preserveInk:true,baseColor:color});
assert.deepEqual(repeated.data,natural.data,'Statue material rebuilds are deterministic');
const full=new Uint8ClampedArray(source.length);
for(let i=0;i<full.length;i+=4)full.set([90,80,70,255],i);
assert.throws(()=>paint(full,overlay,w,h,{preserveInk:true}),/rectangular/);
assert.throws(()=>paint(source,overlay,w,0),/bounded RGBA/);

// Existing creature fills must still skip white/near-white unless opted in.
// Statue fills opt in for sculpted white face/eye regions.
const sourceWhite=new Uint8ClampedArray([255,255,255,255,120,120,120,255]);
const defaultFill=sourceWhite.slice();
context.window.ColorFill.shadeFillPixels(defaultFill,[150,160,170]);
assert.deepEqual(Array.from(defaultFill.slice(0,3)),[255,255,255],
  'Unrelated animal callers retain historical white-exclusion defaults');
const optFill=sourceWhite.slice();
context.window.ColorFill.shadeFillPixels(optFill,[150,160,170],{includeNearWhite:true});
assert.deepEqual(Array.from(optFill.slice(0,3)),[150,160,170],
  'Statue-opted white-inclusive animal fill maps brightest white to base tint');

// Actual production UV fallback: flat-color GLB vertex UVs previously sampled
// one near-black corner of the material, making whole feet/hands pitch black.
const uvStart=furnitureSource.indexOf('  function ensureStatueModelUV(');
const uvEnd=furnitureSource.indexOf('  function attachGlb(',uvStart);
assert.ok(uvStart>0&&uvEnd>uvStart,'Expected canonical furniture UV fallback');
const stubThree={
  Vector3:class Vector3 {constructor(){this.x=0;this.y=0;this.z=0;}},
  BufferAttribute:class BufferAttribute {
    constructor(array,itemSize){this.array=array;this.itemSize=itemSize;this.count=array.length/itemSize;}
    getX(i){return this.array[i*this.itemSize];}
    getY(i){return this.array[i*this.itemSize+1];}
    getZ(i){return this.array[i*this.itemSize+2];}
  }
};
const uvScope={THREE:stubThree};
vm.runInNewContext(furnitureSource.slice(uvStart,uvEnd)+'\nthis.ensureUv=ensureStatueModelUV;',uvScope);
function sampleGlb(uv){
  const pos=new stubThree.BufferAttribute(new Float32Array([
    0,0,0, 2,0,0, 0,.05,3, 2,.05,3
  ]),3);
  const geometry={
    attributes:{position:pos,...(uv?{uv}:null)},
    getAttribute(name){return this.attributes[name]||null;},
    setAttribute(name,value){this.attributes[name]=value;},
    boundingBox:{
      min:{x:0,y:0,z:0},
      getSize(result){Object.assign(result,{x:2,y:.05,z:3});return result;}
    }
  };
  return {geometry,userData:{}};
}
const untextured=sampleGlb(null);
assert.equal(String(uvScope.ensureUv(untextured)),'projected-zx',
  'Missing GLB UVs should map broad Z/X axes, not tiny Y');
assert.equal(untextured.userData.statueGeneratedUv,true);
const created=untextured.geometry.getAttribute('uv');
assert.equal(created.count,4);
assert.deepEqual(Array.from(created.array.slice(0,2)),[0,0]);
assert.deepEqual(Array.from(created.array.slice(-2)),[1,1]);
const collapsed=sampleGlb(new stubThree.BufferAttribute(new Float32Array(8),2));
assert.ok(String(uvScope.ensureUv(collapsed)).startsWith('projected-'),
  'A constant UV must be treated like an absent UV, not allowed to sample a black corner');
const authored=new stubThree.BufferAttribute(new Float32Array([
  0,0,1,0,0,1,1,1
]),2);
const existing=sampleGlb(authored);
assert.equal(uvScope.ensureUv(existing),'authored','Usable authored GLB UVs remain unchanged');
assert.equal(existing.geometry.getAttribute('uv'),authored);

// One source PNG is center-cropped exactly once, then reused by the body,
// cropped head, and 3D limbs. The farm furniture texture's black perimeter
// must not become a dark hood across the upper quarter of the whole statue.
const atlasStart=furnitureSource.indexOf('  const statueOverlayAtlasCache=');
const atlasEnd=furnitureSource.indexOf('  function paintedStatueCanvas(',atlasStart);
assert.ok(atlasStart>0&&atlasEnd>atlasStart,'Shared statue overlay atlas must exist');
const draws=[];
const mockDocument={createElement(type){
  assert.equal(type,'canvas');
  const canvas={width:0,height:0,getContext(){
    return {drawImage(...args){draws.push(args);},
      getImageData(){return {data:new Uint8ClampedArray([190,175,160,255,180,165,150,255])};}};
  }};
  return canvas;
}};
const atlasScope={document:mockDocument,window:context.window,
  statueMaterialColor:()=>[185,175,162]};
vm.runInNewContext(furnitureSource.slice(atlasStart,atlasEnd)+
  '\nthis.atlas=statueOverlayAtlas;',atlasScope);
const fakePng={width:100,height:200};
const shared1=atlasScope.atlas(fakePng),shared2=atlasScope.atlas(fakePng);
assert.equal(shared1,shared2,'Head/body/limbs use the identical cached overlay atlas');
assert.equal(draws.length,1,'PNG interior is sampled only once per material');
assert.equal(draws[0][1],16,'Dark left texture edge must be excluded');
assert.equal(draws[0][2],32,'Dark upper texture edge must be excluded');
assert.equal(draws[0][3],68);
assert.equal(draws[0][4],136);
assert.ok(shared1.peak>0,'Overlay peak is measured from cropped texture');

console.log('PASS two-pass statue: animal shading per outlined cell, shared grayscale alpha overlay, untouched ink, white-inclusive option and GLB UV fallback and shared interior atlas.');
