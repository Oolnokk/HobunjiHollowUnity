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
    setFromMatrixColumn(matrix,i) { this.x = i===0?1:0; this.y=i===1?1:0; this.z=i===2?1:0; return this; }
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

 // Execute the actual source filter and popup formatting with isolated presentation stubs.
{
  const local = {}, remote = {}, pet = { master: local }, remotePet = { master: remote }, wild = {};
  const scene = { isScene: true }, target = { root: { parent: scene } }, calls = [], callouts = [];
  const registry = {
    isLocalPlayer: actor => actor === local,
    ownerPlayerOf: actor => actor?.master || null,
    isPlayer: actor => actor === local || actor === remote,
  };
  const gate = vm.runInNewContext(
    block('  function isLocalCombatSource(', '  function finishLevelUpAnnouncement(') + '\n({isLocalCombatSource,showCombatEffect,showImpactCallout});',
    {window:{ActorRegistry:registry,HOBUNJI_CONFIG:{resourceRings:{colors:{footing:'#67b7ff'},afflictionColors:{bleedingHealth:'#d11832'}}},ResourceSystem:{AFFLICTIONS:{bleedingHealth:{name:'Bleeding Health'},woundedStamina:{name:'Wounded Stamina'},shatteredStamina:{name:'Shattered Stamina'},shamblingFooting:{name:'Shambling Footing'},scentMarkedHealth:{name:'Scent Marked Health'}}}},
      state:{deps:{getActiveScene:()=>scene}},iconAnchorScene:root=>root.visible===false?null:root.parent,
      showChange:(kind,amount,options)=>{calls.push({kind,amount,...options});return calls.length;}, spawn:entry=>{callouts.push(entry);return callouts.length;}}
  );
  for(const source of [local,pet]) assert.equal(gate.isLocalCombatSource(source),true);
  for(const source of [null,remote,remotePet,wild]) assert.equal(gate.isLocalCombatSource(source),false);
  assert.equal(gate.showCombatEffect(target,'health',4.25,true),1);
  assert.equal(gate.showCombatEffect(target,'bleedingHealth',2,true),2);
  assert.equal(calls[0].amount,-4.3);
  assert.equal(calls[1].text,'-2 Bleeding');
  assert.equal(calls[0].color,undefined,'ordinary Health uses the authored damage color');
  assert.equal(calls[1].color,'#d11832');
  assert.equal(gate.showCombatEffect(target,'footing',5,true,'impact'),3);
  assert.equal(calls[2].text,'-5 Footing');
  assert.equal(calls[2].color,'#67b7ff');
  assert.equal(gate.showCombatEffect(target,'health',3,true,'impact'),4);
  assert.equal(calls[3].text,undefined);
  assert(calls.every(call => call.scatter && call.mode === 'floatPlus'));
  assert.equal(gate.showImpactCallout(target),1);
  assert.equal(callouts[0].text,'IMPACT!!!');
  assert.equal(callouts[0].emphasis,true);
  assert.equal(callouts[0].scatter,true);
  assert.equal(gate.showCombatEffect(target,'health',3,false),null);
  assert.equal(gate.showCombatEffect(target,'health',0,true),null);
  assert.equal(gate.showCombatEffect(local,'health',3,true),null);
  target.root.parent={};
  assert.equal(gate.showCombatEffect(target,'health',3,true),null);
  assert.equal(calls.length,4);
  target.root.parent=scene;
  for (const [id, amount, label] of [['woundedStamina',4,'Wounded'],['shatteredStamina',5,'Shattered'],['shamblingFooting',3,'Shambling'],['scentMarkedHealth',2,'Scent Marked']]) {
    gate.showCombatEffect(target,id,amount,true,'impact');
    assert.equal(calls.at(-1).text,`-${amount} ${label}`);
  }
}

// Exercise real scatter placement with the authored small Float+ text size.
{
  const root={}, active=[], state={active,settings:{floatPlus:{worldHeight:.13}}};
  const claim=vm.runInNewContext(block('  function claimFloatOffset(', '  function spawn(')+'\nclaimFloatOffset;', {state});
  for(let i=0;i<6;i++) {
    const emphasis=i===5; // Last popup is the bigger collision callout.
    const bounds=emphasis?{width:.85,height:.13*1.65}:{width:.38,height:.13};
    const point=claim(root,bounds,true,emphasis);
    active.push({root,mode:'floatPlus',kind:'damage',scatter:true,emphasis,offsetX:point.x,offsetY:point.y,...bounds});
  }
  const box=(e,p)=> {
    const drift=1+.22*(1-(1-p)**2), pop=e.emphasis?1.4-.4*Math.min(1,p/.24):1.1-.1*Math.min(1,p/.24);
    const x=e.offsetX*drift+Math.sin(p*Math.PI)*e.height*.12,y=e.offsetY*drift+.075*(1-(1-p)**2);
    return {x,y,w:e.width*pop,h:e.height*pop};
  };
  // Different start times: test every pair throughout both lifetimes.
  for(let i=0;i<active.length;i++) for(let j=i+1;j<active.length;j++) for(let p=0;p<=10;p++) for(let q=0;q<=10;q++){
    const a=box(active[i],p/10),b=box(active[j],q/10);
    assert(Math.abs(a.x-b.x)>=(a.w+b.w)/2 || Math.abs(a.y-b.y)>=(a.h+b.h)/2,'scatter text envelopes never overlap');
  }
  assert(active.some(e=>e.offsetX<0)&&active.some(e=>e.offsetX>0),'burst spreads to both sides');
  assert(active.some(e=>e.offsetY<0)&&active.some(e=>e.offsetY>0),'burst spreads vertically as well');
  assert(new Set(active.map(e=>e.offsetX)).size===active.length,'no vertical list alignment');
}
