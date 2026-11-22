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
      getImageData(){return {data:new Uint8ClampedArray(canvas.pixels),width:canvas.width,height:canvas.height};},
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

// Alpha paintability applies to newly painted pixels, not to erasing already saved pixels.
const feather=new Canvas();setPixel(feather,95,82,90);setPixel(feather,96,82,127);
setPixel(feather,97,82,128);setPixel(feather,98,82,230);
const featherArt=feather.getContext().getImageData().data;
const highAlpha=Cut.paintMask(null,featherArt,96.5,82.5,4,false,null,128);
assert.equal(Cut.decodeMask(highAlpha)[at(95,82)],0,'alpha floor blocks faint fringe');
assert.equal(Cut.decodeMask(highAlpha)[at(96,82)],0,'opacity just below floor is excluded');
assert.equal(Cut.decodeMask(highAlpha)[at(97,82)],1,'opacity equal to floor is paintable');
assert.equal(Cut.decodeMask(highAlpha)[at(98,82)],1,'opaque beard remains paintable');
const lowAlpha=Cut.paintMask(null,featherArt,95.5,82.5,1,false,null,64);
assert.equal(Cut.decodeMask(lowAlpha)[at(95,82)],1,'lowering floor makes faint beard pixels eligible');
const erasedFringe=Cut.paintMask(lowAlpha,featherArt,95.5,82.5,1,true,null,255);
assert.equal(Cut.decodeMask(erasedFringe)[at(95,82)],0,'eraser ignores opacity floor');
assert.equal(Cut.alphaFloor('128'),128,'numeric slider values work');
assert.equal(Cut.alphaFloor(-4),1,'minimum floor clamps safely');

// A hollow fine-hood-like annulus: face opening at (100,94), inner ring radius 30,
// outer cloth radius 60. Tuft corners beyond the opening pull ONLY the near ring.
const ringHood=new Canvas(),ringCenter={x:100,y:94};
for(let y=0;y<200;y++)for(let x=0;x<200;x++){
  const dist=Math.hypot(x+.5-ringCenter.x,y+.5-ringCenter.y);
  if(dist>=30&&dist<=60)setPixel(ringHood,x,y,255);
}
const ringBefore=new Uint8ClampedArray(ringHood.pixels);
const roots=Cut.normalizeRoots([{x:140.5,y:94.5},{x:60.5,y:94.5}]);
assert.equal(roots.length,2,'multiple corner markers round-trip');
const plan=Cut.planTuftStretch(ringHood.pixels,roots,{maxStretch:36});
assert.equal(plan.stretched,2,'outside tuft roots pull the first inner hood edge');
assert(plan.moves.every(move=>Math.hypot(move.delta.x,move.delta.y)<15),
  'ring stretch uses nearby INNER edge, not distant outer rim');
const ringResult=Cut.stretchHoodToRoots(ringHood,roots,{maxStretch:36});
assert.equal(ringResult.stretched,2,'left and right tuft roots both deform the same front hood');
assert.equal(alpha(ringHood,135,94),0,'left/right displacement expands the inner opening');
assert(alpha(ringHood,140,94)>=128,'hood cloth ring stretches exactly to the right tuft root');
assert(alpha(ringHood,60,94)>=128,'hood cloth ring stretches exactly to the left tuft root');
assert.equal(alpha(ringHood,100,94),0,'central face opening remains transparent');
assert.equal(alpha(ringHood,100,35),ringBefore[at(100,35)*4+3],
  'pixels far from both tuft corners retain original cloth');
const noMove=new Canvas();noMove.pixels.set(ringBefore);
const inside=Cut.stretchHoodToRoots(noMove,[{x:115,y:94}],{maxStretch:36});
assert.equal(inside.insideRing,1,'tuft already inside the ring does not stretch the hood');
assert.equal(inside.stretched,0,'no active deformation for interior tuft');
assert.deepEqual(Array.from(noMove.pixels),Array.from(ringBefore),'inside ring leaves hood exactly unchanged');
const constrained=Cut.stretchHoodToRoots(noMove,[{x:164,y:94}],{maxStretch:12});
assert.equal(constrained.stretched,0,'too-distant tuft cannot pull the whole hood across the face');
assert.equal(constrained.tooFar,1,'overstretch is surfaced in diagnostics');
const rootInput=[{x:140,y:94}],rootSnapshot=JSON.stringify(rootInput);
Cut.stretchHoodToRoots(new Canvas(),rootInput);
assert.equal(JSON.stringify(rootInput),rootSnapshot,'root normalization never mutates authored JSON');

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
assert(portrait.includes('cutoutApi.stretchHoodToRoots(cloth, tuftRoots') &&
  portrait.indexOf('cutoutApi.stretchHoodToRoots(cloth, tuftRoots') < portrait.indexOf('cutoutApi.applyToHood(cloth, paintedBeardMask)'),
  'runtime stretches hood inner ring before the independent beard cutout mask');
