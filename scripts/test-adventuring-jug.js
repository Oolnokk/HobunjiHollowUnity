'use strict';
const assert=require('node:assert/strict');
const create=require('../docs/js/adventuring-jug.js');
function exercise(create,assert){
  let time=0,wet=[],plasm=[],healed=[],hurt=[],fills=[];
  const p={},enemy={},undead={},up={},other={},dead={};
  const tile=(x=0,z=0,y=0,area='ruin')=>({x,z,y,area});
  const positions=new Map([[p,tile()],[enemy,tile()],[undead,tile()],[up,tile(0,0,3)],[other,tile(0,0,0,'farm')],[dead,tile()]]);
  const j=create({nowMs:()=>time,extinguishTile:t=>wet.push(t),clearPlasmTile:t=>plasm.push(t),fillReceptacle:(v,l,n)=>{fills.push(n);return Math.min(n,2);},
    actorsInArea:()=>[p,enemy,undead,up,other,dead,enemy],actorTile:a=>positions.get(a),isAlive:a=>a!==dead,isUndead:a=>a===undead,damageUndead:a=>hurt.push(a),healLiving:a=>healed.push(a)});
  assert.equal(j.fill(p,'unknown'),false);assert.equal(j.fill(p,'water'),true);assert.equal(j.getState(p).units,12);assert.equal(j.fill(p,'lifeWater'),false);
  const a=j.beginAction(p,'ruin','pour');assert.equal(j.getState(p).units,11);assert.deepEqual(j.resolveImpact(a,{area:'ruin',tile:tile(),tiles:[tile(1)]}),{filled:0,tiles:1});assert.equal(j.resolveImpact(a,{area:'ruin',tile:tile()}),null);assert.equal(wet.length,1);
  const b=j.beginAction(p,'ruin','splash');assert.deepEqual(j.resolveImpact(b,{area:'ruin',receptacle:{},tiles:[tile(),tile(),tile(1),tile(0,0,3),tile(0,0,0,'farm')]}),{filled:0,tiles:3});assert.equal(fills.length,0);
  const c=j.beginAction(p,'ruin','empty');assert.equal(c.units,10);assert.deepEqual(j.resolveImpact(c,{area:'ruin',receptacle:{}}),{filled:2,tiles:0});assert.equal(j.getState(p).units,0);
  assert.equal(j.fill(p,'lifeWater'),true);assert.equal(j.getState(p).units,6);assert.equal(j.beginDodge(p,'ruin',true),false);
  const d=j.beginAction(p,'ruin','pour');j.resolveImpact(d,{area:'ruin',tile:tile()});assert.equal(plasm.length,1);assert.equal(j.isConsecrated(tile()),true);assert.equal(j.isConsecrated(tile(0,0,3)),false);assert.equal(j.isConsecrated(tile(0,0,0,'farm')),false);
  j.update();time=1000;assert.equal(j.update(),3);assert.equal(healed.length,2);assert.equal(healed[0],p);assert.equal(healed[1],enemy);assert.equal(hurt.length,1);assert.equal(hurt[0],undead);assert.equal(j.update(),0);
  time=20000;assert.equal(j.isConsecrated(tile()),false);assert.equal(j.update(),0);
  j.restore(p,{liquid:'water',units:1});assert.equal(j.beginDodge(p,'ruin',false),false);assert.equal(j.beginDodge(p,'ruin',true),true);assert.equal(j.beginDodge(p,'ruin',true),false);assert.equal(j.getState(p).units,0);assert.equal(j.dodgeProtected(p,'ruin'),true);assert.equal(j.dodgeProtected(p,'farm'),false);
  assert.equal(j.dodgeTiles(p,'ruin',[tile(),tile(1),tile()]),2);assert.equal(j.dodgeTiles(p,'ruin',[tile(1),tile(2)]),1);j.endDodge(p);assert.equal(j.dodgeProtected(p,'ruin'),false);
  j.restore(p,{liquid:'water',units:99});assert.equal(j.getState(p).units,12);j.restore(p,{liquid:'lifeWater',units:NaN});assert.equal(j.getState(p).units,0);
  j.restore(p,{liquid:'lifeWater',units:2});const old=j.beginAction(p,'ruin','pour');assert.equal(j.resolveImpact(old,{area:'farm',tile:tile(0,0,0,'farm')}),null);assert.equal(j.resolveImpact(old,{area:'ruin',tile:tile()}),null);assert.equal(j.getState(enemy).units,0);
}
exercise(create,assert);
console.log('PASS adventuring jug rules, first impacts, floor isolation, consecration and paid rolls');
