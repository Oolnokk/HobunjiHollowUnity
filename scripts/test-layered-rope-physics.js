#!/usr/bin/env node
'use strict';
// Proves every generated shaft-wing rope chain can be traversed both ways
// using the exact RopeCore release flight and catch envelope as the live game.
const assert=require('assert');
const RopeCore=require('../docs/js/rope-core.js'); // Game's native swing/flight model.
const Plan=require('../docs/js/ruin-layer-plan.js'); // Generated story-side rooms and authored challenge tags.
const Challenges=require('../docs/js/ruin-layer-challenges.js'); // Shared room-to-abyss footprint calculation.
const DT=1/60; // Fixed timestep used by the native V50 rope reachability predictor.
const SEEDS=220; // Representative deterministic seeded rooms for both-direction geometry regressions.

function ropeFor(pit,side,floorY,index,count,reverse=false) {
  const alongX=pit.axis==='x',forward=side==='E'||side==='S';
  const length=alongX?pit.maxX-pit.minX:pit.maxZ-pit.minZ;
  const start=alongX?(forward?pit.minX:pit.maxX):(forward?pit.minZ:pit.maxZ);
  const along=start+(forward?1:-1)*(.5+(length-1)*index/(count-1));
  const yaw=Math.atan2(side==='S'?1:side==='N'?-1:0,side==='E'?1:side==='W'?-1:0);
  const anchor={x:alongX?along:(pit.minX+pit.maxX)/2,
    y:floorY+3.35,z:alongX?(pit.minZ+pit.maxZ)/2:along};
  return RopeCore.create({anchor,yaw:yaw+(reverse?Math.PI:0),length:2.43,maxLength:2.55});
}
function catches(rope,point) {
  const bob=RopeCore.bobAt(rope),a=rope.anchor;
  const dx=bob.x-a.x,dy=bob.y-a.y,dz=bob.z-a.z,squared=dx*dx+dy*dy+dz*dz;
  if(squared<1e-6)return false;
  const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy+(point.z-a.z)*dz)/squared));
  if(t*Math.sqrt(squared)<RopeCore.MIN_LENGTH-.05)return false;
  return Math.hypot(point.x-a.x-dx*t,point.y-a.y-dy*t,point.z-a.z-dz*t)<=RopeCore.AIR_CATCH_RADIUS;
}
function flightCanReach(start,goal,floorY) {
  const f={...start}; // Ballistic launch snapshot from RopeCore.releaseFlight.
  for(let step=0;step<180;step++){
    f.vy-=RopeCore.GRAVITY*DT;f.x+=f.vx*DT;f.y+=f.vy*DT;f.z+=f.vz*DT;
    if(goal.rope&&catches(goal.rope,f))return true;
    if(goal.bank&&f.vy<=0&&f.y<=floorY+.08&&f.y>=floorY-.24
      &&Math.abs(f.x-goal.bank.x)<=goal.bank.width*.5-.15
      &&Math.abs(f.z-goal.bank.z)<=goal.bank.depth*.5-.15)return true;
    if(f.y<floorY-.2)return false; // Touching the abyss kills; do not allow an imaginary below-ground launch.
  }
  return false;
}
function landingFor(pit,side,room,reverse=false){
  const alongX=pit.axis==='x',forward=side==='E'||side==='S',direction=forward?1:-1;
  const entry=alongX?(forward?pit.minX:pit.maxX):(forward?pit.minZ:pit.maxZ);
  const exit=alongX?(forward?pit.maxX:pit.minX):(forward?pit.maxZ:pit.minZ);
  const endpoint=reverse?entry:exit; // A reverse release must land on the original START bank, not on the far bank again.
  const target=endpoint+(reverse?-direction:direction)*.8;
  return {x:alongX?target:(pit.minX+pit.maxX)/2,
    z:alongX?(pit.minZ+pit.maxZ)/2:target,
    width:alongX?2.2:Math.min(room.w,3),
    depth:alongX?Math.min(room.d,3):2.2};
}
function reachable(from,goal,floorY){
  return RopeCore.reachAmplitude(from,start=>flightCanReach(start,goal,floorY),{
    maxAmp:1.15,minAmp:.55,
  });
}

let rooms=0,links=0,landings=0; // Proof totals reported by this runner for mobile CI summaries.
for(let seed=1;seed<=SEEDS;seed++){
  const plan=Plan.compose({seed,anchorX:192,anchorZ:192});
  assert(plan.ok,'layer plan '+seed+' must pass its own spatial constraints');
  for(const floor of plan.floors)for(const wing of floor.wings)for(const room of wing.rooms){
    if(room.challenge!=='ropeChain')continue;
    rooms++;
    const pit=Challenges.ropePitForRoom(room,wing.side);
    assert(pit,'a generated rope room needs two supported banks');
    const length=pit.axis==='x'?pit.maxX-pit.minX:pit.maxZ-pit.minZ;
    const count=Math.max(3,Math.min(8,Math.ceil((length-1)/2.25)+1));
    const ropes=Array.from({length:count},(_,i)=>ropeFor(pit,wing.side,floor.y,i,count));
    for(const rope of ropes){
      assert(pit.contains(rope.anchor.x,rope.anchor.z),
        'a rope must actually hang over the physical gap, not a phantom floor: '+room.id);
    }
    for(const reverse of [false,true]){
      const ordered=reverse?ropes.map((_,i)=>ropeFor(pit,wing.side,floor.y,count-1-i,count,true)):ropes;
      for(let i=0;i<ordered.length-1;i++){
        const amp=reachable(ordered[i],{rope:ordered[i+1]},floor.y-.4);
        assert(amp!==null,'native rope flight cannot catch the next rope: '+room.id+' '+(reverse?'back':'out')+' #'+i);
        links++;
      }
      const bank=landingFor(pit,wing.side,room,reverse);
      const amp=reachable(ordered.at(-1),{bank},floor.y);
      assert(amp!==null,'last rope cannot land safely on the real bank: '+room.id+' '+(reverse?'back':'out'));
      landings++;
    }
  }
}
assert(rooms>0,'seeds must exercise some actual authored rope rooms');
console.log('ok layered rope physics: '+SEEDS+' seeds, '+rooms+' abysses, '+links+' native catches, '+landings+' safe bank landings');
