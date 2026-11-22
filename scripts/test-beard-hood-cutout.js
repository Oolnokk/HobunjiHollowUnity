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
const noMove=new Canvas();noMove.pixels.set(ringBefore);
const inside=Cut.stretchHoodToRoots(noMove,[{x:115,y:94}],{maxStretch:36});
assert.equal(inside.insideRing,1,'tuft already inside the ring does not stretch the hood');
assert.equal(inside.stretched,0,'no active deformation for interior tuft');
assert.deepEqual(Array.from(noMove.pixels),Array.from(ringBefore),'inside ring leaves hood exactly unchanged');
// Previously the cap acted as a hard gate: e.g. 17px -> no deformation,
 // 18px -> full deformation. It must now move smoothly, even below 1px.
const partialRoot={x:140.5,y:94.5};
const originalPlan=Cut.planTuftStretch(ringBefore,[partialRoot],{maxStretch:64});
const needed=originalPlan.moves[0].requestedLength;
assert(needed>4,'test has a substantial original tuft-to-ring distance');
function stretchedCopy(limit){
  const copy=new Canvas();copy.pixels.set(ringBefore);
  const result=Cut.stretchHoodToRoots(copy,[partialRoot],{maxStretch:limit});
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
assert.equal(Cut.normalizeConeSpread(-1),0,'cone widening never goes negative');
assert.equal(Cut.normalizeConeSpread(200),2,'cone widening clamps at a reasonable maximum');
const missingRing=Cut.autoHoodAllowanceMask(new Uint8ClampedArray(SIZE*SIZE*4),.5);
assert.equal(missingRing.allowedPixels,0,'no detectable hood inner rim does not accidentally allow all');

const autoBeard=new Canvas(),autoHood=new Canvas();
autoHood.pixels.set(ringBefore);
setPixel(autoBeard,100,140,255);setPixel(autoBeard,65,140,255);
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
assert(portrait.includes('drawEmoteLayers(facialHairLayers, beardScratch.getContext')
  && portrait.includes('const result = cutoutApi.negotiateBeardHood(beardScratch, hoodScratch')
  && portrait.includes('ctx.drawImage(negotiatedHood'),
  'beard and hood are negotiated offscreen and composite back only at their original positions');
assert(portrait.includes('variantBeardCutoutAllowedMasks')&&portrait.includes('resolveHoodBeardPolicy')
  && portrait.includes('variantBeardCutoutConeSpread'),
  'gameplay resolves automatic, painted and permissive hood policy from cosmetic JSON');
assert(portrait.includes('hoodWhiskerMask')&&portrait.includes('variantHoodWhiskerMasks')
  && portrait.includes('whiskerMask});'),
  'gameplay resolves priority whiskers independently of normal cutout requests');
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
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
for(const id of ['paintCanvas','beard','hood','variant','paintMode','eraseMode','rootMode',
  'hoodAutoMode','coneSpread','coneSpreadLabel','whiskerMode','whiskerEraseMode','clearWhiskers',
  'alphaFloor','maxStretch','subdivision','aboveInfluence','belowInfluence',
  'removeRoot','clearRoots','hoodAllowMode','hoodProtectMode','protectWholeHood',
  'allowWholeHood','hoodJson','downloadHood','download','maskJson'])
  assert(html.includes('id="'+id+'"'),'the mobile 2D author exposes '+id);
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
  && html.includes('Cut.autoHoodAllowanceMask(stretchedHoodPixels,coneSpread)'),
  'separate JSON exports retain beard whiskers and auto-cone generation');
assert(html.includes('drag.last,hoodMode?8:selectedAlphaFloor(),hoodMode')
  && html.includes("hoodPermissionMode='painted'"),
  'manual hood paint starts with the auto cone and switches to an authored permission policy');
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
  console.log('Beard/hood: lower ring detector, expanding auto cone, priority whiskers, manual mask arbitration, black outlines, original draw order and CORS retry pass.');
}).catch(error=>{console.error(error);process.exitCode=1;});
