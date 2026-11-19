#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const modulePath=path.join(__dirname,'../docs/tools/clothing-species-fit/headband-spline-fit.js'); // Test the shipped pixel-only authoring module, not a parallel implementation.
const host={window:{}};
vm.runInNewContext(fs.readFileSync(modulePath,'utf8'),host,{filename:'headband-spline-fit.js'});
const spline=host.window.ClothingHeadbandSpline;
assert.equal(spline.NODES,7,'The author has exactly seven control points per spline');
const width=120,height=68,pixels=new Uint8ClampedArray(width*height*4); // Synthetic curved headband with transparent surroundings.
for(let x=15;x<105;x++)for(let d=-2;d<=2;d++){
  const y=Math.round(30-10*Math.sin(Math.PI*(x-15)/89))+d,offset=(y*width+x)*4;
  pixels[offset]=110+(x%7)*5;pixels[offset+1]=215;pixels[offset+2]=90;pixels[offset+3]=255;
}
const source=spline.trace(pixels,width,height);
assert(source&&spline.valid(source),'Alpha scan maps a curved headband to seven ordered nodes');
assert(source[3].y<source[0].y,'The automatically traced crown curves upwards at its centre');
const identity=spline.warp(pixels,width,height,source,source);
assert.deepEqual([...identity],[...pixels],'Identical source/target curves leave ALL RGBA pixels unchanged');
const target=source.map(p=>({x:p.x,y:p.y+.12})); // Translate the entire curved band downward.
const translated=spline.warp(pixels,width,height,source,target);
assert(translated.some((v,i)=>v!==pixels[i]),'A displaced spline changes the raster');
function occupiedMeanY(data){
  let count=0,sum=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(data[(y*width+x)*4+3]){count++;sum+=y}
  }
  return sum/count;
}
assert(occupiedMeanY(translated)>occupiedMeanY(pixels)+5,'The warped pixels follow the target arc down');
for(let x=0;x<width;x++)for(let y=0;y<height;y++){
  const offset=(y*width+x)*4;
  assert([0,255].includes(translated[offset+3]),'Nearest-neighbour mapping preserves crisp sprite transparency');
}
const bent=source.map(p=>({...p}));
bent[3]={...bent[3],y:bent[3].y-.1};
assert(spline.valid(bent),'The seven-node centre bend remains a valid spline');
const mid=spline.curveAt(bent,3),left=spline.curveAt(bent,3-.001),right=spline.curveAt(bent,3+.001);
assert(Math.abs(left.y-mid.y)<.01&&Math.abs(right.y-mid.y)<.01,'Spline is continuous across a moved node');
const clamped=spline.dragNode(source,3,1,5,width,height);
assert(spline.valid(clamped),'Dragging node across neighbours cannot reverse or fold the spline');
assert(clamped[3].x<source[4].x&&clamped[3].y===1,'Drag safely clamps x order and y bounds');
assert.throws(()=>spline.warp(pixels,width+1,height,source,target),/Invalid headband/,'Raster size mismatch fails explicitly');
assert.equal(spline.trace(new Uint8ClampedArray(pixels.length),width,height),null,'Blank sprites do not silently acquire guessed curves');
console.log('OK: seven control points, auto-map, smooth node movement, identity/curved warps, alpha and input validation');