assert(portrait.includes('variantHoodTuftRoots') && portrait.includes('hoodTuftMaxStretch'),
  'species-specific tuft anchors and stretch limits are loaded as optional cosmetic metadata');
for(const text of [original,studio,attack])
  assert(text.indexOf('beard-hood-cutout.js')<text.indexOf('portrait-utils.js') && text.includes('beard-hood-cutout.js'),
    'every portrait entrypoint loads the cutout core before portrait-utils');
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
for(const id of ['paintCanvas','beard','hood','variant','paintMode','eraseMode','rootMode',
  'alphaFloor','maxStretch','removeRoot','clearRoots','download','maskJson'])
  assert(html.includes('id="'+id+'"'),'the mobile 2D author exposes '+id);
assert(!html.includes('three.min.js')&&!html.includes('portrait-spline-rig.js'),
  '2D experiment does not load old 3D rig or Three.js');
assert(html.includes('const [beardArt,hoodArt]=await Promise.all')
  && html.indexOf("beardArt.getContext('2d').getImageData") < html.indexOf("beardCanvas.getContext('2d').drawImage(beardArt"),
  'loaders must validate a disposable canvas before committing origin-clean art into the editor');
assert(html.includes("if(!artReady){status('Brush disabled:")
  && html.includes('beardCanvas.width=hoodCanvas.width=SIZE'),
  'failed art cannot create empty brush history and previously tainted canvases are fully reset');
assert(html.includes('let hoodPixels=new Uint8ClampedArray')
  && !html.includes("hoodCanvas.getContext('2d').getImageData(0,0,SIZE,SIZE).data"),
  'error rendering uses stored hood alpha rather than reading potentially tainted canvases');

const inline=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const loaderSource=inline.match(/  const imageLoadStats=\{fallbacks:0,failures:0\};[\s\S]*?\n  async function loadImage\(url\)\{[\s\S]*?\n  \}/)?.[0];
assert(loaderSource,'the editor exposes one CORS-safe loader and scoped fallback');
const loadFunctions=new Function('Image','location','URL',loaderSource+'\nreturn {loadImage,alternateAssetUrl,imageLoadStats};');
const requests=[];
class SimulatedCdnImage {
  set src(value){
    requests.push({url:value,crossOrigin:this.crossOrigin});
    Promise.resolve().then(()=>value.includes('raw.githubusercontent.com')?this.onload?.():this.onerror?.());
  }
}
const page={
  origin:'https://raw.githack.com',protocol:'https:',href:'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/012345/docs/tools/beard-hood-cutout/index.html',
  pathname:'/Oolnokk/HobunjiHollowUnity/012345/docs/tools/beard-hood-cutout/index.html',
};
const urls=loadFunctions(SimulatedCdnImage,page,URL);
const originalAsset='https://raw.githack.com/Oolnokk/HobunjiHollowUnity/012345/docs/assets/example-beard.png';
urls.loadImage(originalAsset).then(result=>{
  assert(result instanceof SimulatedCdnImage,'fallback resolves the image after primary CDN refusal');
  assert.equal(requests.length,2,'a rejected GitHack image is retried once');
  assert.equal(requests[0].crossOrigin,'anonymous','the FIRST image request sets CORS before assigning src');
  assert.equal(requests[1].crossOrigin,'anonymous','the fallback image request also requires origin-clean pixels');
  assert.equal(requests[1].url,'https://raw.githubusercontent.com/Oolnokk/HobunjiHollowUnity/012345/docs/assets/example-beard.png',
    'fallback uses the exact same commit and repo instead of unrelated images');
  assert.equal(urls.imageLoadStats.fallbacks,1,'mobile debug records a successful alternative');
  console.log('Beard/hood cutout: alpha floor, brush/erase, RLE, inner-ring tuft stretch, no-op inside ring, capped overreach, main layering and CORS fallback pass.');
}).catch(error=>{console.error(error);process.exitCode=1;});
