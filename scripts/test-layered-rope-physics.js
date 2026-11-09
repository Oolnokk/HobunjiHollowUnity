#!/usr/bin/env node
'use strict';
// Verify both directions of every generated zigzag using the real RopeCore release/catch
// equations, unbuffed player steering, and the exact room/anchor geometry used in game.
const assert=require('node:assert/strict');
const RopeCore=require('../docs/js/rope-core.js');
const Motion=require('../docs/js/player-air-motion-config.js');
const Geometry=require('../docs/js/ruin-rope-geometry.js');
const Plan=require('../docs/js/ruin-layer-plan.js');
const Challenges=require('../docs/js/ruin-layer-challenges.js');
const DT=1/60; // Same fixed integration step as the live V50 rope-flight predictor.
const SEEDS=220; // Multiple seeded layouts must not introduce impossible cross-axis gaps.
const STEERING=Motion.BASE.airTilesPerSecond*Motion.BASE.ropeSteerFactor; // Unbuffed new player.

function ropeFor(anchor,side,reverse=false){
  const yaw=Math.atan2(side==='S'?1:side==='N'?-1:0,side==='E'?1:side==='W'?-1:0);
  return RopeCore.create({anchor:{...anchor},yaw:yaw+(reverse?Math.PI:0),length:Geometry.ROPE_LENGTH,maxLength:Geometry.MAX_LENGTH});
}
function catches(rope,point){
  const bob=RopeCore.bobAt(rope),a=rope.anchor;
  const dx=bob.x-a.x,dy=bob.y-a.y,dz=bob.z-a.z,squared=dx*dx+dy*dy+dz*dz;
  if(squared<1e-6)return false;
  const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy+(point.z-a.z)*dz)/squared));
  if(t*Math.sqrt(squared)<RopeCore.MIN_LENGTH-.05)return false;
  return Math.hypot(point.x-a.x-dx*t,point.y-a.y-dy*t,point.z-a.z-dz*t)<=RopeCore.AIR_CATCH_RADIUS;
}
function flightCanReach(start,goal,floorY){
  const f={...start};
  const target=goal.rope?.anchor||goal.bank;
  for(let step=0;step<180;step++){
    // A beginner can aim normal airborne movement toward the next sideways rope.
    // Never use potion multipliers or an invented sideways fling in this proof.
    const dx=target.x-f.x,dz=target.z-f.z,mag=Math.hypot(dx,dz);
    const sx=mag>1e-6?STEERING*dx/mag:0,sz=mag>1e-6?STEERING*dz/mag:0;
    f.vy-=RopeCore.GRAVITY*DT;
    f.x+=(f.vx+sx)*DT;f.y+=f.vy*DT;f.z+=(f.vz+sz)*DT;
    if(goal.rope&&catches(goal.rope,f))return true;
    if(goal.bank&&f.vy<=0&&f.y<=floorY+.08&&f.y>=floorY-.24
      &&Math.abs(f.x-goal.bank.x)<=goal.bank.width*.5-.15
      &&Math.abs(f.z-goal.bank.z)<=goal.bank.depth*.5-.15)return true;
    if(f.y<floorY-.2)return false;
  }
  return false;
}
function landingFor(pit,side,room,reverse=false){
  const alongX=pit.axis==='x',forward=side==='E'||side==='S',dir=forward?1:-1;
  const start=alongX?(forward?pit.minX:pit.maxX):(forward?pit.minZ:pit.maxZ);
  const finish=alongX?(forward?pit.maxX:pit.minX):(forward?pit.maxZ:pit.minZ);
  const pos=(reverse?start:finish)+(reverse?-dir:dir)*.8;
  return {x:alongX?pos:(pit.minX+pit.maxX)/2,
    z:alongX?(pit.minZ+pit.maxZ)/2:pos,
    width:alongX?2.2:Math.min(room.w,3),
    depth:alongX?Math.min(room.d,3):2.2};
}
function reachable(from,goal,floorY,limit=1.15){
  return RopeCore.reachAmplitude(from,start=>flightCanReach(start,goal,floorY),{maxAmp:limit,minAmp:.55});
}
let rooms=0,links=0,landings=0,variations=new Set();
for(let seed=1;seed<=SEEDS;seed++){
  const plan=Plan.compose({seed,anchorX:192,anchorZ:192});
  assert(plan.ok,'layer plan '+seed+' must pass its spatial constraints');
  for(const floor of plan.floors)for(const wing of floor.wings)for(const room of wing.rooms){
    if(room.challenge!=='ropeChain')continue;
    rooms++;
    const pit=Challenges.ropePitForRoom(room,wing.side);
    assert(pit,'generated rope room must fit its baseline swing footprint: '+room.id);
    const anchors=Geometry.anchors(pit,wing.side,room.id,seed).map(p=>({...p,y:floor.y+Geometry.ANCHOR_RISE}));
    const ropes=anchors.map(p=>ropeFor(p,wing.side));
    assert.equal(ropes.length,Geometry.COUNT);
    const crossCenter=pit.axis==='x'?(pit.minZ+pit.maxZ)/2:(pit.minX+pit.maxX)/2;
    const halfWidth=(pit.axis==='x'?pit.maxZ-pit.minZ:pit.maxX-pit.minX)/2;
    for(let i=0;i<ropes.length;i++){
      const r=ropes[i],cross=pit.axis==='x'?r.anchor.z:r.anchor.x;
      assert(pit.contains(r.anchor.x,r.anchor.z),'rope hangs within the pit: '+room.id);
      assert(Math.abs(cross-crossCenter)+Geometry.ROPE_LENGTH*Math.sin(RopeCore.MAX_ANGLE)+RopeCore.COLLISION_RADIUS<halfWidth,
        'clear wall margin remains for pumping sideways/back: '+room.id);
      if(i>0){
        const prior=ropes[i-1].anchor,distance=Math.hypot(r.anchor.x-prior.x,r.anchor.z-prior.z);
        assert(distance<=Geometry.MAX_NEIGHBOR_DISTANCE+1e-5,'neighbor clamp exceeds baseline reach: '+room.id);
      }
    }
    assert.equal(pit.axis==='x'?anchors[0].z:anchors[0].x,crossCenter,'first anchor remains centered');
    assert.equal(pit.axis==='x'?anchors.at(-1).z:anchors.at(-1).x,crossCenter,'last anchor remains centered');
    variations.add(anchors.map(p=>(pit.axis==='x'?p.z:p.x).toFixed(2)).join(':'));
    // A baseline new player should NOT clear the abyss directly from the first rope.
    assert.equal(reachable(ropes[0],{bank:landingFor(pit,wing.side,room)},floor.y,1.28),null,
      'first rope must not bypass the whole chain: '+room.id);
    for(const reverse of [false,true]){
      const ordered=reverse?anchors.slice().reverse().map(p=>ropeFor(p,wing.side,true)):ropes;
      for(let i=0;i<ordered.length-1;i++){
        const amp=reachable(ordered[i],{rope:ordered[i+1]},floor.y-.4);
        assert(amp!==null,'new player cannot catch zigzag rope: '+room.id+' '+(reverse?'back':'out')+' #'+i);
        links++;
      }
      const bank=landingFor(pit,wing.side,room,reverse);
      assert(reachable(ordered.at(-1),{bank},floor.y)!==null,
        'new player cannot reach final bank: '+room.id+' '+(reverse?'back':'out'));
      landings++;
    }
  }
}
assert(rooms>0,'seeds must exercise actual authored rope rooms');
assert(variations.size>2,'seeds must produce distinct lateral zigzags');
const before=Geometry.snapshot();
Motion.multipliers.jumpHeight=3;Motion.multipliers.slowFall=.3;
assert.deepEqual(Geometry.snapshot(),before,'future food/potion multipliers must not resize generated rooms');
console.log('ok derived layered rope physics: '+SEEDS+' seeds, '+rooms+' zigzags, '+links+' native catches, '+landings+' landings');
