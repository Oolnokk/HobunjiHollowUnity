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
const end=furnitureSource.indexOf('  const statueOverlayInfoCache=',start);
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
console.log('PASS two-pass statue: animal shading per outlined cell, shared grayscale alpha overlay, untouched ink, white-inclusive option and GLB tint semantics.');
