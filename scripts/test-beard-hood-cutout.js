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
  getContext(_kind,options){
    if (!this.contextInitialized) { this.contextInitialized=true; this.firstContextOptions=options; }
    const canvas=this;
    return {
      globalCompositeOperation:'source-over',
      save(){this._composite=this.globalCompositeOperation;},
      restore(){this.globalCompositeOperation=this._composite;},
      createImageData(w,h){return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)};},
      clearRect(){canvas.pixels.fill(0);},
      putImageData(image){canvas.pixels.set(image.data);},
      getImageData(){canvas.readbacks=(canvas.readbacks||0)+1;return {data:new Uint8ClampedArray(canvas.pixels),width:canvas.width,height:canvas.height};},
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
// Sparse requests can overlap, touch or contain malformed authored runs.
// Every valid requested pixel must still be negotiated exactly once.
{
  const pixels=new Uint8ClampedArray(SIZE*SIZE*4);
  for(const i of [10,11,12,13,14,15,16,17,18,19,20,21])pixels[i*4+3]=255;
  const mask=runs=>({size:SIZE,runs});
  const request=mask([[14,4],[10,5],[-2,4],[39999,3],[18,0]]);
  const whisker=mask([[16,5],[20,2]]);
  const allowed=mask([[11,2]]);
  const cover=mask([[17,2]]);
  const p=Cut.partitionBeardHood(request,allowed,pixels,pixels,whisker,cover,'painted');
  assert.equal(p.requested,12);
  assert.equal(p.approvedPixels,6);
  assert.equal(p.refusedPixels,6);
  assert.equal(p.whiskerWins,4);
  assert.equal(p.topCoverWins,2);
  assert.equal(p.topCoverWhiskers,2);
  assert.deepEqual(Array.from(p.approved.slice(10,22)),[0,1,1,0,0,0,1,0,0,1,1,1]);
  assert.equal(Cut.partitionBeardHood(null,null,pixels,pixels,null,null,'painted').requested,0);
  assert.equal(Cut.partitionBeardHood(null,null,pixels,pixels,null,null,'silhouette').approvedPixels,12);
  assert.equal(Cut.partitionBeardHood(null,mask([]),pixels,pixels,null,null,'silhouette').refusedPixels,12);
}
const beard=new Canvas(),hood=new Canvas();
for(let y=75;y<=85;y++)for(let x=90;x<=115;x++)setPixel(beard,x,y,255);
for(let y=70;y<=90;y++)for(let x=82;x<=122;x++)setPixel(hood,x,y,255);
// Artwork-driven cutouts follow the actual beard alpha, and never inherit
// the uniquely hand-painted Mao'ao Grandbeard whiskers.
const autoSource=new Uint8ClampedArray(SIZE*SIZE*4);
autoSource[at(100,80)*4+3]=241;autoSource[at(101,80)*4+3]=242;
autoSource[at(102,80)*4+3]=255;
const derived=Cut.autoBeardRequestMask(autoSource);
assert.equal(Cut.decodeMask(derived)[at(100,80)],0,'silhouette request ignores semi-transparent fringe below 95%');
assert.equal(Cut.decodeMask(derived)[at(101,80)],1,'silhouette request includes pixels exactly at 95%');
assert.equal(Cut.decodeMask(derived)[at(102,80)],1,'silhouette request includes full-opacity beard pixels');
assert.equal(Cut.countMask(derived),2,'silhouette request is art-limited without unrelated stencil pixels');
const actualAutoBeard=new Canvas(),actualAutoHood=new Canvas();
setPixel(actualAutoBeard,101,80,255);setPixel(actualAutoBeard,115,80,255);
setPixel(actualAutoHood,101,80,255);setPixel(actualAutoHood,115,80,255);
const autoNegotiation=Cut.negotiateBeardHood(actualAutoBeard,actualAutoHood,null,null,{
  requestMode:'silhouette',permissionMode:'all'
});
assert.equal(autoNegotiation.approvedPixels,2,'silhouette-only mode triggers actual hood removal without authored RLE');
assert.equal(autoNegotiation.whiskerWins,0,'silhouette beard never acquires priority whisker paint implicitly');
assert.equal(alpha(actualAutoHood,101,80),0,'silhouette request cuts actual overlapping hood art');
const noAutoBeard=new Canvas(),noAutoHood=new Canvas();
setPixel(noAutoBeard,101,80,255);setPixel(noAutoHood,101,80,255);
assert.equal(Cut.negotiateBeardHood(noAutoBeard,noAutoHood,null,null).applied,false,
  'unconfigured cosmetic without requests remains untouched');

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
// Both artist paint thresholds are near-opaque by default (95% = 242/255).
// Verify exact equality rather than rounding visible percentages.
const nearOpaque=new Uint8ClampedArray(SIZE*SIZE*4);
for(const [x,a] of [[90,240],[91,241],[92,242],[93,243]])nearOpaque[at(x,95)*4+3]=a;
const beard95=Cut.paintMask(null,nearOpaque,91.5,95.5,4,false,null,242);
assert.equal(Cut.decodeMask(beard95)[at(90,95)],0,'beard at 240 alpha is below the 95% floor');
assert.equal(Cut.decodeMask(beard95)[at(91,95)],0,'beard at 241 alpha is below the 95% floor');
assert.equal(Cut.decodeMask(beard95)[at(92,95)],1,'beard at exactly 242 alpha is paintable');
assert.equal(Cut.decodeMask(beard95)[at(93,95)],1,'beard above the 95% floor is paintable');
const hood95=Cut.paintMask(null,nearOpaque,91.5,95.5,4,false,null,242,true);
assert.equal(Cut.decodeMask(hood95)[at(91,95)],0,'hood permission painting excludes faint cloth');
assert.equal(Cut.decodeMask(hood95)[at(92,95)],1,'hood painting accepts the exact 95% boundary');
const fullHood={size:SIZE,runs:[[0,SIZE*SIZE]]};
const protected95=Cut.paintMask(fullHood,nearOpaque,91.5,95.5,4,true,null,242,true);
assert.equal(Cut.decodeMask(protected95)[at(91,95)],1,'protect brush preserves permissions on translucent cloth');
assert.equal(Cut.decodeMask(protected95)[at(92,95)],0,'protect brush revokes permission on qualifying cloth');
const hood70=Cut.paintMask(null,nearOpaque,90.5,95.5,3,false,null,175,true);
assert.equal(Cut.decodeMask(hood70)[at(90,95)],1,'lowering the hood opacity slider restores fringe paintability');
const hoodBrush=new Uint8ClampedArray(SIZE*SIZE*4);
hoodBrush[at(50,50)*4+3]=255; // Only the actual hood pixel is eligible for protect-mode erasing.
const allAllowed={size:SIZE,runs:[[0,SIZE*SIZE]]};
const protectedBrush=Cut.paintMask(allAllowed,hoodBrush,50.5,50.5,2,true,null,8,true);
assert.equal(Cut.decodeMask(protectedBrush)[at(50,50)],0,'protect-mode brush may deny removal on opaque hood cloth');
assert.equal(Cut.decodeMask(protectedBrush)[at(51,50)],1,'protect-mode brush leaves transparent hood coordinates unchanged');
assert.equal(Cut.decodeMask(Cut.paintMask(null,hoodBrush,51.5,50.5,1,false,null,8,true))[at(51,50)],0,
  'allow-mode painting cannot mark transparent hood pixels');
assert.equal(Cut.decodeMask(Cut.paintMask(allAllowed,hoodBrush,51.5,50.5,1,true,null,8,true))[at(51,50)],1,
  'transparent clicks do not convert a hood into a protect-all policy');

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
// Subdivision changes the geometric extent of the influence, not tessellation.
const broad=Cut.planTuftStretch(ringBefore,[{x:140.5,y:94.5}],{subdivision:1});
const local=Cut.planTuftStretch(ringBefore,[{x:140.5,y:94.5}],{subdivision:16});
assert.equal(Cut.normalizeSubdivision(undefined),4,'old cosmetics preserve the original medium-locality setting');
assert.equal(Cut.normalizeSubdivision(99),16,'invalidly high subdivision is clamped');
assert.equal(Cut.normalizeSubdivision(0),1,'lowest subdivision remains broad');
assert(broad.moves[0].radius>local.moves[0].radius,
  'high subdivision reduces the affected neighborhood instead of adding polygons');
const outside={x:140.5,y:114.5};
assert(Cut.deformationWeight(broad.moves[0],outside.x,outside.y)>Cut.deformationWeight(local.moves[0],outside.x,outside.y),
  'broad subdivision moves pixels farther from the tuft root');
for(const plan of [broad,local])
  assert.equal(Cut.deformationWeight(plan.moves[0],140.5,94.5),1,
    'subdivision never changes the target root position');

// Upper and lower influence are independent. The marked pin is always held.
const upperPlan=Cut.planTuftStretch(ringBefore,[{x:140.5,y:94.5}],{
  subdivision:4,aboveInfluence:200,belowInfluence:0
});
const lowerPlan=Cut.planTuftStretch(ringBefore,[{x:140.5,y:94.5}],{
  subdivision:4,aboveInfluence:0,belowInfluence:200
});
const top={x:140.5,y:84.5},bottom={x:140.5,y:104.5};
const upper=upperPlan.moves[0],lower=lowerPlan.moves[0];
assert(Cut.deformationWeight(upper,top.x,top.y)>Cut.deformationWeight(lower,top.x,top.y),
  'higher upper influence moves more cloth ABOVE the tuft');
assert(Cut.deformationWeight(upper,bottom.x,bottom.y)<Cut.deformationWeight(lower,bottom.x,bottom.y),
  'higher lower influence moves more cloth BELOW the tuft independently');
