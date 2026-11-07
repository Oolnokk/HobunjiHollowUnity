#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const toolRoot=path.join(__dirname,'../docs/tools/clothing-species-fit'); // Uses the actual shipped editor files.
const read=name=>fs.readFileSync(path.join(toolRoot,name),'utf8');
const loader=read('loader.js');
const html=read('index.html');
const parts=Array.from({length:12},(_,i)=>read('app.part'+(i+1)+'.txt'));
const behind=Array.from({length:5},(_,i)=>read('behind.part'+(i+1)+'.txt'));
new vm.Script(loader,{filename:'loader.js'});
new vm.Script(parts.join(''),{filename:'clothing-fit-core.js'});
new vm.Script(behind.join(''),{filename:'clothing-fit-behind.js'});

assert.match(html,/<script async src="https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/build\/three\.min\.js"/,
  'The optional Three.js CDN must never block the 2D loader');
assert.match(html,/<script defer src="\.\.\/\.\.\/js\/tap-reliability\.js/,
  'The optional mobile tap helper must not block the HTML parser');
assert.match(html,/onerror="document\.getElementById\('status'\)/,
  'A failed loader.js network request must be visible without DevTools');
assert.match(parts.join(''),/2D editor ready:/,'The initial editor becomes usable before background catalogs finish');
assert.match(parts.join(''),/hobunji-clothing-fit-three-ready/,'Late asynchronous Three.js readiness must be handled');
assert.match(parts.join(''),/Image timed out after 15 seconds/,'Missing images must produce a bounded error');
assert.match(parts.join(''),/Timed out after 12 seconds/,'Repository JSON fetches must be bounded');

