#!/usr/bin/env node
'use strict';
// Tests the exact production raster mapper without initializing Three or a DOM.
// The farm cliff mapper fits a complete PNG to each irregular surface; these
// fixtures adapt that contract to sprite regions enclosed by black pixel ink.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('docs/js/procedural-furniture.js','utf8');
const begin=code.indexOf('  function paintStatueSurfaceCells(');
const end=code.indexOf('  function paintedStatueCanvas(',begin);
assert.ok(begin>0&&end>begin,'Statue renderer exposes the real irregular-surface mapper');
const scope={};
vm.runInNewContext(code.slice(begin,end)+'\nthis.paint=paintStatueSurfaceCells;',scope);
const paint=scope.paint;
const width=42,height=26;
const idx=(x,y)=>4*(y*width+x);
const sourcePixels=new Uint8ClampedArray(width*height*4);
const material=new Uint8ClampedArray(sourcePixels.length);
function write(x,y,r,g,b,a=255){const o=idx(x,y);sourcePixels.set([r,g,b,a],o);}
function cell(left,right,top,bottom,shift=0){
  // Irregular trapezoidal island with no openings through the dark stroke.
  for(let y=top;y<=bottom;y++){
    const l=left+(y>top+6?shift:0),r=right+(y>top+7?shift:0);
    for(let x=l;x<=r;x++){
      const edge=y===top||y===bottom||x===l||x===r;
      write(x,y,...(edge?[0,0,0]:[198,160,125]));
    }
  }
}
cell(3,16,2,20,2);
cell(23,38,4,22,-2);
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const edge=x<width*.16||x>width*.84||y<height*.16||y>height*.84;
  const c=edge?34:175;
  material.set([c,Math.round(c*.78),Math.round(c*.62),255],idx(x,y));
}
const before=sourcePixels.slice();
const mapped=paint(sourcePixels,material,width,height,{preserveInk:true});
assert.equal(mapped.stats.regions,2,'Every disconnected ink-enclosed region receives its own surface');
assert.ok(mapped.stats.inkPixels>70,'Black perimeter outlines are recognized and kept');
assert.ok(mapped.stats.painted>150,'Both irregular interiors must be textured');
assert.deepEqual(sourcePixels,before,'The authored pixel source is never mutated');
const pix=(data,x,y)=>Array.from(data.slice(idx(x,y),idx(x,y)+4));
assert.deepEqual(pix(mapped.data,3,8),pix(before,3,8),'The original black outline is unchanged');
assert.deepEqual(pix(mapped.data,0,0),pix(before,0,0),'Transparent exterior remains fully transparent');
assert.ok(pix(mapped.data,10,11)[0]>130,'Region one receives the lighter middle of the complete material PNG');
assert.ok(pix(mapped.data,30,12)[0]>130,'Region two receives its own independent full material PNG');
assert.ok(pix(mapped.data,6,11)[0]>0&&pix(mapped.data,6,11)[0]<pix(mapped.data,10,11)[0],
  'The original material dark rim warps to the left side of an irregular region instead of being cropped away');
assert.ok(pix(mapped.data,35,12)[0]<pix(mapped.data,30,12)[0],
  'The material dark rim also follows the second region, not a fixed global tile boundary');
assert.equal(pix(mapped.data,10,11)[3],before[idx(10,11)+3],'Original opaque alpha survives');
const second=paint(sourcePixels,material,width,height,{preserveInk:true});
assert.deepEqual(mapped.data,second.data,'Region UV mapping is deterministic across rebuilt statues');

const solid=new Uint8ClampedArray(sourcePixels.length);
for(let y=4;y<18;y++)for(let x=4;x<17;x++)solid.set([0,0,0,255],idx(x,y));
const solidResult=paint(solid,material,width,height,{preserveInk:true});
assert.equal(solidResult.stats.fallbackAllBlack,true,'All-black weapon art receives a non-black textured silhouette');
assert.equal(solidResult.stats.regions,1,'All-black silhouette is one component, not thousands of black pixels');
assert.ok(solidResult.data[idx(10,11)]>50,'All-black source is rendered with the selected material');

const full=new Uint8ClampedArray(sourcePixels.length);
for(let i=0;i<full.length;i+=4)full.set([90,80,70,255],i);
assert.throws(()=>paint(full,material,width,height,{preserveInk:true}),/rectangular/,
  'A missing portrait source cannot turn into an opaque material rectangle');
assert.throws(()=>paint(sourcePixels,material,width,0),/bounded RGBA/,
  'Invalid image dimensions cannot enter the region scan');
console.log('PASS ink-bounded irregular statue surfaces: 2 independently warped material regions, black outlines, transparent pixels, all-black fallback and validation.');