assert.equal(Cut.deformationWeight(upper,140.5,94.5),1,'upper/lower sliders never loosen marked corner');
assert.equal(Cut.deformationWeight(lower,140.5,94.5),1,'even zero on one side still fixes corner');
assert.equal(Cut.normalizeVerticalInfluence(undefined),100,'old cosmetics retain symmetric 100% strength');
assert.equal(Cut.normalizeVerticalInfluence(300),200,'upper/lower strength is bounded at 200%');
assert.equal(Cut.normalizeVerticalInfluence(-3),0,'upper/lower strength may be turned off');
const ringResult=Cut.stretchHoodToRoots(ringHood,roots,{maxStretch:36});
assert.equal(ringResult.stretched,2,'left and right tuft roots both deform the same front hood');
assert.equal(alpha(ringHood,135,94),0,'left/right displacement expands the inner opening');
assert(alpha(ringHood,140,94)>=128,'hood cloth ring stretches exactly to the right tuft root');
assert(alpha(ringHood,60,94)>=128,'hood cloth ring stretches exactly to the left tuft root');
assert.equal(alpha(ringHood,100,94),0,'central face opening remains transparent');
assert.equal(alpha(ringHood,100,35),ringBefore[at(100,35)*4+3],
  'pixels far from both tuft corners retain original cloth');
// An immutable source is reusable for both real warps and no-op stretches.
const ringSource={width:SIZE,height:SIZE,data:ringBefore.slice()};
const sharedWarp=new Canvas();sharedWarp.pixels.set(ringBefore);
const warped=Cut.stretchHoodToRoots(sharedWarp,roots,{maxStretch:36,retainUnchangedImageData:true,pristineHoodImageData:ringSource});
assert.deepEqual(warped,ringResult);
assert.deepEqual(sharedWarp.pixels,ringHood.pixels);
assert.equal(sharedWarp.readbacks||0,0);
assert.deepEqual(ringSource.data,ringBefore,'warping must not mutate cached cloth');
assert.equal(warped.unchangedImageData,undefined,'a real warp must still be reread before negotiation');
const sharedNoMove=new Canvas();sharedNoMove.pixels.set(ringBefore);
const noMoveResult=Cut.stretchHoodToRoots(sharedNoMove,[{x:115,y:94}],{maxStretch:36,retainUnchangedImageData:true,pristineHoodImageData:ringSource});
assert.equal(noMoveResult.unchangedImageData,ringSource);
assert.equal(sharedNoMove.readbacks||0,0);
const noMove=new Canvas();noMove.pixels.set(ringBefore);
const inside=Cut.stretchHoodToRoots(noMove,[{x:115,y:94}],{maxStretch:36,retainUnchangedImageData:true});
assert.equal(inside.insideRing,1,'tuft already inside the ring does not stretch the hood');
assert.equal(inside.stretched,0,'no active deformation for interior tuft');
assert.deepEqual(Array.from(noMove.pixels),Array.from(ringBefore),'inside ring leaves hood exactly unchanged');
assert.deepEqual(inside.unchangedImageData.data,ringBefore,'no-op stretch transfers exact readback');
// Previously the cap acted as a hard gate: e.g. 17px -> no deformation,
 // 18px -> full deformation. It must now move smoothly, even below 1px.
const partialRoot={x:140.5,y:94.5};
const originalPlan=Cut.planTuftStretch(ringBefore,[partialRoot],{maxStretch:64});
const needed=originalPlan.moves[0].requestedLength;
assert(needed>4,'test has a substantial original tuft-to-ring distance');
function stretchedCopy(limit){
  const copy=new Canvas();copy.pixels.set(ringBefore);
  const result=Cut.stretchHoodToRoots(copy,[partialRoot],{maxStretch:limit,retainUnchangedImageData:true});
  if(result.moves.length) assert.equal(result.unchangedImageData,undefined,'real warp must reread the canvas');
  return {copy,result};
}
const none=stretchedCopy(0);
assert.equal(none.result.stretched,0,'0px explicitly disables the deformation');
assert.equal(none.result.limited,1,'disabled root is reported as limited, not silently lost');
assert.deepEqual(Array.from(none.copy.pixels),Array.from(ringBefore),'0px keeps all hood pixels unchanged');
const quarter=stretchedCopy(.25),half=stretchedCopy(.5),onePx=stretchedCopy(1);
for(const [limit,run] of [[.25,quarter],[.5,half],[1,onePx]]){
  assert.equal(run.result.stretched,1,'fractional stretch '+limit+' activates without a hard cutoff');
  assert.equal(run.result.limited,1,'fractional stretch '+limit+' reports partial progress');
  assert(Math.abs(run.result.moves[0].appliedLength-limit)<1e-8,
    'fractional limit '+limit+' applies the exact requested displacement');
}
function alphaDifference(canvas){
  let difference=0,translucent=0;
  for(let i=3;i<canvas.pixels.length;i+=4){
    const a=canvas.pixels[i];difference+=Math.abs(a-ringBefore[i]);
    if(a>0&&a<255)translucent++;
  }
  return {difference,translucent};
}
const quarterDiff=alphaDifference(quarter.copy),halfDiff=alphaDifference(half.copy);
assert(quarterDiff.difference>0,'0.25px stretch visibly changes hood alpha at the edge');
assert(quarterDiff.translucent>0,'subpixel stretch uses fractional silhouette opacity, not nearest-neighbor jumps');
assert(halfDiff.difference>quarterDiff.difference,
  'increasing a partial budget from 0.25px to 0.5px increases visible movement');
const capBefore=stretchedCopy(needed-.25),full=stretchedCopy(needed);
assert.equal(capBefore.result.stretched,1,'stretch is already active just before the full requested length');
assert.equal(full.result.stretched,1,'stretch remains active at the full length');
assert.equal(capBefore.result.limited,1,'before the full length the slider is still limiting');
assert.equal(full.result.limited,0,'at the full length the ring reaches its authored root');
assert(Math.abs(full.result.moves[0].to.x-partialRoot.x)<1e-8,
  'the full budget meets the original tuft marker');
const constrained=stretchedCopy(2);
assert.equal(constrained.result.limited,1,'an undersized cap is a partial movement, not a rejected entire root');
assert.equal(constrained.result.stretched,1,'small caps never trigger a large all-or-nothing jump');
const rootInput=[{x:140,y:94}],rootSnapshot=JSON.stringify(rootInput);
Cut.stretchHoodToRoots(new Canvas(),rootInput);
assert.equal(JSON.stringify(rootInput),rootSnapshot,'root normalization never mutates authored JSON');

// Two-sided beard/hood arbitration: painted removal permissions belong to the
// HOOD; rejected overlaps erase only the beard and require an authored-looking
// black edge on retained non-black pixels.
const sampleBeard=new Canvas(),sampleHood=new Canvas();
for(let x=100;x<=110;x++)setPixel(sampleBeard,x,80,255);
for(let x=100;x<=105;x++)setPixel(sampleHood,x,80,255);
sampleBeard.pixels.set([8,8,8,255],at(108,80)*4); // Pre-existing black line art is preserved.
const requestedBits=new Uint8Array(SIZE*SIZE),allowedBits=new Uint8Array(SIZE*SIZE);
for(let x=100;x<=110;x++)requestedBits[at(x,80)]=1;
for(let x=100;x<=102;x++)allowedBits[at(x,80)]=1;
const requestMask=Cut.encodeMask(requestedBits),permission=Cut.encodeMask(allowedBits);
const originalBeard=new Uint8ClampedArray(sampleBeard.pixels);
const originalHood=new Uint8ClampedArray(sampleHood.pixels);
// Automatic hood permission: detect the lower (inner) opening ring, extend each
// bottom-rim column downward, then fan it outward as the cone slider increases.
const autoZero=Cut.autoHoodAllowanceMask(ringBefore,0);
const autoWide=Cut.autoHoodAllowanceMask(ringBefore,.5);
assert(autoZero.bottomPoints.length>20,'automatic detector finds the lower opening arc');
assert.equal(autoZero.openingSeed.x,100.5,'detection seeds inside the transparent face opening');
const centerRim=autoZero.bottomPoints.find(p=>p.x===100);
assert(centerRim&&centerRim.y>=122&&centerRim.y<=126,
  'center of bottom ring is the INNER opening edge, not the bottom of outer hood fabric');
assert.equal(Cut.decodeMask(autoZero.mask)[at(100,120)],0,'auto permission excludes pixels ABOVE the lower opening');
assert.equal(Cut.decodeMask(autoZero.mask)[at(100,145)],1,'default cone permits straight down from bottom opening');
assert.equal(Cut.decodeMask(autoZero.mask)[at(55,170)],0,'zero cone has no lateral extension');
assert.equal(Cut.decodeMask(autoWide.mask)[at(55,170)],1,'positive cone widening permits pixels farther to the side');
assert(autoWide.allowedPixels>autoZero.allowedPixels,'expanding the cone increases authorized pixel area');
// Lumpy, concave inner rim with a short UPHILL notch. The old independent
// 0..180-degree rays never hit x=116; a single COMPLETE clockwise
// right-to-left contour follows uphill segments before classifying the bottom.
const lumpyHood=new Uint8ClampedArray(SIZE*SIZE*4);
for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
  const dx=x+.5-100.5,dy=y+.5-94.5,angle=Math.atan2(dy,dx);
  const climb=12*Math.exp(-(((angle-1.10)/.13)**2));
  const radius=Math.hypot(dx,dy);
  if(radius>=30-climb&&radius<=62)lumpyHood[at(x,y)*4+3]=255;
}
const rayOnly=new Int16Array(SIZE);
rayOnly.fill(-1);
for(let ray=0;ray<256;ray++){
  const angle=Math.PI*ray/255,sx=Math.cos(angle),sy=Math.sin(angle);
  let previous=-1;
  for(let d=.5;d<=85;d+=.5){
    const x=Math.floor(100.5+sx*d),y=Math.floor(94.5+sy*d);
    if(x<0||x>=SIZE||y<0||y>=SIZE)break;
    const i=at(x,y);
    if(i===previous)continue;
    previous=i;
    if(lumpyHood[i*4+3]<242)continue;
    if(y+1>=94.5&&y>rayOnly[x])rayOnly[x]=y;
    break;
  }
}
const trackedLump=Cut.lowerHoodOpeningSegment(lumpyHood);
const contourX=new Map(trackedLump.points.map(point=>[point.x,point.y]));
assert.equal(rayOnly[116],-1,'old radial-only scanner misses a column beyond the upward climb');
assert.equal(contourX.get(116),117,'complete clockwise contour recovers the obscured lower edge');
assert(trackedLump.clockwiseSteps>60,'clockwise 0->180 trace finishes the full lumpy lower arc');
assert.equal(trackedLump.clockwiseComplete,true,
  'detector only classifies the bottom AFTER the entire clockwise right-to-left path is finished');
