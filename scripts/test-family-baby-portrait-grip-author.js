#!/usr/bin/env node
'use strict';
// Exercise the real furniture editor portrait UV author and its mobile pointer handlers.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('docs/tools/furniture-avatar-author/carryable-objects.js','utf8');
const apiSource=fs.readFileSync('docs/config/family-baby-carry-pose.js','utf8');
const start=source.indexOf('  function drawBabyGripCanvas() {');
const end=source.indexOf('  function createGuides() {',start);
assert(start>0&&end>start,'the portrait-grip canvas reuses one editor-owned handler');
assert.match(source,/id="carryBabyGripCanvas"/,'mobile portrait canvas is present');
assert.match(source,/id="carryBabyU"/,'portrait U input exists');
assert.match(source,/id="carryBabyV"/,'portrait V input exists');
assert.match(source,/id="carryBabyDepth"/,'portrait depth input exists');
assert.match(source,/const draft=api.toProfile\(state.carryable,babyPortraitWidth,babyPortraitHeight\)/,
  'new randomized baby uses the CURRENT editor pose to reconstruct the unsaved portrait profile');
assert.match(source,/api.applyFrom\(state.carryable,draft,width,height\)/,
  'new randomized baby keeps grip coordinates proportional to the actual newborn size');
assert.doesNotMatch(source,/model\.scale\.setScalar\(BABY_REFERENCE_WIDTH/,
  'preview must not resize species with different body scales to the same arbitrary model width');
assert.match(source,/api.toProfile\(state.carryable,babyPortraitWidth,babyPortraitHeight\)/,
  'baby profile export uses the current real portrait dimensions');

const window={};new Function('window',apiSource)(window);const api=window.FamilyBabyCarryPose;
const width=.216,height=.216,state={selectedType:'carry',selectedId:'left',
  carryable:api.forSize(width,height)};
const actions=new Map(),drawCalls=[],selected=[];
const canvas={
  width:280,height:280,captured:null,
  getBoundingClientRect(){return {left:15,top:40,width:280,height:280};},
  getContext(){return context;},
  addEventListener(event,handler){actions.set(event,handler);},
  setPointerCapture(id){this.captured=id;},
  hasPointerCapture(id){return this.captured===id;},
  releasePointerCapture(id){if(this.captured===id)this.captured=null;},
};
const context={
  clearRect(){},fillRect(){},drawImage(...args){drawCalls.push(args);},
  beginPath(){},arc(){},fill(){},stroke(){},fillText(){},
};
const inputs={
  carryBabyGripCanvas:canvas,
  carryBabyU:{value:'75',listeners:new Map(),addEventListener(type,cb){this.listeners.set(type,cb);}},
  carryBabyV:{value:'20',listeners:new Map(),addEventListener(type,cb){this.listeners.set(type,cb);}},
  carryBabyDepth:{value:'-10',listeners:new Map(),addEventListener(type,cb){this.listeners.set(type,cb);}},
};
const portrait={width:200,height:200},el=id=>inputs[id]||null;
let syncs=0,refreshes=0,controls=0;
const harness=new Function('window','state','el','babyPortraitWidth','babyPortraitHeight',
  'babyFrontCanvas','refreshGuides','syncHoldingPreview','renderControls','select',`
  let editingBaby=true,babyPointerId=null,babyPointerSide=null;
  ${source.slice(start,end)}
  return {drawBabyGripCanvas,setBabyPortraitGrip,
    leave(){editingBaby=false;},enter(){editingBaby=true;}};
`)(window,state,el,width,height,portrait,()=>refreshes++,()=>syncs++,()=>controls++,side=>{
  selected.push(side);state.selectedId=side;
});
harness.drawBabyGripCanvas();
assert.equal(drawCalls.length,1,'2D editor draws the actual generated NPC baby portrait');
assert.equal(drawCalls[0][0],portrait,'portrait image is the one just rendered by Random Baby');
const originalRotation=JSON.stringify(state.carryable.handTargets.right.rotation);
const pointer=(u,v,extra={})=>({pointerId:7,clientX:15+u*280,clientY:40+v*280,
  preventDefault(){this.prevented=true;},...extra});
const down=pointer(.12,.5);
actions.get('pointerdown')(down);
assert.equal(selected.at(-1),'right','touch selects the nearest hand dot on the infant portrait');
assert.equal(canvas.captured,7,'drag captures pointer for reliable mobile authoring');
assert.equal(down.prevented,true,'touching portrait does not scroll the mobile page');
const drag=pointer(.25,.35);
actions.get('pointermove')(drag);
let uv=api.pointToPortrait(state.carryable.handTargets.right,width,height);
assert(Math.abs(uv.u-.25)<1e-10 && Math.abs(uv.v-.35)<1e-10,
  'dragging changes normalized image U/V, not an unrelated scene-space hand position');
assert.equal(JSON.stringify(state.carryable.handTargets.right.rotation),originalRotation,
  'touch editing the contact point does not change the authored wrist rotation');
actions.get('pointerup')(pointer(.25,.35));
assert.equal(canvas.captured,null,'pointer-up releases touch capture');
assert(refreshes>=2&&syncs>=2&&controls>=2,'both grip visuals and runtime preview update after pointer movement');

inputs.carryBabyU.listeners.get('change')();
uv=api.pointToPortrait(state.carryable.handTargets.right,width,height);
assert(Math.abs(uv.u-.75)<1e-10 && Math.abs(uv.v-.2)<1e-10 && Math.abs(uv.depth+.1)<1e-10,
  'U/V/depth percentages map exactly into the existing baby-local grip coordinates');

const saved=api.toProfile(state.carryable,width,height);
api.applyFrom(state.carryable,saved,.32,.32);
uv=api.pointToPortrait(state.carryable.handTargets.right,.32,.32);
assert(Math.abs(uv.u-.75)<1e-10 && Math.abs(uv.v-.2)<1e-10,
  'random new baby dimensions preserve the touch-edited portrait grip location');

const originalX=state.carryable.handTargets.right.x;
harness.leave();
actions.get('pointerdown')(pointer(.05,.05));
assert.equal(state.carryable.handTargets.right.x,originalX,
  'the portrait canvas cannot mutate furniture or child positions after leaving baby authoring');

// Header Download JSON must not silently export unrelated furniture while authoring a child.
const headerStart=source.indexOf("  const mainJsonButton=el('downloadJsonBtn');");
const headerEnd=source.indexOf("  el('carryBabyEdit').onclick=editBaby;",headerStart);
assert(headerStart>0&&headerEnd>headerStart,'the main JSON download is intercepted only in baby editing mode');
let headerClick=null,babyDownloads=0;
const header={textContent:'Download JSON',addEventListener(type,fn,capture){
  assert.equal(type,'click');assert.equal(capture,true,'baby export must capture the click before the furniture export handler');
  headerClick=fn;
}};
const headerHarness=new Function('el','exportBaby',`
  let editingBaby=false;
  ${source.slice(headerStart,headerEnd)}
  return {setMode(value){editingBaby=value;syncBabyDownloadButton();}};
`)(id=>id==='downloadJsonBtn'?header:null,()=>babyDownloads++);
headerHarness.setMode(true);
assert.equal(header.textContent,'Download Baby JSON','mobile header explicitly labels the actual exported profile');
let prevented=false,stopped=false;
headerClick({preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
assert(prevented&&stopped&&babyDownloads===1,
  'while editing baby, main JSON button downloads the baby profile rather than an unrelated furniture item');
headerHarness.setMode(false);
assert.equal(header.textContent,'Download JSON','leaving baby mode restores the original furniture export label');
prevented=false;stopped=false;
headerClick({preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
assert(!prevented&&!stopped&&babyDownloads===1,
  'ordinary furniture export remains untouched outside baby mode');

console.log('PASS baby portrait U/V/depth, touch grips, real-size reroll, mode exit and unambiguous export');
