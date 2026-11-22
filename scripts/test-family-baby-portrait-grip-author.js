#!/usr/bin/env node
'use strict';
// Exercise the real furniture editor portrait UV author and its mobile pointer handlers.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('docs/tools/furniture-avatar-author/carryable-objects.js','utf8');
const apiSource=fs.readFileSync('docs/config/family-baby-carry-pose.js','utf8');
const start=source.indexOf('  function babyImagePoint(local) {');
const end=source.indexOf('  function createGuides() {',start);
assert(start>0&&end>start,'extract shipped real-portrait grip editor methods');
for(const name of ['carryBabyGripCanvas','carryBabyOffsetX','carryBabyOffsetY','carryBabyOffsetZ'])
  assert(source.includes('id="'+name+'"'),name+' authoring control is present');
assert(source.includes('api.toProfile(state.carryable,babyPortraitWidth,babyPortraitHeight,babyGripAnchors)'),
  'reroll captures current unsaved anatomical offsets');
assert(source.includes('api.applyFrom(state.carryable,draft,width,height,nextAnchors)'),
  'reroll resolves saved offsets against new baby anatomy');
assert.doesNotMatch(source,/model\.scale\.setScalar\(BABY_REFERENCE_WIDTH/,'no fixed 0.30 newborn width');
const window={};new Function('window',apiSource)(window);const api=window.FamilyBabyCarryPose;
const width=.216,height=.216,ratio=.7;
const anchors=api.anchorsForAvatar({visualCentroidLocalY:.0432,portraitVerticalPlacementRatio:ratio,
  neckRig:{spinePosteriorY:-.04,spineBase:{x:.02},neckLocal:{x:-.01,y:.06,z:.02}}},width,height);
const state={selectedType:'carry',selectedId:'left',carryable:api.forSize(width,height,anchors)};
const actions=new Map(),drawCalls=[],selected=[];
const context={clearRect(){},fillRect(){},drawImage(...args){drawCalls.push(args)},
  beginPath(){},arc(){},moveTo(){},lineTo(){},fill(){},stroke(){},fillText(){}};
const canvas={width:280,height:400,captured:null,
  getBoundingClientRect(){return {left:15,top:40,width:280,height:400}},
  getContext(){return context},
  addEventListener(event,fn){actions.set(event,fn)},
  setPointerCapture(id){this.captured=id},
  hasPointerCapture(id){return this.captured===id},
  releasePointerCapture(id){if(this.captured===id)this.captured=null},
};
const inputs=Object.fromEntries(['X','Y','Z'].map((axis,i)=>['carryBabyOffset'+axis,
  {value:['0.07','-0.09','0.04'][i],listeners:new Map(),
    addEventListener(type,callback){this.listeners.set(type,callback)}}]));
inputs.carryBabyGripCanvas=canvas;
const portrait={width:200,height:200},el=id=>inputs[id]||null;
let syncs=0,refreshes=0,controls=0;
const harness=new Function('window','state','el','babyPortraitWidth','babyPortraitHeight',
  'babyPortraitPlacementRatio','babyGripAnchors','babyFrontCanvas','refreshGuides',
  'syncHoldingPreview','renderControls','select',
  'let editingBaby=true,babyPointerId=null,babyPointerSide=null;\n'
   +source.slice(start,end)
   +'\nreturn {drawBabyGripCanvas,babyImagePoint,setBabyPortraitGrip,'
   +'leave(){editingBaby=false},enter(){editingBaby=true}};')(
  window,state,el,width,height,ratio,anchors,portrait,
  ()=>refreshes++,()=>syncs++,()=>controls++,side=>{selected.push(side);state.selectedId=side});
harness.drawBabyGripCanvas();
assert.equal(drawCalls[0][0],portrait,'draw the actual random NPC baby portrait');
assert.equal(canvas.height,400,'120px lower region supports below-portrait hand grips');
const originalRotation=JSON.stringify(state.carryable.handTargets.right.rotation);
const pointer=(u,v)=>({pointerId:7,clientX:15+u*280,clientY:40+v*280,
  preventDefault(){this.prevented=true}});
const down=pointer(.12,.5);
actions.get('pointerdown')(down);
assert.equal(selected.at(-1),'right','nearest hand grip selected');
assert.equal(canvas.captured,7,'mobile pointer capture');
assert.equal(down.prevented,true,'mobile drag prevents page scroll');
actions.get('pointermove')(pointer(.25,1.25));
const uv=harness.babyImagePoint(state.carryable.handTargets.right);
assert(Math.abs(uv.u-.25)<1e-10&&Math.abs(uv.v-1.25)<1e-10,
  'grip moves below portrait (Y pixel 350), not clamped at image edge');
assert(state.carryable.handTargets.right.y<0,'below portrait corresponds to negative baby-local height');
assert.equal(JSON.stringify(state.carryable.handTargets.right.rotation),originalRotation,'wrist rotation unchanged');
actions.get('pointerup')(pointer(.25,1.25));
assert.equal(canvas.captured,null,'pointer released');
assert(refreshes>=2&&syncs>=2&&controls>=2,'hand movement refreshes 3D pose');
inputs.carryBabyOffsetX.listeners.get('change')();
let offset=api.gripOffset('right',state.carryable.handTargets.right,anchors,width,height);
assert(Math.abs(offset.x-.07)<1e-10&&Math.abs(offset.y+.09)<1e-10&&Math.abs(offset.z-.04)<1e-10,
  'numeric controls edit neck-relative local distances, not percentage coordinates');
const saved=api.toProfile(state.carryable,width,height,anchors);
assert.equal(saved.grips.right.anchor,'neck','right profile declares its anatomical anchor');
const newAnchors=api.anchorsForAvatar({portraitVerticalPlacementRatio:.54,
  neckRig:{spinePosteriorY:-.07,neckLocal:{x:.03,y:.06,z:-.01}}},.32,.32);
api.applyFrom(state.carryable,saved,.32,.32,newAnchors);
offset=api.gripOffset('right',state.carryable.handTargets.right,newAnchors,.32,.32);
assert(Math.abs(offset.x-.07)<1e-10&&Math.abs(offset.y+.09)<1e-10&&Math.abs(offset.z-.04)<1e-10,
  'offset survives larger child and moved neck without rescaling');
const oldX=state.carryable.handTargets.right.x;
harness.leave();actions.get('pointerdown')(pointer(.05,.05));
assert.equal(state.carryable.handTargets.right.x,oldX,'no pointer edits after editor exit');
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
const profileDraft=()=>api.toProfile(state.carryable,.32,.32,newAnchors);
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
  'download','Blob','copyPlainTextWithFallback','babyGripAnchors',
  'let editingBaby=true;\n'+source.slice(profileBegin,profileEnd)
  +'\nreturn {currentBabyProfile,copyBaby,exportBaby};')(
  window,state,id=>({carryBabyCopyText:copyFallback,carryBabyStatus:mobileStatus})[id]||null,
  .32,.32,(name,blob)=>downloaded.push({name,blob}),Blob,
  async (text,fallback,label)=>{
    copiedDirect={text,label};
    fallback.value=text;fallback.focus();fallback.select();
    return false; // Simulated mobile clipboard denial exercises visible manual fallback.
  },newAnchors);
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