assert.equal(trackedLump.edgeFollowed,true,'complete clockwise trace supersedes radial-only pixels');
for(let x=113;x<=119;x++)
  assert(contourX.has(x),'small climb does not prematurely terminate the bottom boundary at x='+x);
assert(trackedLump.clockwiseSteps<=4096,
  'single complete clockwise trace has a bounded visit budget on noisy hoods');
// A ragged hood can have jagged upper cloth intruding into the opening.
// This must NOT be collected as "bottom" merely because a second reverse
// search discovers a shorter path through those top-side fragments.
const raggedWithTop=new Uint8ClampedArray(lumpyHood);
for(let x=85;x<=118;x++)for(let y=69;y<=91;y++){
  if(y>78 || ((x+3*y)%9===0&&y>=70))raggedWithTop[at(x,y)*4+3]=255;
}
const raggedRim=Cut.lowerHoodOpeningSegment(raggedWithTop);
assert(raggedRim.clockwiseComplete,'top-side ragged cloth must not interrupt the lower clockwise contour');
assert.equal(raggedRim.clockwiseSteps,trackedLump.clockwiseSteps,
  'top-side ragged fragments never divert the lower path');
assert.deepEqual(raggedRim.points,trackedLump.points,
  'upper hood pieces cannot contribute false bottom opening segments');
assert(raggedRim.points.every(point=>point.y>=Math.floor(raggedRim.seed.y)),
  'upper opening pixels are not misclassified as the lower rim');
const continued=Cut.autoHoodAllowanceMask(lumpyHood,0);
assert.equal(Cut.decodeMask(continued.mask)[at(116,140)],1,
  'recovered contour column actually contributes to the final removal permission');
const brokenLump=new Uint8ClampedArray(lumpyHood);
for(let y=95;y<SIZE;y++)for(let x=98;x<=103;x++)brokenLump[at(x,y)*4+3]=0;
const splitTrace=Cut.lowerHoodOpeningSegment(brokenLump);
assert(!splitTrace.points.some(p=>p.x>=98&&p.x<=103&&p.y>=95),
  'contour walking never invents a bridge across a truly disconnected missing ring');

const lowerNearLine=Cut.autoHoodAllowanceMask(ringBefore,2.5);
const lowerLine=Cut.autoHoodAllowanceMask(ringBefore,3);
assert(lowerLine.allowedPixels>=lowerNearLine.allowedPixels,
  'widening the lower cone to Line never removes previously allowed pixels');
assert.equal(Cut.decodeMask(lowerLine.mask)[at(0,170)],1,'lower Line includes left portrait edge');
assert.equal(Cut.decodeMask(lowerLine.mask)[at(SIZE-1,170)],1,
  'lower Line includes right portrait edge');
assert.equal(Cut.decodeMask(lowerLine.mask)[at(100,50)],0,
  'lower Line does not reach above the bottom opening');
assert.equal(Cut.normalizeConeSpread(-1),0,'cone widening never goes negative');
assert.equal(Cut.normalizeConeSpread(200),3,'cone widening clamps to the flat-line endpoint');
assert.equal(Cut.normalizeConeSpread(2),2,'existing authored 0–2 widening values remain unchanged');
assert.equal(Cut.normalizeConeSpread(2.5),2.5,'the new post-legacy range remains editable');
assert.equal(Cut.coneExpansion(0,3),0,'a straight line still passes through its cone origin');
assert.equal(Cut.coneExpansion(1,0),0,'zero widening means a vertical column');
assert.equal(Cut.coneExpansion(1,2),2,'old widening has identical numeric slope');
assert.equal(Cut.coneExpansion(1,2.5),4,'expanded opening continues smoothly beyond the old maximum');
assert(Cut.coneExpansion(1,2.975)>Cut.coneExpansion(1,2.5),
  'widening toward the line continuously increases cone reach');
assert.equal(Cut.coneExpansion(1,3),SIZE,'the final setting opens into a horizontal line across the portrait');
const fadedRing=new Uint8ClampedArray(ringBefore);
for(let i=3;i<fadedRing.length;i+=4)if(fadedRing[i])fadedRing[i]=235; // Below 95%, above a lowered 90% threshold.
const ring95=Cut.autoHoodAllowanceMask(fadedRing,0,{alphaLimit:242});
const ring90=Cut.autoHoodAllowanceMask(fadedRing,0,{alphaLimit:230});
assert.equal(ring95.allowedPixels,0,'automatic ring rejects hood pixels below its paintability floor');
assert(ring90.bottomPoints.length>0,'reducing the hood floor restores detectable inner-ring pixels');
// The TOP inner rim is a distinct segment. Its DOWNWARD cover stops at
// the lower rim, so the entire hanging beard cannot become protected.
const upperZero=Cut.autoHoodTopCoverMask(ringBefore,0,{bottomPoints:autoZero.bottomPoints});
const upperWide=Cut.autoHoodTopCoverMask(ringBefore,.4,{bottomPoints:autoZero.bottomPoints});
const topCenter=upperZero.topPoints.find(p=>p.x===100);
assert(topCenter && topCenter.y>=60 && topCenter.y<=67,
  'upper raycast hits the TOP inner rim, not the outer hood silhouette');
assert.equal(upperZero.lowerCap,Math.max(...autoZero.bottomPoints.map(p=>p.y)),
  'upper cone is limited by the detected lower inner-rim segment');
assert.equal(Cut.decodeMask(upperZero.mask)[at(100,80)],1,
  'upper cone protects a whisker root beneath the upper rim even at zero spread');
assert.equal(Cut.decodeMask(upperZero.mask)[at(100,145)],0,
  'upper cone cannot block a lower beard portion beneath the bottom opening');
assert.equal(Cut.decodeMask(upperZero.mask)[at(50,95)],0,
  'zero widening does not spread outside its vertical top rim columns');
assert(upperWide.coverPixels>upperZero.coverPixels,
  'widening the top cone grows the protected upper-hood footprint');
const topDownLine=Cut.autoHoodTopCoverMask(ringBefore,3,{
  bottomPoints:autoZero.bottomPoints,upSpread:0,downLength:20
});
assert.equal(Cut.decodeMask(topDownLine.mask)[at(0,80)],1,
  'downward Line covers far left even when its origin is near the center');
assert.equal(Cut.decodeMask(topDownLine.mask)[at(SIZE-1,80)],1,
  'downward Line covers far right at the same row');
assert.equal(Cut.decodeMask(topDownLine.mask)[at(0,145)],0,
  'downward Line still stops at the configured droop and lower rim');
const upOnly=Cut.autoHoodTopCoverMask(ringBefore,0,{
  bottomPoints:autoZero.bottomPoints,upSpread:0,downLength:0
});
const upWide=Cut.autoHoodTopCoverMask(ringBefore,0,{
  bottomPoints:autoZero.bottomPoints,upSpread:1,downLength:0
});
const downShort=Cut.autoHoodTopCoverMask(ringBefore,0,{
  bottomPoints:autoZero.bottomPoints,upSpread:0,downLength:8
});
const downLong=Cut.autoHoodTopCoverMask(ringBefore,0,{
  bottomPoints:autoZero.bottomPoints,upSpread:0,downLength:20
});
const downWide=Cut.autoHoodTopCoverMask(ringBefore,1,{
  bottomPoints:autoZero.bottomPoints,upSpread:0,downLength:8
});
assert(Cut.decodeMask(upOnly.mask)[at(100,50)]===1,
  'upper cone protects fabric ABOVE the detected overhang');
assert.equal(Cut.decodeMask(upOnly.mask)[at(100,80)],0,
  'downward reach zero covers nothing below the rim');
assert(upWide.coverPixels>upOnly.coverPixels,
  'upper widening expands coverage independently of downward droop length');
const topUpNearLine=Cut.autoHoodTopCoverMask(ringBefore,0,{
  bottomPoints:autoZero.bottomPoints,upSpread:2.5,downLength:0
});
const topUpLine=Cut.autoHoodTopCoverMask(ringBefore,0,{
  bottomPoints:autoZero.bottomPoints,upSpread:3,downLength:0
});
assert(topUpLine.coverPixels>=topUpNearLine.coverPixels,
  'upper cone widening toward a horizontal line never shrinks coverage');
assert.equal(Cut.decodeMask(topUpLine.mask)[at(0,50)],1,
  'upward Line covers left portrait edge');
assert.equal(Cut.decodeMask(topUpLine.mask)[at(SIZE-1,50)],1,
  'upward Line covers right portrait edge');
assert.equal(Cut.decodeMask(topUpLine.mask)[at(100,130)],0,
  'upward Line with zero downward depth does not touch lower beard');
assert(downShort.coverPixels>upOnly.coverPixels,
  'positive downward length adds a lower protection cone');
assert.equal(Cut.decodeMask(downShort.mask)[at(100,80)],0,
  'whisker root 17 pixels below rim is unaffected by an 8px downward length');
assert.equal(Cut.decodeMask(downLong.mask)[at(100,80)],1,
  'whisker root becomes protected when downward length reaches it');
assert(downWide.coverPixels>downShort.coverPixels,
  'changing downward widening affects lower cone with fixed upper geometry');
assert.equal(Cut.decodeMask(downLong.mask)[at(100,145)],0,
  'even a long downward cone is hard-capped by the lower inner rim');
assert.equal(Cut.normalizeCoverLength(-20),0,'negative downward length clamps to zero');
assert.equal(Cut.normalizeCoverLength(400),200,'downward length cannot exceed portrait size');
assert.equal(Cut.normalizeCoverLength(undefined),200,
  'legacy upper cone setting preserves full-to-lower-rim downward reach');
