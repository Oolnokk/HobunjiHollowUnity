#!/usr/bin/env node
'use strict';
// node scripts/test-beard-hood-cutout.js — 2D matte unit + portrait integration regression.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Canvas {
  constructor(width=200,height=200){this._width=width;this._height=height;this.pixels=new Uint8ClampedArray(width*height*4);}
  get width(){return this._width;}
  set width(v){this._width=v;this.pixels=new Uint8ClampedArray(v*this._height*4);}
  get height(){return this._height;}
  set height(v){this._height=v;this.pixels=new Uint8ClampedArray(this._width*v*4);}
  getContext(){
    const canvas=this;
    return {
      globalCompositeOperation:'source-over',
      save(){this._composite=this.globalCompositeOperation;},
      restore(){this.globalCompositeOperation=this._composite;},
      createImageData(w,h){return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)};},
      putImageData(image){canvas.pixels.set(image.data);},
      getImageData(){return {data:new Uint8ClampedArray(canvas.pixels)};},
      drawImage(source,dx=0,dy=0,w=source.width,h=source.height){
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){
          const tx=Math.floor(dx+x),ty=Math.floor(dy+y);
          if(tx<0||ty<0||tx>=canvas.width||ty>=canvas.height)continue;
          const sx=Math.min(source.width-1,Math.floor(x*source.width/w));
          const sy=Math.min(source.height-1,Math.floor(y*source.height/h));
          const from=(sy*source.width+sx)*4,to=(ty*canvas.width+tx)*4;
          const alpha=source.pixels[from+3]/255;
          if(this.globalCompositeOperation==='destination-out'){
            for(let k=0;k<4;k++)canvas.pixels[to+k]=Math.round(canvas.pixels[to+k]*(1-alpha));
          }else{
            for(let k=0;k<4;k++)canvas.pixels[to+k]=source.pixels[from+k];
          }
        }
      },
    };
  }
}
const scope={window:{},document:{createElement:()=>new Canvas()}};
vm.runInNewContext(fs.readFileSync('docs/js/beard-hood-cutout.js','utf8'),scope);
const Cut=scope.window.PortraitBeardHoodCutout;
assert(Cut,'the shared cutout module loads with no Three.js dependency');
const SIZE=Cut.SIZE,at=(x,y)=>y*SIZE+x;
const alpha=(canvas,x,y)=>canvas.pixels[at(x,y)*4+3];
function setPixel(canvas,x,y,a){canvas.pixels.set([88,66,44,a],at(x,y)*4);}
const beard=new Canvas(),hood=new Canvas();
for(let y=75;y<=85;y++)for(let x=90;x<=115;x++)setPixel(beard,x,y,255);
for(let y=70;y<=90;y++)for(let x=82;x<=122;x++)setPixel(hood,x,y,255);
const beardBefore=new Uint8ClampedArray(beard.pixels);
const hoodBefore=new Uint8ClampedArray(hood.pixels);
const source=beard.getContext().getImageData().data;
let mask=Cut.paintMask(null,source,99.5,80.5,3);
assert(Cut.countMask(mask)>0,'brush paints beard pixels');
assert.equal(Cut.decodeMask(mask)[at(99,80)],1,'brush hits selected beard pixel');
assert.equal(Cut.decodeMask(mask)[at(85,80)],0,'brush never marks transparent beard pixels');
mask=Cut.paintMask(mask,source,115,80,1,false,{x:100,y:80});
assert.equal(Cut.decodeMask(mask)[at(109,80)],1,'fast pointer strokes fill the intermediate beard pixels');
const overwritten=Cut.normalizeMask({size:200,runs:[[at(100,80),2],[at(101,80),2],[-1,3],[40000,5]]});
assert.equal(overwritten.runs.length,1,'invalid spans are skipped and duplicates merged');
assert.equal(overwritten.runs[0][1],3,'contiguous spans normalize to their union');
const finalHood=new Canvas();finalHood.pixels.set(hood.pixels);
const result=Cut.applyToHood(finalHood,mask);
assert(result.applied&&result.cutPixels===Cut.countMask(mask),'runtime reports mask coverage');
assert.equal(alpha(finalHood,99,80),0,'painted opaque beard pixel punches a real alpha hole in hood');
assert.equal(alpha(finalHood,85,80),255,'unpainted cloth is unchanged even alongside beard');
assert.equal(alpha(finalHood,119,80),255,'unrelated hood cloth is not cut');
assert.equal(alpha(hood,99,80),255,'the original hood is never modified');
assert.deepEqual(Array.from(beard.pixels),Array.from(beardBefore),'the beard sprite is never changed or repainted');
assert.deepEqual(Array.from(hood.pixels),Array.from(hoodBefore),'the hood source remains intact');
const repeated=new Canvas();repeated.pixels.set(hood.pixels);
Cut.applyToHood(repeated,mask);
assert.deepEqual(Array.from(repeated.pixels),Array.from(finalHood.pixels),'cached matte is safe across independent portrait canvases');
const erased=Cut.paintMask(mask,source,99.5,80.5,3,true);
assert.equal(Cut.decodeMask(erased)[at(99,80)],0,'eraser restores opacity to the target hood');
const emptyResult=Cut.applyToHood(hood, {size:200,runs:[]});
assert.equal(emptyResult.applied,false,'an empty mask performs no draw');
const rect=Cut.encodeMask(Cut.decodeMask(mask));
assert.deepEqual(Array.from(Cut.decodeMask(rect)),Array.from(Cut.decodeMask(mask)),'serialized RLE is pixel-lossless');

