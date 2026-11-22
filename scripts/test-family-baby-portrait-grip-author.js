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

// Copy and download must both use the exact same baby draft in baby mode.
const headerStart=source.indexOf("  const mainJsonButton=el('downloadJsonBtn');");
const headerEnd=source.indexOf("  el('carryBabyEdit').onclick=editBaby;",headerStart);
assert(headerStart>0&&headerEnd>headerStart,'both JSON buttons are intercepted only in baby editing mode');
const handlers=new Map(),exported=[],copied=[],babyStatus={textContent:''};
const makeButton=(id,title)=>({
  textContent:title,
  addEventListener(type,fn,capture){
    assert.equal(type,'click');assert.equal(capture,true,'baby export must capture the click before the original furniture handler');
    handlers.set(id,fn);
  },
});
const header=makeButton('downloadJsonBtn','Download JSON');
const copy=makeButton('copyJsonBtn','Copy Current JSON');
const profileDraft=()=>api.toProfile(state.carryable,.32,.32);
const headerHarness=new Function('el','exportBaby','currentBabyProfile','copyPlainTextWithFallback',`
  let editingBaby=false;
  ${source.slice(headerStart,headerEnd)}
  return {setMode(value){editingBaby=value;syncBabyDownloadButton();}};
`)(id=>({
  downloadJsonBtn:header,copyJsonBtn:copy,carryBabyStatus:babyStatus,jsonText:{value:''},
})[id]||null,()=>exported.push(profileDraft()),profileDraft,(text,area,label)=>copied.push({text,area,label}));
const event=()=>({prevented:false,stopped:false,preventDefault(){this.prevented=true;},
  stopImmediatePropagation(){this.stopped=true;}});
headerHarness.setMode(true);
assert.equal(header.textContent,'Download Baby JSON','mobile header explicitly labels the actual exported profile');
assert.equal(copy.textContent,'Copy Baby JSON','IO clipboard button must be labeled as baby content');
const downloadEvent=event();handlers.get('downloadJsonBtn')(downloadEvent);
assert(downloadEvent.prevented&&downloadEvent.stopped&&exported.length===1,
  'baby mode exports its current unsaved profile and blocks unrelated furniture downloads');
const copyEvent=event();handlers.get('copyJsonBtn')(copyEvent);
assert(copyEvent.prevented&&copyEvent.stopped&&copied.length===1,
  'baby mode intercepts the original furniture clipboard action');
assert.equal(copied[0].text,JSON.stringify(exported[0],null,2),
  'Copy Baby JSON and Download Baby JSON contain the IDENTICAL current normalized grip profile');
assert.equal(copied[0].label,'Baby profile JSON','the on-screen clipboard result identifies the payload');
assert.match(babyStatus.textContent,/Baby JSON copied/,'touch-capable result is readable in the page');

headerHarness.setMode(false);
assert.equal(header.textContent,'Download JSON','leaving baby mode restores the original furniture export label');
assert.equal(copy.textContent,'Copy Current JSON','leaving baby mode restores the original furniture copy label');
const furnitureDownload=event(),furnitureCopy=event();
handlers.get('downloadJsonBtn')(furnitureDownload);
handlers.get('copyJsonBtn')(furnitureCopy);
assert(!furnitureDownload.prevented&&!furnitureDownload.stopped
  &&!furnitureCopy.prevented&&!furnitureCopy.stopped,
  'the existing furniture copy/download handlers remain authoritative outside baby authoring');
assert.equal(exported.length,1,'furniture mode did not spuriously export the previous baby pose');
assert.equal(copied.length,1,'furniture mode did not spuriously copy the previous baby pose');

// Copying a baby must be possible on the Carryable tab without switching to IO.
assert(source.includes('id="carryBabyCopy"'), 'the Carryable tab has a dedicated baby copy control');
const profileBegin=source.indexOf('  function currentBabyProfile(){');
const profileEnd=source.indexOf("  const mainJsonButton=el('downloadJsonBtn');",profileBegin);
assert(profileBegin>0&&profileEnd>profileBegin,'copy and export use one shared profile function');
const copyFallback={hidden:true,value:'',focus(){this.focused=true;},select(){this.selected=true;}};
const mobileStatus={textContent:''};
const downloaded=[];
let copiedDirect=null;
const carryCopyHarness=new Function('window','state','el','babyPortraitWidth','babyPortraitHeight',
  'download','Blob','copyPlainTextWithFallback',
  'let editingBaby=true;\n'+source.slice(profileBegin,profileEnd)
  +'\nreturn {currentBabyProfile,copyBaby,exportBaby};')(
  window,state,id=>({carryBabyCopyText:copyFallback,carryBabyStatus:mobileStatus})[id]||null,
  .32,.32,(name,blob)=>downloaded.push({name,blob}),Blob,
  async (text,fallback,label)=>{
    copiedDirect={text,label};
    fallback.value=text;fallback.focus();fallback.select();
    return false; // Simulated mobile clipboard denial exercises visible manual fallback.
  });
const activeProfile=carryCopyHarness.currentBabyProfile();
const copyPromise=carryCopyHarness.copyBaby();
assert.equal(copyFallback.hidden,false,'baby JSON fallback is visible in the active Carryable tab');
assert.equal(copiedDirect.text,JSON.stringify(activeProfile,null,2),'copy uses the CURRENT unsaved pose');
carryCopyHarness.exportBaby();
assert.equal(downloaded[0].name,'family-baby-carry-pose.json','export writes the family baby profile, not furniture');
copyPromise.then(result=>{
  assert.equal(result,false,'denied clipboard is reported');
  assert(copyFallback.focused&&copyFallback.selected,'manual fallback JSON is selected for mobile copying');
  assert.match(mobileStatus.textContent,/manual copying/,'visible status explains copying a blocked clipboard');
  console.log('PASS baby grip portrait coordinates, touch, direct baby copy, clipboard fallback and unambiguous downloads');
}).catch(error=>{console.error(error);process.exitCode=1;});