assert.equal(Cut.autoHoodTopCoverMask(new Uint8ClampedArray(SIZE*SIZE*4),1).coverPixels,0,
  'missing opening does not invent an upper protection region');
const fadedTop=Cut.autoHoodTopCoverMask(fadedRing,.3,{alphaLimit:242});
const acceptedTop=Cut.autoHoodTopCoverMask(fadedRing,.3,{alphaLimit:230});
assert.equal(fadedTop.coverPixels,0,'upper detector obeys the 95% hood alpha threshold');
assert(acceptedTop.topPoints.length>0,'lowering the hood opacity floor restores upper-rim detection');

const topBeard=new Canvas(),topHood=new Canvas();
topHood.pixels.set(ringBefore);
for(const [x,y] of [[100,80],[100,145]]){
  setPixel(topBeard,x,y,255);setPixel(topHood,x,y,255);
}
const topWhiskers=new Uint8Array(SIZE*SIZE);
topWhiskers[at(100,80)]=topWhiskers[at(100,145)]=1;
const topFight=Cut.negotiateBeardHood(topBeard,topHood,null,{size:SIZE,runs:[]},{
  permissionMode:'painted',whiskerMask:Cut.encodeMask(topWhiskers),
  topConeSpread:0,topCover:upperZero,includeMasks:true
});
assert.equal(topFight.topCoverWins,1,'upper cover beats exactly the whisker near its root');
assert.equal(topFight.topCoverWhiskers,1,'upper-cover whisker override is counted explicitly');
assert.equal(topFight.whiskerWins,1,'whisker below upper cover still defeats normal hood protection');
assert.equal(alpha(topBeard,100,80),0,'upper root whisker is erased under drooping hood cloth');
assert.equal(alpha(topHood,100,80),255,'upper hood is left intact where it overrules whiskers');
assert.equal(alpha(topHood,100,145),0,'lower whisker still removes normally protected hood');
const shortBeard=new Canvas(),shortHood=new Canvas();
shortHood.pixels.set(ringBefore); // Runtime must actually see the hood's opening ring to generate both cone directions.
for(const y of [50,80]){
  setPixel(shortBeard,100,y,255);setPixel(shortHood,100,y,255);
}
const bothWhiskers=new Uint8Array(SIZE*SIZE);
for(const y of [50,80])bothWhiskers[at(100,y)]=1;
const split=Cut.negotiateBeardHood(shortBeard,shortHood,null,{size:SIZE,runs:[]},{
  permissionMode:'painted',whiskerMask:Cut.encodeMask(bothWhiskers),
  topConeSpread:0,topUpConeSpread:0,topDownConeLength:8,
  topCover:downShort, // Freeze the real opening before the synthetic conflict pixel is added inside its transparent center.
  includeMasks:true
});
assert.equal(split.topCoverWhiskers,1,
  'upward overhang protects a whisker while downward droop is limited');
assert.equal(split.whiskerWins,1,
  'whisker just below short downward cover can still cut protected hood');
assert.equal(alpha(shortBeard,100,50),0,'upward cover erases whisker beneath upper cloth');
assert.equal(alpha(shortBeard,100,80),255,'whisker past downward length survives');
assert.equal(alpha(shortHood,100,80),0,'past the downward length, whisker still opens the hood');
// Exercise the renderer's uncached path with intact real hood-ring pixels.
const uncachedBeard=new Canvas(),uncachedHood=new Canvas();
uncachedHood.pixels.set(ringBefore);
for(const y of [50,130])setPixel(uncachedBeard,100,y,255);
const uncachedWhiskers=new Uint8Array(SIZE*SIZE);
uncachedWhiskers[at(100,50)]=uncachedWhiskers[at(100,130)]=1;
const directRender=Cut.negotiateBeardHood(uncachedBeard,uncachedHood,null,{size:SIZE,runs:[]},{
  whiskerMask:Cut.encodeMask(uncachedWhiskers),permissionMode:'painted',
  topConeSpread:0,topUpConeSpread:.6,topDownConeLength:4
});
assert.equal(directRender.topCoverWhiskers,1,
  'live renderer detects the upper rim and protects whisker above it without a cached mask');
assert.equal(directRender.whiskerWins,1,
  'live renderer still permits whisker beneath the lower rim');
assert.equal(alpha(uncachedBeard,100,50),0,
  'uncached bidirectional protection erases the upper whisker');
assert.equal(alpha(uncachedHood,100,50),255,
  'uncached protected hood remains intact');
assert.equal(alpha(uncachedHood,100,130),0,
  'uncached lower whisker still cuts through otherwise protected hood');
assert.equal(Cut.decodeMask(topFight.refusedMask)[at(100,80)],1,'upper protected whisker is visibly refused');
assert.equal(Cut.decodeMask(topFight.topCoverMask)[at(100,145)],0,'top cover preview excludes lower beard');
// Null option is backward compatible: existing hoods still let priority whiskers win.
const legacyWhiskerBeard=new Canvas(),legacyWhiskerHood=new Canvas();
setPixel(legacyWhiskerBeard,100,80,255);setPixel(legacyWhiskerHood,100,80,255);
const oldWhisker=Cut.negotiateBeardHood(legacyWhiskerBeard,legacyWhiskerHood,null,{size:SIZE,runs:[]},{
  whiskerMask:Cut.encodeMask(topWhiskers)
});
assert.equal(oldWhisker.whiskerWins,1,'unconfigured hood retains prior whisker priority');
assert.equal(oldWhisker.topCoverWins,0,'no implicit upper cover on legacy hood');
const missingRing=Cut.autoHoodAllowanceMask(new Uint8ClampedArray(SIZE*SIZE*4),.5);
assert.equal(missingRing.allowedPixels,0,'no detectable hood inner rim does not accidentally allow all');

const autoBeard=new Canvas(),autoHood=new Canvas();
autoHood.pixels.set(ringBefore);
setPixel(autoBeard,100,140,255);setPixel(autoBeard,65,140,255);
setPixel(autoHood,100,140,255);setPixel(autoHood,65,140,255); // Separate opaque cloth patches exercise the actual conflict arbitration.
const autoRequests=new Uint8Array(SIZE*SIZE);
autoRequests[at(100,140)]=autoRequests[at(65,140)]=1;
const automaticCut=Cut.negotiateBeardHood(autoBeard,autoHood,Cut.encodeMask(autoRequests),null,{
  permissionMode:'auto',coneSpread:0
});
assert.equal(automaticCut.approvedPixels,1,'automatic lower-opening permission wins beneath the inner rim');
assert.equal(automaticCut.refusedPixels,1,'ordinary beard outside the cone loses to the hood');
assert.equal(alpha(autoBeard,65,140),0,'automatic refusal erases the losing beard pixel');
assert.equal(alpha(autoHood,100,140),0,'automatic approval removes hood cloth only at requested overlap');

// Priority whiskers are an independent painted mask, not contingent on normal
// cutout requests. They defeat protected hood areas without erasing themselves.
const whiskerBits=new Uint8Array(SIZE*SIZE);whiskerBits[at(104,80)]=1;
const winBeard=new Canvas(),winHood=new Canvas();
winBeard.pixels.set(originalBeard);winHood.pixels.set(originalHood);
const win=Cut.negotiateBeardHood(winBeard,winHood,requestMask,permission,{
  whiskerMask:Cut.encodeMask(whiskerBits),includeMasks:true
});
assert.equal(win.whiskerWins,1,'whisker paint defeats one explicitly protected hood pixel');
assert.equal(win.approvedPixels,4,'winning whisker overrides the ordinary refusal');
assert.equal(win.refusedPixels,2,'other protected beard requests still lose');
assert.equal(alpha(winHood,104,80),0,'whisker removes protected hood cloth');
assert.equal(alpha(winBeard,104,80),255,'priority whisker itself survives');
const whiskerOnlyBeard=new Canvas(),whiskerOnlyHood=new Canvas();
whiskerOnlyBeard.pixels.set(originalBeard);whiskerOnlyHood.pixels.set(originalHood);
const whiskerOnly=Cut.negotiateBeardHood(whiskerOnlyBeard,whiskerOnlyHood,null,{size:SIZE,runs:[]},{
  whiskerMask:Cut.encodeMask(whiskerBits)
});
assert.equal(whiskerOnly.approvedPixels,1,'whiskers work with no ordinary cutout mask');
assert.equal(whiskerOnly.whiskerWins,1,'whisker override is counted independently');


const approved=Cut.negotiateBeardHood(sampleBeard,sampleHood,requestMask,permission,{includeMasks:true});
// Cached pristine beard pixels are read-only, even when the hood refuses
// a request and the surviving beard must receive a new inward black edge.
const cachedBeardCanvas=new Canvas(),cachedHoodCanvas=new Canvas();
cachedBeardCanvas.pixels.set(originalBeard); cachedHoodCanvas.pixels.set(originalHood);
const pristine=cachedBeardCanvas.getContext().getImageData();
let beardReadbacks=0;
const originalContext=cachedBeardCanvas.getContext.bind(cachedBeardCanvas);
cachedBeardCanvas.getContext=()=>{
  const ctx=originalContext();
  ctx.getImageData=()=>{beardReadbacks++;throw Error('cached beard unexpectedly read');};
  return ctx;
};
const cachedNegotiation=Cut.negotiateBeardHood(cachedBeardCanvas,cachedHoodCanvas,requestMask,permission,
  {includeMasks:true,beardImageData:pristine});