const portrait=fs.readFileSync('docs/js/portrait-utils.js','utf8');
const original=fs.readFileSync('docs/index.html','utf8');
const studio=fs.readFileSync('docs/tools/character-studio/index.html','utf8');
const attack=fs.readFileSync('docs/tools/attack-animation-editor/index.html','utf8');
const html=fs.readFileSync('docs/tools/beard-hood-cutout/index.html','utf8');
assert(portrait.includes('const paintedBeardMask = renderOptions?.beardHoodCutoutMaskOverride')
  && portrait.includes('const result = cutoutApi.applyToHood(cloth, paintedBeardMask)'),
  'runtime calls shared compositor only at the separate hood stage');
const beardDraw=portrait.indexOf('if (!_beardBelowHead) drawEmoteLayers(facialHairLayers);');
const hoodDraw=portrait.indexOf('const cutoutApi = window.PortraitBeardHoodCutout;',beardDraw);
const faceDraw=portrait.indexOf('drawEmoteLayers(maskLayers); // Face masks sit over the hood opening',hoodDraw);
assert(beardDraw>=0 && beardDraw<hoodDraw && hoodDraw<faceDraw,
  'main ordering survives: beard, front hood (with cutout), then face mask');
assert(portrait.includes('if (cutoutApi && hoodLayers.length && facialHairLayers.length')
  && portrait.includes('!hiddenCosmeticGroups.has(facialHair)'),
  'no active beard or a facewrap never carves its hood');
assert(portrait.includes('variantHoodCutoutMasks')&&portrait.includes('hoodCutoutMask = maskApi?.normalizeMask'),
  'cosmetic JSON and species variants survive the main option parser');
for(const text of [original,studio,attack])
  assert(text.indexOf('beard-hood-cutout.js')<text.indexOf('portrait-utils.js') && text.includes('beard-hood-cutout.js'),
    'every portrait entrypoint loads the cutout core before portrait-utils');
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
for(const id of ['paintCanvas','beard','hood','variant','paintMode','eraseMode','download','maskJson'])
  assert(html.includes('id="'+id+'"'),'the mobile 2D author exposes '+id);
assert(!html.includes('three.min.js')&&!html.includes('portrait-spline-rig.js'),
  '2D experiment does not load old 3D rig or Three.js');
console.log('Beard/hood cutout: paint/erase, RLE, alpha-only destination-out, unchanged beard/source hood, variant wiring, main draw order and 2D editor parse pass.');
