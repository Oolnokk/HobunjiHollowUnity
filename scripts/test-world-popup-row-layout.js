#!/usr/bin/env node
'use strict';
// Execute the production frame updater and compare row positions with its
// original per-row sort, including a same-frame expiry between visible rows.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('docs/js/world-popup-text.js', 'utf8');
function block(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a);
  return source.slice(a,b);
}
const actual = block('  function update(now) {', '  function init(deps)');
const legacy = actual.replace(/    let rowLayouts = null;[^\n]*\n/, '')
  .replace(/        rowLayouts\?\.delete\(event.root\);[^\n]*\n/, '')
  .replace(/        if \(!rowLayouts\) rowLayouts = new Map\(\);[\s\S]*?        const centerSlot =/, `        const list = event.interactionPrompt ? interactionListFor(event.root) : listFor(event.root);
        list.forEach((item, slot) => { item.listSlot = slot; });
        const centerSlot =`);
assert.notEqual(actual, legacy);
assert(!legacy.includes('rowLayouts'));
function run(updateSource, activeSpec, now) {
  class Vec {
    constructor(x=0,y=0,z=0) { Object.assign(this,{x,y,z}); }
    setFromMatrixColumn(matrix,i) { this.x = i===0?1:0; this.y=0; this.z=i===2?1:0; return this; }
    normalize() { return this; }
    addScaledVector(v,k) { this.x+=v.x*k; this.y+=v.y*k; this.z+=v.z*k; return this; }
    copy(v) { this.x=v.x; this.y=v.y; this.z=v.z; return this; }
    setScalar(s) { this.x=this.y=this.z=s; }
  }
  const roots = [{},{}]; // Multiple actors and both list categories.
  const active = activeSpec.map(([id,root,kind,prompt,life,mode='centeredFiveRow']) => ({
    id,root:roots[root],kind,interactionPrompt:prompt,mode,startedAt:0,lifetimeMs:life,sequence:id,
    width:.3,height:.2,offsetX:0,offsetY:0,
    material:{opacity:1},plane:{position:new Vec(),quaternion:{copy(){}},scale:new Vec()},
  }));
  const disposed=[],forwarded=[];
  let sorts=0,cameraUpdates=0;
  const state={active,infoLists:new Map(),settings:{centeredFiveRow:{worldHeight:.32,maxRows:5,rowSpacing:1.08,textAlign:'left'},floatPlus:{worldHeight:.36}},
    deps:{THREE:{Vector3:Vec},camera:{matrixWorld:{},position:new Vec(0,0,5),quaternion:{},updateMatrixWorld(){cameraUpdates++;}}}};
  const ctx={state,Vec,PRIORITY:{skillXp:0,masteryXp:1,favor:2,currency:3,loot:4},
    CENTERED_LIST_SCALE:.25,INTERACTION_MAX_SCREEN_FRACTION:.035,_updateScratch:{},
    rowLayoutBuilds:0,popupAnchorWorld:()=>new Vec(),updateIconEffect:()=>true,
    dispose:event=>disposed.push(event.id),forwardToReadout:event=>forwarded.push(event.id),
    updateConditionCallout(){},updateAimLabel(){},updateInfoLists(){},keepPromptRowOnScreen(){}};
  ctx.listFor=root=>{sorts++;return active.filter(e=>e.root===root&&e.mode==='centeredFiveRow'&&!e.interactionPrompt).sort((a,b)=>(ctx.PRIORITY[a.kind]??99)-(ctx.PRIORITY[b.kind]??99)||a.sequence-b.sequence)};
  ctx.interactionListFor=root=>{sorts++;return active.filter(e=>e.root===root&&e.interactionPrompt).sort((a,b)=>a.sequence-b.sequence)};
  vm.runInNewContext(updateSource+'\nupdate('+now+');',ctx);
  return {sorts,cameraUpdates,rows:active.map(e=>[e.id,e.listSlot,e.plane.position.x,e.plane.position.y,e.plane.scale.x,e.material.opacity]),disposed,forwarded};
}
const rows=[[1,0,'loot',false,3200],[2,0,'skillXp',false,3200],[3,0,'masteryXp',false,10],
 [4,0,'favor',false,3200],[5,0,'interaction',true,3200],[6,0,'interaction',true,3200],
 [7,1,'currency',false,3200],[8,1,'skillXp',false,3200],[9,1,'damage',false,1150,'floatPlus']];
for(const time of [5,500,3200]) {
  const before=run(legacy,rows,time), after=run(actual,rows,time);
  assert.deepEqual(after.rows,before.rows,'row position, order, fade and scale must match the original updater');
  assert.deepEqual(after.disposed,before.disposed);
  assert.deepEqual(after.forwarded,before.forwarded);
  if(time===5||time===500)assert(after.sorts<before.sorts,'reuse one sorted list per root and category until expiry');
}
assert.equal(run(actual,[],50).cameraUpdates,0);
assert.equal(run(actual,[[1,0,'damage',false,1150,'floatPlus']],50).sorts,0);
// Use the actual event gate, not a duplicate approximation of its camera test.
const familyPopup = block('  function showFamilyUsefulness(', '  function showChange(');
const popupScene={}, camera={}, emitted=[];
const popupRoot={visible:true,parent:popupScene};
let projected={x:0,y:0,z:0};
const gate=vm.runInNewContext(familyPopup+'\nshowFamilyUsefulness;',{
  state:{deps:{camera,getActiveScene:()=>popupScene}},
  iconAnchorScene:root=>root.visible?root.parent:null,
  avatarCentroidWorld:()=>({project(){Object.assign(this,projected);}}),
  spawn:entry=>{emitted.push(entry);return 0;}
});
assert.equal(gate(popupRoot,.125),true);
assert.equal(emitted[0].text,'+0.13 Usefulness XP');
assert.equal(emitted[0].root,popupRoot);
projected={x:1.1,y:0,z:0};assert.equal(gate(popupRoot,2),false);
projected={x:0,y:0,z:2};assert.equal(gate(popupRoot,2),false);
projected={x:0,y:0,z:0};popupRoot.visible=false;assert.equal(gate(popupRoot,2),false);
popupRoot.visible=true;popupRoot.parent={};assert.equal(gate(popupRoot,2),false);
assert.equal(emitted.length,1,'off-camera, hidden and wrong-scene family awards do not spawn popups');
console.log('World popup row layout and family visibility parity: PASS');