assert.equal(beardReadbacks,0);
assert.deepEqual(cachedNegotiation,approved);
assert.deepEqual(cachedBeardCanvas.pixels,sampleBeard.pixels);
assert.deepEqual(cachedHoodCanvas.pixels,sampleHood.pixels);
assert.deepEqual(pristine.data,originalBeard,'cached input survives rejected pixels and outlines unchanged');
// Readback transferred from an unchanged hood: parity even with refused edges.
const transferredBeard=new Canvas(),transferredHood=new Canvas();
transferredBeard.pixels.set(originalBeard);transferredHood.pixels.set(originalHood);
const hoodRead=transferredHood.getContext().getImageData();
const hoodContext=transferredHood.getContext.bind(transferredHood);
let hoodReads=0;
transferredHood.getContext=()=>{const ctx=hoodContext();ctx.getImageData=()=>{hoodReads++;throw Error('unexpected hood read');};return ctx;};
const transferred=Cut.negotiateBeardHood(transferredBeard,transferredHood,requestMask,permission,{includeMasks:true,beardImageData:pristine,unchangedHoodImageData:hoodRead});
assert.equal(hoodReads,0);
const sharedHood={width:SIZE,height:SIZE,data:originalHood.slice()};
for(const allow of [permission,null,{size:SIZE,runs:[]}]){
  const b=new Canvas(),h=new Canvas(),expectedB=new Canvas(),expectedH=new Canvas();
  b.pixels.set(originalBeard);expectedB.pixels.set(originalBeard);
  h.pixels.set(originalHood);expectedH.pixels.set(originalHood);
  const expected=Cut.negotiateBeardHood(expectedB,expectedH,requestMask,allow,{includeMasks:true});
  const actual=Cut.negotiateBeardHood(b,h,requestMask,allow,{includeMasks:true,pristineHoodImageData:sharedHood});
  assert.deepEqual(actual,expected);
  assert.deepEqual(h.pixels,expectedH.pixels);
  assert.deepEqual(b.pixels,expectedB.pixels);
  assert.equal(h.readbacks||0,0);
  assert.deepEqual(sharedHood.data,originalHood,'shared cloth stays pristine after every permission mode');
}

assert.deepEqual(transferred,approved);
assert.deepEqual(transferredHood.pixels,sampleHood.pixels);
assert.deepEqual(transferredBeard.pixels,sampleBeard.pixels);
assert.equal(approved.requested,6,'only beard pixels under actual opaque hood need arbitration');
assert.equal(approved.approvedPixels,3,'hood author allows three removal pixels');
assert.equal(approved.refusedPixels,3,'hood author protects three conflict pixels');
assert.equal(approved.erasedPixels,3,'rejected beard pixels become transparent, not black');
assert(approved.outlinedPixels>=1,'surviving non-black beard pixels acquire black edge where trimmed');
for(let x=100;x<=102;x++)assert.equal(alpha(sampleHood,x,80),0,'approved hood pixel is removed');
for(let x=103;x<=105;x++){
  assert.equal(alpha(sampleHood,x,80),255,'protected hood pixel remains opaque');
  assert.equal(alpha(sampleBeard,x,80),0,'refused beard pixel really disappears');
}
assert.equal(alpha(sampleBeard,106,80),255,'non-conflicting adjacent beard pixel survives');
assert.deepEqual(Array.from(sampleBeard.pixels.slice(at(106,80)*4,at(106,80)*4+3)),
  [0,0,0],'first surviving beard pixel gains a true black inset edge');
assert.deepEqual(Array.from(sampleBeard.pixels.slice(at(109,80)*4,at(109,80)*4+3)),
  [88,66,44],'beard pigment far from a refusal remains unchanged');
assert.deepEqual(Array.from(sampleBeard.pixels.slice(at(108,80)*4,at(108,80)*4+4)),
  [8,8,8,255],'pre-existing black authored beard lines are not repainted');
assert.equal(Cut.decodeMask(approved.approvedMask)[at(101,80)],1,'approved mask matches real hood holes');
assert.equal(Cut.decodeMask(approved.refusedMask)[at(104,80)],1,'refused mask matches beard erasures');
assert.equal(Cut.decodeMask(approved.refusedMask)[at(109,80)],0,
  'requested beard outside actual hood remains untouched');
const permissiveBeard=new Canvas(),permissiveHood=new Canvas();
permissiveBeard.pixels.set(originalBeard);permissiveHood.pixels.set(originalHood);
const legacy=Cut.negotiateBeardHood(permissiveBeard,permissiveHood,requestMask,null);
assert.equal(legacy.approvedPixels,6,'hoods without authored permissions retain legacy cutout behavior');
assert.equal(legacy.refusedPixels,0,'legacy permission does not erase beard pixels');
assert.deepEqual(Array.from(permissiveBeard.pixels),Array.from(originalBeard),
  'permissive hoods never clip or re-outline beards');
const blockedBeard=new Canvas(),blockedHood=new Canvas();
blockedBeard.pixels.set(originalBeard);blockedHood.pixels.set(originalHood);
const protectedAll=Cut.negotiateBeardHood(blockedBeard,blockedHood,requestMask,{size:SIZE,runs:[]});
assert.equal(protectedAll.approvedPixels,0,'explicit EMPTY mask makes all hood pixels non-removable');
assert.equal(protectedAll.refusedPixels,6,'protect-all trims every competing beard request pixel');
assert.deepEqual(Array.from(blockedHood.pixels),Array.from(originalHood),
  'protect-all never damages opaque hood cloth');
const absentHood=new Canvas(),unopposedBeard=new Canvas();
unopposedBeard.pixels.set(originalBeard);
const absence=Cut.negotiateBeardHood(unopposedBeard,absentHood,requestMask,{size:SIZE,runs:[]});
assert.equal(absence.requested,0,'transparent hood regions cannot refuse beard');
assert.deepEqual(Array.from(unopposedBeard.pixels),Array.from(originalBeard),
  'absence of front hood pixels never erases beards');
// The existing tuft warp must move permission along with hood cloth.
const pinMask=new Uint8Array(SIZE*SIZE);
pinMask[at(110,100)]=1;
const anchorMove={to:{x:112.5,y:100.5},delta:{x:2,y:0},radius:25,
  aboveInfluence:100,belowInfluence:100};
const fittedPermission=Cut.deformHoodPermissionMask(Cut.encodeMask(pinMask),[anchorMove]);
assert.equal(Cut.decodeMask(fittedPermission)[at(112,100)],1,
  'painted removable zone follows the stretched hood rather than remaining at the old coordinate');
assert.equal(Cut.deformHoodPermissionMask(null,[anchorMove]),null,
  'unconfigured hoods remain fully removable after deformation');
assert.equal(Cut.countMask(Cut.deformHoodPermissionMask({size:SIZE,runs:[]},[anchorMove])),0,
  'protect-all hood masks remain empty even during corner deformation');
assert.equal(Cut.countMask(Cut.deformHoodPermissionMask(allAllowed,[anchorMove])),SIZE*SIZE,
  'explicit full-permission masks remain fully allowed during stretching');