// The canonical cloud mask patch was retired; the rig loader must not invoke its missing function.
assert.doesNotMatch(parts[5],/installCanonicalCloudMaskScale\s*\(/,
  'The runtime rig must not call a removed mask patch function');
assert.doesNotMatch(parts[5],/::mask:/,
  'Preview-only cloud-mask sliders must not create redundant canonical portrait cache entries');

function extractEditorFunction(source,start,end){
  const begin=source.indexOf(start),finish=source.indexOf(end,begin);
  assert(begin>=0&&finish>begin,'Missing editor function '+start);
  return source.slice(begin,finish);
} // Regression checks run the shipped editor functions instead of reimplementing their logic.

const fit={scaleX:1,scaleY:.835,translateX:-3.5,translateY:-11.25};
const input=(value,min,max)=>({value,min,max,listeners:{},addEventListener(type,callback){this.listeners[type]=callback}});
const slider=input('1','0.5','1.75'),number=input('1','0.5','1.75');
let saves=0,renders=0;
const fields=new Function('currentTransform','saveState','syncTransformControls','render',
  extractEditorFunction(parts[9],'function setTransformField(', 'function resetMaskTransform(')+
  '\nreturn {setTransformField,wireTransformPair};')(
    ()=>fit,()=>{saves++},
    ()=>{slider.value=String(fit.scaleX);number.value=String(fit.scaleX);},
    ()=>{renders++}
  );
fields.wireTransformPair(slider,number,'scaleX');
number.value='';number.listeners.input();
assert.equal(fit.scaleX,1,'Clearing a mobile number field must never record zero scale');
assert.equal(number.value,'','Do not overwrite intermediate number editing with a forced resync');
number.value='0';number.listeners.input();
assert.equal(fit.scaleX,1,'A temporarily out-of-range scale must not be saved');
number.value='0.835';number.listeners.input();
assert.equal(fit.scaleX,.835,'A valid fractional scale should be accepted after intermediate typing');
number.value='0';number.listeners.change();
assert.equal(number.value,'0.835','Leaving an invalid number field restores the last valid scale');
assert.equal(saves,1,'Only the valid change should persist');
assert.equal(renders,1,'Only the valid change should redraw');

// A pasted grid with zero scale is ambiguous and must fail visibly instead of exporting a line.
const parseDiagnostics=new Function('GRID_SIZE',
  extractEditorFunction(parts[9]+parts[10],'function parseDiagnostics(', 'async function importPastedDiagnostics(')+
  '\nreturn parseDiagnostics;')(6);
const invalidReport=[
  'gridSize: 6x6','warp model: bilinear 6x6 quads',
  'target grid: headwear::tletingan_male','garment: fine_hood',
  'base transform: {"scaleX":0,"scaleY":0.835,"translateX":-3.5,"translateY":-11.25}'
].join('\n');
assert.throws(()=>parseDiagnostics(invalidReport),/zero\/negative base scale/,
  'Importing a collapsed report must direct the author to repair the original fit');

const key='from::tletingan_male::headwear::tletingan_male';
const offsets=Array.from({length:36},()=>({x:0,y:0}));
const state={baseTransforms:{[key]:{scaleX:0,scaleY:.835,translateX:-3.5,translateY:-11.25}},localOffsets:{[key]:offsets}};
const runtime={logs:[]};
const ensure=new Function('A','R','SOURCE_GRID','targetKey','defaultTransform','zeroOffsets',
  extractEditorFunction(parts[2],'function ensureTargetData(', 'function currentTransform()')+
  '\nreturn ensureTargetData;')(
    state,runtime,offsets,()=>key,
    ()=>({scaleX:1,scaleY:1,translateX:0,translateY:0}),()=>offsets.map(()=>({x:0,y:0}))
  );
ensure('tletingan','male');
assert.equal(state.baseTransforms[key].scaleX,1,'A saved zero-width hood is automatically recoverable');
assert.equal(state.baseTransforms[key].scaleY,.835,'Recovering width must preserve the fitted height');
assert.equal(state.baseTransforms[key].translateY,-11.25,'Recovering width must preserve translation');
assert.strictEqual(state.localOffsets[key],offsets,'Recovering the base scale must not discard 36 local offsets');
assert(runtime.logs[0]?.includes('Recovered invalid base scaleX'),'The repair is visible in mobile diagnostics');

function fakeElement(){
  return {
    textContent:'',hidden:false,style:{},children:[],removed:false,
    setAttribute(){},insertAdjacentElement(_where,element){this.banner=element},
    appendChild(element){this.children.push(element)},remove(){this.removed=true}
  };
}
function makeHost(fetchImplementation,setTimeoutImplementation=setTimeout){
  const status=fakeElement();status.textContent='Loading…';
  const region={value:'headwear'};
  const behindPanel=fakeElement();
  const document={
    getElementById(id){
      if(id==='status')return status;
      if(id==='fitRegion')return region;
      if(id==='behindSpritePatchSection')return behindPanel;
      return null;
    },
    createElement:fakeElement
  };
  const host={
    document,fetch:fetchImplementation,AbortController,
    setTimeout:setTimeoutImplementation,clearTimeout,
    console:{error(){}},
    location:{reload(){host.reloaded=true}}
  };
  host.window=host;
  return {host,status,behindPanel};
}
async function waitUntil(predicate,timeoutMs=1000){
  const deadline=Date.now()+timeoutMs;
  while(!predicate()){
    assert(Date.now()<deadline,'The loader hung without reporting completion or an error');
    await new Promise(resolve=>setTimeout(resolve,5));
  }
}
async function testSuccess(){
  const names=[];
  const files={};
  for(let i=1;i<=12;i++)files['app.part'+i+'.txt']=i===1?'window.coreReady=true;':'';
  for(let i=1;i<=5;i++)files['behind.part'+i+'.txt']=i===1?'window.behindReady=true;':'';
  const {host,status,behindPanel}=makeHost(async name=>{
    names.push(name);
    assert(Object.hasOwn(files,name),'Unexpected fetched module '+name);
    return {ok:true,text:async()=>files[name]};
  });
  vm.runInNewContext(loader,host,{filename:'loader.js'});
  await waitUntil(()=>status.banner?.removed);
  assert.equal(names.length,17,'All app + behind modules must load exactly once');
  assert.equal(host.coreReady,true,'The main editor must initialize');
  assert.equal(host.behindReady,true,'The behind-sprite extension must initialize');
  assert.equal(behindPanel.hidden,true,'Headwear mode hides the body-only patch extension');
}
async function testNetworkFailure(){
  const {host,status}=makeHost(async name=>{
    if(name==='app.part3.txt')throw new Error('simulated offline request');
    return {ok:true,text:async()=>''};
  });
  vm.runInNewContext(loader,host,{filename:'loader.js'});
  await waitUntil(()=>status.banner?.children.length>0);
  assert.match(status.banner.textContent,/app\.part3\.txt/,'Name the failed module');
  assert.match(status.banner.textContent,/simulated offline request/,'Show the underlying error');
  assert.equal(status.banner.children[0].textContent,'Retry loading editor');
  status.banner.children[0].onclick();
  assert.equal(host.reloaded,true,'Retry must reload the page');
}
async function testHungNetwork(){
  const immediate=(fn,delay)=>setTimeout(fn,delay>=15000?5:delay);
  const {host,status}=makeHost(async()=>({ok:true,text:async()=>''}),immediate);
  host.currentRequestAborted=false; // Assert that AbortController, rather than a global spinner, ends the hung request.
  host.fetch=(name,options)=>{
    if(name!=='app.part1.txt')return Promise.resolve({ok:true,text:async()=>''});
    return new Promise((resolve,reject)=>{
      options.signal.addEventListener('abort',()=>{
        host.currentRequestAborted=true;
        reject(Object.assign(new Error('Aborted'),{name:'AbortError'}));
      },{once:true});
    });
  };
  vm.runInNewContext(loader,host,{filename:'loader.js'});
  await waitUntil(()=>status.banner?.children.length>0);
  assert.equal(host.currentRequestAborted,true,'Hung fetches must be aborted');
  assert.match(status.banner.textContent,/timed out after 15 seconds/,'Show a timeout rather than spinning');
}
(async()=>{
  await testSuccess();
  await testNetworkFailure();
  await testHungNetwork();
  console.log('OK: mobile-safe 2D startup, async 3D, module ordering, network errors, timeouts, retry');
})().catch(error=>{console.error(error);process.exitCode=1});