const portrait=fs.readFileSync('docs/js/portrait-utils.js','utf8');
// Execute the actual renderer negotiation block and actual bounded cache
// helpers against the same synthetic pixels. This covers cross-portrait hits,
// logical size edits, tinted source replacement, animations and editor bypass.
const pixelCacheSource=portrait.slice(portrait.indexOf('class PortraitPixelCache'),portrait.indexOf('const IMG_CACHE'));
const negotiationCacheSource=portrait.slice(portrait.indexOf('const _BEARD_HOOD_RESULT_CACHE'),portrait.indexOf('window.__portraitPixelCacheDebug'));
const negotiationBlock=portrait.slice(portrait.indexOf('  const cutoutApi = window.PortraitBeardHoodCutout;'),portrait.indexOf('  const drawNegotiatedBeard'));
assert(negotiationBlock.includes('negotiateBeardHood'));
class TestImage extends Canvas {
  constructor(url,pixels){super();this.currentSrc=url;this.complete=true;this.naturalWidth=this.width;this.naturalHeight=this.height;this.pixels.set(pixels);}
}
const buildCacheFixture=new Function('Canvas','Image','Cut',`
  let PORTRAIT_CW=200,PORTRAIT_CH=200,PORTRAIT_L=80;
  const window={PortraitBeardHoodCutout:Cut};
  const document={createElement:()=>new Canvas()};
  const _imageForTint=(image,key,tint)=>tint?.image||image;
  const getPortraitTintingConfig=()=>({cacheEnabled:true});
  ${pixelCacheSource}
  ${negotiationCacheSource}
  function render(config){
    PORTRAIT_L=config.layerSize??80;
    const canvas=new Canvas(),facialHair={},hood={},resolvedFighter={};
    const renderOptions=config.renderOptions||{};
    const facialHairLayers=[{layer:{url:'beard',pixelDye:config.pixelDye},tint:config.tint}];
    const hoodLayers=[{layer:{url:'hood'}}];
    const imgMap=new Map([['beard',config.beard],['hood',config.hood]]);
    const resolveBeardHoodAuthoring=()=>({mask:config.request,roots:config.roots||[],requestMode:null});
    const resolveHoodBeardPolicy=()=>({mode:'painted',mask:config.permission});
    const hiddenCosmeticGroups=new Set();
    const resolveXform=()=>({ax:0,ay:0,sx:config.sx??1,sy:1});
    const imageForTint=config.customTint||_imageForTint;
    const layerImageOverrides=config.imageOverrides||null;
    const staticDeform=config.staticDeform??null,emoteDeformedPts=config.emote?[[0,0]]:null;
    const speciesId='test',gender='male',nowMs=1,breathingPhaseOffset=0,seatId='npc';
    const breathingComposer=window.portraitBreathingComposer={
      getInterpolatedPoints:()=>config.animated?[[0,0]]:null,
      getAnimData:()=>({gridCols:4,gridRows:6})
    };
    function drawEmoteLayers(layers,ctx,prepared){
      for(const entry of layers)ctx.drawImage(prepared?.get(entry)?.image||imageForTint(imgMap.get(entry.layer.url),entry.layer.url,entry.tint));
    }
    function drawBreathingLayers(layers,ctx,preparedBreathing,prepared){
      drawEmoteLayers(layers,ctx,prepared);
      if(preparedBreathing?.points)ctx.putImageData({data:new Uint8ClampedArray(200*200*4)});
    }
    ${negotiationBlock}
    return {beard:negotiatedBeard,hood:negotiatedHood,stats:negotiation,error:negotiationError};
  }
  return {render,snapshot:()=>({..._beardHoodPerf,result:_BEARD_HOOD_RESULT_CACHE.snapshot(),source:_BEARD_HOOD_SOURCE_CACHE.snapshot(),cloth:_BEARD_HOOD_CLOTH_CACHE.snapshot()})};
`)(Canvas,TestImage,Cut);
const fixtureConfig={beard:new TestImage('beard.png',originalBeard),hood:new TestImage('hood.png',originalHood),request:requestMask,permission};
const firstResult=buildCacheFixture.render(fixtureConfig);
assert(!firstResult.error);
assert.deepEqual(firstResult.beard.pixels,sampleBeard.pixels);
assert.deepEqual(firstResult.hood.pixels,sampleHood.pixels);
assert.equal(firstResult.beard.firstContextOptions.willReadFrequently,true,'CPU context selected on first acquisition');
assert.equal(firstResult.hood.firstContextOptions.willReadFrequently,true);
const firstBeardPixels=firstResult.beard.pixels.slice(),firstHoodPixels=firstResult.hood.pixels.slice();
firstResult.stats.approvedPixels=-1; // Debug snapshot must not mutate the shared stats.
const secondResult=buildCacheFixture.render(fixtureConfig);
assert.equal(secondResult.beard,firstResult.beard,'exact still result reused across independent portrait targets');
assert.equal(secondResult.hood,firstResult.hood);
assert.equal(secondResult.stats.approvedPixels,approved.approvedPixels);
assert.equal(buildCacheFixture.snapshot().hits,1);
const animated=buildCacheFixture.render({...fixtureConfig,animated:true});
assert.notEqual(animated.hood,firstResult.hood,'animated cloth cannot reuse a still result');
assert.equal(animated.beard.readbacks||0,0,'animated hood still reuses pristine beard readback');
assert.deepEqual(firstResult.beard.pixels,firstBeardPixels);
assert.deepEqual(firstResult.hood.pixels,firstHoodPixels);
const differentPolicy=buildCacheFixture.render({...fixtureConfig,permission:{size:SIZE,runs:[]}});
assert.equal(differentPolicy.stats.approvedPixels,0,'new policy renegotiates rather than reusing old holes');
assert.notEqual(differentPolicy.hood,firstResult.hood);
assert.equal(differentPolicy.hood.readbacks||0,0,'policy change reuses the pristine hood pixels');
const otherBeard=new TestImage('other-beard.png',originalBeard);
const otherResult=buildCacheFixture.render({...fixtureConfig,beard:otherBeard});
assert.equal(otherResult.hood.readbacks||0,0,'different beard reuses the same hood readback');
assert.deepEqual(otherResult.hood.pixels,firstHoodPixels,'previous cutout holes cannot leak into another result');
assert.equal(buildCacheFixture.snapshot().clothReads,1);
assert.equal(buildCacheFixture.snapshot().clothReadHits,2);
assert.equal(animated.hood.readbacks,1,'animated cloth still reads current pixels');
const changedCloth=buildCacheFixture.render({...fixtureConfig,hood:new TestImage('hood.png',originalHood)});
assert.equal(changedCloth.hood.readbacks,1,'replacement image identity invalidates cloth readback');
assert.equal(buildCacheFixture.render({...fixtureConfig,staticDeform:[[1,0]]}).hood.readbacks,1,'static deformation changes invalidate cloth readback');
assert.notEqual(buildCacheFixture.render({...fixtureConfig,layerSize:90}).hood,firstResult.hood,'logical layer-size edits invalidate the cache');
const tintedImage=new Canvas(); tintedImage.pixels.set(originalBeard); tintedImage.pixels[at(110,80)*4]=17;
const tinted=buildCacheFixture.render({...fixtureConfig,tint:{image:tintedImage}});
assert.equal(tinted.beard.pixels[at(110,80)*4],17,'new tint uses the exact resolved art');
assert.notEqual(tinted.beard,firstResult.beard);
assert.notEqual(buildCacheFixture.render({...fixtureConfig,customTint:image=>image}).hood,firstResult.hood,'custom editor tint bypasses shared cache');
assert.notEqual(buildCacheFixture.render({...fixtureConfig,renderOptions:{beardHoodCutoutMaskOverride:requestMask}}).hood,firstResult.hood,'editor mask override bypasses the result cache');
assert.notEqual(buildCacheFixture.render({...fixtureConfig,pixelDye:true}).hood,firstResult.hood,'pixel-dye side effects cannot be cached away');
for(let n=0;n<40;n++)buildCacheFixture.render({...fixtureConfig,layerSize:100+n});
const cacheStats=buildCacheFixture.snapshot();
assert(cacheStats.result.estimatedBytes<=cacheStats.result.budgetBytes);
assert(cacheStats.source.estimatedBytes<=cacheStats.source.budgetBytes);
assert(cacheStats.cloth.estimatedBytes<=cacheStats.cloth.budgetBytes);
assert(cacheStats.cloth.evictions>0,'pristine cloth cache remains bounded');
assert(cacheStats.result.evictions>0&&cacheStats.source.evictions>0,'both caches remain bounded');
assert.deepEqual(firstResult.beard.pixels,firstBeardPixels,'eviction does not mutate pixels still referenced by a caller');

// Exercise the actual cosmetic policy resolver, not just its string markers.
const policySource=portrait.slice(portrait.indexOf('function resolveHoodBeardPolicy('),
  portrait.indexOf('\nfunction portraitOptionFromJson(',portrait.indexOf('function resolveHoodBeardPolicy(')));
const policyResolver=new Function('window','portraitVariantKeysForFighter',
  policySource+';return resolveHoodBeardPolicy;')(
    {PortraitBeardHoodCutout:Cut},()=>['mao-ao_male']);
assert.equal(policyResolver({},null).mode,'auto','unconfigured hoods automatically derive a lower opening cone');
assert.equal(policyResolver({},null).alphaFloor,242,'unconfigured hoods use the 95% paint/ring threshold');
assert.equal(policyResolver({},null).topConeSpread,null,
  'unconfigured hood does not silently override existing whiskers');
assert.equal(policyResolver({beardCutoutTopConeSpread:0},null).topConeSpread,0,
  'authored zero still enables the narrow upper cover');
assert.equal(policyResolver({},null).topUpConeSpread,0,
  'upward widening defaults to straight vertical columns');
assert.equal(policyResolver({},null).topDownConeLength,200,
  'missing downward length keeps old full-to-bottom-ring coverage');
assert.equal(policyResolver({beardCutoutPaintAlphaFloor:191},null).alphaFloor,191,
  'a previously authored hood alpha value is not overwritten by the new default');
assert.equal(policyResolver({beardCutoutAllowedMask:permission},null).mode,'painted',
  'existing authored hood masks keep their manual policy by default');
assert.equal(policyResolver({beardCutoutPermissionMode:'all',
  beardCutoutAllowedMask:permission},null).mode,'all',
  'explicit allow-all defeats inherited restrictions');
const overridePolicy=policyResolver({
  beardCutoutPermissionMode:'painted',beardCutoutAllowedMask:permission,
  beardCutoutConeSpread:.5,
  variantBeardCutoutPermissionMode:{'mao-ao_male':'auto'},
  variantBeardCutoutConeSpread:{'mao-ao_male':1.25},
  beardCutoutTopConeSpread:.5,
  variantBeardCutoutTopConeSpread:{'mao-ao_male':1.5},
  beardCutoutTopUpConeSpread:.2,
  variantBeardCutoutTopUpConeSpread:{'mao-ao_male':.6},
  beardCutoutTopDownConeLength:90,
  variantBeardCutoutTopDownConeLength:{'mao-ao_male':14},
  beardCutoutPaintAlphaFloor:242,
  variantBeardCutoutPaintAlphaFloor:{'mao-ao_male':250},
}, {speciesId:'mao-ao',gender:'male'});
assert.equal(overridePolicy.mode,'auto','exact species variant can switch shared painted hood back to automatic');
assert.equal(overridePolicy.coneSpread,1.25,'variant-specific cone spread wins over shared hood value');
assert.equal(overridePolicy.alphaFloor,250,'species-variant hood alpha overrides the shared opacity floor');
assert.equal(overridePolicy.topConeSpread,1.5,
  'species variant upper cover spread overrides the shared cone');
assert.equal(overridePolicy.topUpConeSpread,.6,
  'species variant upward cone widening overrides shared value');
assert.equal(overridePolicy.topDownConeLength,14,
  'species variant downward length overrides shared droop depth');
const disabledInheritedTop=policyResolver({
  beardCutoutTopConeSpread:1,
  variantBeardCutoutTopConeSpread:{'mao-ao_male':null}
}, {speciesId:'mao-ao',gender:'male'});
assert.equal(disabledInheritedTop.topConeSpread,null,
  'explicit null in variant disables an inherited upper cover');

const beardSource=portrait.slice(portrait.indexOf('function resolveBeardHoodAuthoring('),
  portrait.indexOf('\nfunction resolveHoodBeardPolicy(',portrait.indexOf('function resolveBeardHoodAuthoring(')));
const beardResolver=new Function('window','portraitVariantKeysForFighter',
  beardSource+';return resolveBeardHoodAuthoring;')(
    {PortraitBeardHoodCutout:Cut},()=>['mao-ao_male']);
const variantWhisker=Cut.encodeMask(whiskerBits);
const resolvedBeard=beardResolver({layers:[{}],hoodCutoutMask:requestMask,
  variantHoodWhiskerMasks:{'mao-ao_male':variantWhisker}},
  {speciesId:'mao-ao',gender:'male'});
assert.equal(Cut.decodeMask(resolvedBeard.whiskers)[at(104,80)],1,
  'shared beard art may author a species-only priority whisker layer');

const silhouetteBeard=beardResolver({layers:[{}],hoodCutoutRequestMode:'silhouette'},null);
assert.equal(silhouetteBeard.requestMode,'silhouette',
  'beard renderer recognizes silhouette-based cutout requests without an RLE mask');
const paintedOverride=beardResolver({
  layers:[{}],hoodCutoutRequestMode:'silhouette',
  variantHoodCutoutRequestModes:{'mao-ao_male':'painted'}
}, {speciesId:'mao-ao',gender:'male'});
assert.equal(paintedOverride.requestMode,'painted',
  'manually painted variant may opt out of inherited automatic requests');

const cosmeticIndex=JSON.parse(fs.readFileSync('docs/config/cosmetics/index.json','utf8')).entries;
const beardPaths=[...new Set(cosmeticIndex.filter(e=>/beard/i.test(e.id+' '+e.path))
  .map(e=>'docs/config/cosmetics/'+e.path.replace(/^\.\//,'')))];
const hoodPaths=[...new Set(cosmeticIndex.filter(e=>/hood/i.test(e.id+' '+e.path))
  .map(e=>'docs/config/cosmetics/'+e.path.replace(/^\.\//,'')))];
assert.equal(beardPaths.length,10,'every distinct beard in the indexed cosmetics is covered');
assert.equal(hoodPaths.length,6,'every indexed active hood uses one shared preset per cosmetic');
const readCosmetic=path=>JSON.parse(fs.readFileSync(path,'utf8'));
const grandPath='docs/config/cosmetics/appearance/mao-ao/grandbeard.json';
const paintedGrandBeards={
  'docs/config/cosmetics/appearance/kenkari/grandbeard.json':
    {runs:120,pixels:3940,alpha:1,subdivision:4,first:[18259,1],last:[34513,2]},
  'docs/config/cosmetics/appearance/mashtzarr-m/grandbeard.json':
    {runs:123,pixels:5697,alpha:242,subdivision:14,first:[20089,5],last:[39725,1]}
}; // Dedicated imported authoring for these two Grand Beards; all other beards keep their own silhouette.
for(const path of beardPaths){
  const doc=readCosmetic(path),custom=paintedGrandBeards[path];
  assert.deepEqual(doc.hoodTuftRoots,[],'beard uses reference zero tuft roots: '+path);
  assert.equal(doc.hoodTuftMaxStretch,36,'reference stretch budget: '+path);
  assert.equal(doc.hoodTuftSubdivision,custom?.subdivision??4,'authored beard subdivision: '+path);
  assert.equal(doc.hoodTuftAboveInfluence,100,'upper influence: '+path);
  assert.equal(doc.hoodTuftBelowInfluence,100,'lower influence: '+path);
  if(path===grandPath){
    assert.equal(doc.hoodCutoutMask?.runs.length,139,'Grandbeard retains the complete hand-painted request');
    assert.equal(doc.hoodWhiskerMask?.runs.length,89,'only Grandbeard gets the painted whisker layer');
    assert.equal(Cut.countMask(doc.hoodCutoutMask),4087,'Grandbeard request pixel count matches supplied authoring');
    assert.equal(Cut.countMask(doc.hoodWhiskerMask),1560,'Grandbeard whisker pixel count matches supplied authoring');
  }else if(custom){
    assert.equal(doc.hoodCutoutRequestMode,'painted','the provided beard request is painted: '+path);
    assert.equal(doc.hoodCutoutMask?.size,200,'200px request resolution: '+path);
    assert.equal(doc.hoodCutoutMask?.runs.length,custom.runs,'complete painted RLE: '+path);
    assert.equal(Cut.countMask(doc.hoodCutoutMask),custom.pixels,'complete painted pixel count: '+path);
    assert.deepEqual(doc.hoodCutoutMask.runs[0],custom.first,'first authored run: '+path);
    assert.deepEqual(doc.hoodCutoutMask.runs.at(-1),custom.last,'last authored run: '+path);
    assert.equal(doc.beardPaintAlphaFloor,custom.alpha,'beard-owned opacity floor: '+path);
    assert.deepEqual(doc.hoodWhiskerMask,{size:200,runs:[]},'no priority whiskers for either beard: '+path);
  }else{
    assert.equal(doc.hoodCutoutRequestMode,'silhouette','other beards adapt requests to own opaque art: '+path);
    assert(!doc.hoodWhiskerMask?.runs?.length,'non-Grandbeard never receives priority whiskers: '+path);
    assert(!doc.hoodCutoutMask?.runs?.length,'do not copy Mao\'ao hand-painted coordinates to other species: '+path);
  }
}
for(const path of hoodPaths){
  const doc=readCosmetic(path);
  assert.equal(doc.beardCutoutPermissionMode,'auto','hood computes actual opening: '+path);
  assert.equal(doc.beardCutoutConeSpread,2,'reference lower cone: '+path);
  assert.equal(doc.beardCutoutTopConeSpread,3,'reference downward cover widens to line: '+path);
  assert.equal(doc.beardCutoutTopUpConeSpread,3,'reference upward cover widens to line: '+path);
  assert.equal(doc.beardCutoutTopDownConeLength,0,'reference downward overhang length: '+path);
  assert.equal(doc.beardCutoutPaintAlphaFloor,128,'reference hood alpha floor: '+path);
  assert(!doc.beardCutoutAllowedMask,'do not freeze automatically detected hood permission: '+path);
}
const ragged=readCosmetic('docs/config/cosmetics/ragged_hood.json');
for(const [variant,expected] of Object.entries({
  kenkari_male:{spread:.5,alpha:2,runs:57,pixels:2036,first:[22546,2],last:[31707,8]},
  mashtzarr_male:{spread:.625,alpha:247,runs:118,pixels:33647,first:[0,12107],last:[27867,12133]}
})){
  const policy=ragged.speciesVariants?.[variant]; // Explicitly scoped to this hood's male sprite, not other species.
  assert(policy?.parts?.head?.layers?.front,'original hood art still present: '+variant);
  assert.equal(policy.beardCutoutPermissionMode,'painted','hood painted policy: '+variant);
  assert.equal(policy.beardCutoutConeSpread,expected.spread,'saved lower cone: '+variant);
  assert.equal(policy.beardCutoutTopConeSpread,null,'strict upper overhang remains disabled: '+variant);
  assert.equal(policy.beardCutoutTopUpConeSpread,3,'unused upward cone setting preserved: '+variant);
  assert.equal(policy.beardCutoutTopDownConeLength,0,'saved downward overhang length: '+variant);
  assert.equal(policy.beardCutoutPaintAlphaFloor,expected.alpha,'hood opacity floor: '+variant);
  assert.equal(policy.beardCutoutAllowedMask?.size,200,'permission mask size: '+variant);
  assert.equal(policy.beardCutoutAllowedMask?.runs.length,expected.runs,'permission RLE count: '+variant);
  assert.equal(Cut.countMask(policy.beardCutoutAllowedMask),expected.pixels,'permission pixels: '+variant);
  assert.deepEqual(policy.beardCutoutAllowedMask.runs[0],expected.first,'first permission run: '+variant);
  assert.deepEqual(policy.beardCutoutAllowedMask.runs.at(-1),expected.last,'last permission run: '+variant);
}
assert(!Object.hasOwn(ragged.speciesVariants['mao-ao_male'],'beardCutoutPermissionMode'),
  'other Ragged Hood variants retain the shared automatic permission');
const ownerCount=beardPaths.filter(p=>readCosmetic(p).hoodWhiskerMask?.runs?.length).length;
assert.equal(ownerCount,1,'Mao Grandbeard remains the only beard with winning whisker paint');

const facewrap=readCosmetic('docs/config/cosmetics/facewrap.json');
assert(facewrap.tags.includes('hides-facial-hair')&&!facewrap.beardCutoutTopConeSpread,
  'facewrap keeps its deliberate hide-beard behavior');

const original=fs.readFileSync('docs/index.html','utf8');
const studio=fs.readFileSync('docs/tools/character-studio/index.html','utf8');
const attack=fs.readFileSync('docs/tools/attack-animation-editor/index.html','utf8');
const html=fs.readFileSync('docs/tools/beard-hood-cutout/index.html','utf8');
assert(portrait.includes('const paintedBeardMask = renderOptions?.beardHoodCutoutMaskOverride')
  && portrait.includes('const result = cutoutApi.applyToHood(cloth, paintedBeardMask)'),
  'runtime calls shared compositor only at the separate hood stage');
const beardDraw=portrait.indexOf('if (!_beardBelowHead) drawNegotiatedBeard();');
const beardBelow=portrait.indexOf('if (_beardBelowHead) drawNegotiatedBeard();');
const hoodDraw=portrait.indexOf('if (negotiatedHood) {',beardDraw);
const faceDraw=portrait.indexOf('drawEmoteLayers(maskLayers); // Face masks sit over the hood opening',hoodDraw);
assert(beardBelow>=0 && beardBelow<beardDraw && beardDraw<hoodDraw && hoodDraw<faceDraw,
  'main ordering survives: Mashtzarr beard below head, other beards above head, hood, then face mask');
assert(portrait.includes('!hiddenCosmeticGroups.has(facialHair)')
  && portrait.includes('facialHairLayers.length && hoodLayers.length'),
  'no active beard or a facewrap never performs two-way arbitration');
assert(portrait.includes('drawEmoteLayers(facialHairLayers, beardCtx')
  && portrait.includes('const result = cutoutApi.negotiateBeardHood(beardScratch, hoodScratch')
  && portrait.includes('ctx.drawImage(negotiatedHood'),
  'beard and hood are negotiated offscreen and composite back only at their original positions');
assert(portrait.includes('variantBeardCutoutAllowedMasks')&&portrait.includes('resolveHoodBeardPolicy')
  && portrait.includes('variantBeardCutoutConeSpread'),
  'gameplay resolves automatic, painted and permissive hood policy from cosmetic JSON');
assert(portrait.includes('hoodWhiskerMask')&&portrait.includes('variantHoodWhiskerMasks')
  && portrait.includes('whiskerMask,')
  && portrait.includes('requestMode:beardAuthoring.requestMode,beardImageData,unchangedHoodImageData:stretch.unchangedImageData,'),
  'gameplay resolves priority whiskers and artwork-based requests independently');
assert(portrait.includes('const exactSharedArt=key===keys[0]')
  && portrait.includes('option.variantHoodCutoutMasks'),
  'exact wearer-specific beard masks work even when the underlying beard sprite is shared');
assert(portrait.includes('} else if (negotiationError) {')
  && portrait.includes('drawBreathingLayers(hoodLayers); // Safe fallback'),
  'failed pixel readbacks cannot silently carve protected hood fabric');
assert(portrait.includes('maskPixels:result.approvedPixels'),
  'older debug clients retain a maskPixels field after the two-sided transition');
assert(portrait.includes('hoodMoves:stretch.moves'),
  'gameplay applies hood stretch to the permission mask as well');
assert(portrait.includes('variantHoodCutoutMasks')&&portrait.includes('hoodCutoutMask = maskApi?.normalizeMask'),
  'cosmetic JSON and species variants survive the main option parser');
assert(portrait.includes('cutoutApi.stretchHoodToRoots(cloth, tuftRoots') &&
  portrait.indexOf('cutoutApi.stretchHoodToRoots(cloth, tuftRoots') < portrait.indexOf('cutoutApi.applyToHood(cloth, paintedBeardMask)'),
  'runtime stretches hood inner ring before the independent beard cutout mask');
assert(portrait.includes('variantHoodTuftRoots') && portrait.includes('hoodTuftMaxStretch'),
  'species-specific tuft anchors and stretch limits are loaded as optional cosmetic metadata');
assert(portrait.includes('subdivision:beardAuthoring.subdivision')
  && portrait.includes('aboveInfluence:beardAuthoring.aboveInfluence')
  && portrait.includes('belowInfluence:beardAuthoring.belowInfluence'),
  'game renderer supplies all three deformation controls to the same 2D hood stretching');
assert(portrait.includes('variantHoodTuftSubdivision')
  && portrait.includes('variantHoodTuftAboveInfluence')
  && portrait.includes('variantHoodTuftBelowInfluence'),
  'option parser retains shared and species-variant deformation settings');
for(const text of [original,studio,attack])
  assert(text.indexOf('beard-hood-cutout.js')<text.indexOf('portrait-utils.js') && text.includes('beard-hood-cutout.js'),
    'every portrait entrypoint loads the cutout core before portrait-utils');
{ // Any page or loader that pulls in the shared compositor must load the cutout core first, so tool previews match gameplay.
  const path=require('node:path');
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()
    ?(['assets','vendor','references'].includes(e.name)?[]:walk(path.join(dir,e.name)))
    :/\.(html|js)$/.test(e.name)?[path.join(dir,e.name)]:[]);
  const loaders=walk('docs').filter(file=>/portrait-utils\.js\?v=/.test(fs.readFileSync(file,'utf8')));
  assert(loaders.length>=10,'found the pages and loaders that include portrait-utils');
  for(const file of loaders){
    const text=fs.readFileSync(file,'utf8');
    const at=text.search(/portrait-utils\.js\?v=/), core=text.search(/beard-hood-cutout\.js\?v=/);
    assert(core>=0&&core<at,`${file} loads beard-hood-cutout.js before portrait-utils.js`);
  }
}
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
for(const id of ['paintCanvas','beard','hood','variant','paintMode','eraseMode','rootMode',
  'hoodAutoMode','coneSpread','coneSpreadLabel','topConeEnabled','topConeSpread','topConeSpreadLabel',
  'topConeUpSpread','topConeUpSpreadLabel','topConeDownLength','topConeDownLengthLabel',
  'whiskerMode','whiskerEraseMode','clearWhiskers',
  'alphaFloor','hoodAlphaFloor','hoodAlphaFloorLabel','maxStretch','subdivision','aboveInfluence','belowInfluence',
  'removeRoot','clearRoots','hoodAllowMode','hoodProtectMode','protectWholeHood',
  'allowWholeHood','hoodJson','downloadHood','download','maskJson'])
  assert(html.includes('id="'+id+'"'),'the mobile 2D author exposes '+id);
for(const id of ['coneSpread','topConeSpread','topConeUpSpread'])
  assert(html.includes('id="'+id+'" type="range" min="0" max="3" step=".025"'),
    'all cone widening sliders expose the 180-degree Line endpoint: '+id);
assert(html.includes('Line (180°)')&&html.includes('formatConeSpread'),
  'the editor clearly labels widening to a line instead of showing misleading pixel slopes');
assert(html.includes('min="0" max="64" step="0.25"')
  && html.includes("Number($('maxStretch').value)")
  && !html.includes("Number($('maxStretch').value)||36"),
  'editor slider supports 0 and quarter-pixel movement with no truthiness fallback');
assert(portrait.includes('Math.max(0,Math.min(64,Number(json.hoodTuftMaxStretch)))'),
  'cosmetic parser retains zero and fractional stretch limits');
assert(html.includes('subdivision:selectedSubdivision()')
  && html.includes('aboveInfluence:selectedAboveInfluence()')
  && html.includes('belowInfluence:selectedBelowInfluence()')
  && html.includes('hoodTuftSubdivision:selectedSubdivision()')
  && html.includes('hoodTuftAboveInfluence:selectedAboveInfluence()')
  && html.includes('hoodTuftBelowInfluence:selectedBelowInfluence()'),
  'editor uses locality and upper/lower values in preview, persistence and exported cosmetic JSON');
assert(html.includes('Cut.negotiateBeardHood(survivingBeard,maskedHood,mask,hoodAllowanceMask')
  && html.includes('hoodDraftStorageKey')
  && html.includes('function exportedHoodJson()')
  && html.includes('destination.beardCutoutAllowedMask')
  && html.includes("mode==='hoodProtect'"),
  'mobile editor previews, persists, imports and exports hood permissions separately');
assert(html.includes('drawCosmetic(hoodDoc,overrideHood,true)')
  && html.includes("layerName!=='back'"),
  'editor permission strokes never target authored rear hood layers');
assert(html.includes('destination.beardCutoutPermissionMode=hoodPermissionMode')
  && html.includes('destination.beardCutoutConeSpread=Cut.normalizeConeSpread(coneSpread)'),
  'variant policy export explicitly overrides inherited modes without modifying other cosmetics');
assert(html.includes('hoodWhiskerMask:Cut.normalizeMask(whiskerMask)')
  && html.includes('Cut.autoHoodAllowanceMask(stretchedHoodPixels,coneSpread,')
  && html.includes('alphaLimit:selectedHoodAlphaFloor()'),
  'separate JSON exports retain beard whiskers and auto-cone generation');
assert(html.includes('Cut.autoHoodAllowanceMask(hoodPixels,coneSpread,')
  && html.includes('alphaLimit:selectedHoodAlphaFloor()')
  && html.includes("hoodPermissionMode='painted'")
  && html.includes('hoodMode?selectedHoodAlphaFloor():selectedAlphaFloor(),hoodMode'),
  'manual hood paint initializes from the auto cone, then switches to an authored permission policy');
assert(html.includes('beardCutoutPaintAlphaFloor=selectedHoodAlphaFloor()')
  && html.includes('hoodPaintAlphaFloor:selectedHoodAlphaFloor()')
  && html.includes('hoodDraftStorageKey='),
  'hood alpha floor is exported, visible in diagnostics, and persists with independent hood drafts');
assert(portrait.includes('variantBeardCutoutTopConeSpread')
  && portrait.includes('topConeSpread:hoodPolicy.topConeSpread')
  && html.includes('destination.beardCutoutTopConeSpread=Cut.normalizeConeSpread(topConeSpread)')
  && html.includes('topCover:topCoverPermission')
  && html.includes('upSpread:topUpConeSpread,downLength:topDownConeLength')
  && html.includes('destination.beardCutoutTopUpConeSpread=Cut.normalizeConeSpread(topUpConeSpread)')
  && html.includes('destination.beardCutoutTopDownConeLength=Cut.normalizeCoverLength(topDownConeLength)')
  && portrait.includes('topUpConeSpread:hoodPolicy.topUpConeSpread')
  && portrait.includes('topDownConeLength:hoodPolicy.topDownConeLength'),
  'top cone works in the portrait renderer, editor preview, and hood JSON variants');
assert(portrait.includes('variantBeardCutoutPaintAlphaFloor')
  && portrait.includes('hoodAlphaFloor:hoodPolicy.alphaFloor'),
  'game renderer passes variant-resolved hood alpha floor into automatic ring geometry');
assert(html.includes('beardPaintAlphaFloor:selectedAlphaFloor()')
  && html.includes('beardDoc?.beardPaintAlphaFloor'),
  'editor round-trips beard-specific opacity independently of hood paint opacity');
assert(html.includes('beardRequestAutomatic')
  && html.includes('Cut.autoBeardRequestMask(beardPixels,242)')
  && html.includes("requestMode:beardRequestAutomatic?'silhouette':null")
  && html.includes("metadata.hoodCutoutRequestMode='silhouette'")
  && html.includes("metadata.hoodCutoutRequestMode='painted'"),
  'editor previews generated beard requests, persists them, and converts manual edits to painted masks');
assert(html.includes('id="hoodJson"')&&html.includes('id="downloadHood"')
  && html.includes('id="showBeardGhost"'),
  'mobile editor supports separate hood import/export and an alignment ghost');
assert(!html.includes('three.min.js')&&!html.includes('portrait-spline-rig.js'),
  '2D experiment does not load old 3D rig or Three.js');
assert(html.includes('const [beardArt,hoodArt]=await Promise.all')
  && html.indexOf("beardArt.getContext('2d').getImageData") < html.indexOf("beardCanvas.getContext('2d').drawImage(beardArt"),
  'loaders must validate a disposable canvas before committing origin-clean art into the editor');
assert(html.includes("if(!artReady){status('Artwork is unavailable;")
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
  console.log('Beard/hood: Kenkari and Mashtzarr painted Grand Beard/Ragged Hood masks, variant scoping, no extra whiskers and original draw order pass.');
}).catch(error=>{console.error(error);process.exitCode=1;});
