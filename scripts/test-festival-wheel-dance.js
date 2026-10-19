#!/usr/bin/env node
'use strict';
// Executes the shipped two-avatar Festival Wheel Dance against minimal Three-compatible
// vector/quaternion objects. No WebGL or browser environment required.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  copy(v){return this.set(v.x,v.y,v.z);}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  toArray(){return [this.x,this.y,this.z];}
  applyQuaternion(q){
    const {x,y,z}=this,{x:qx,y:qy,z:qz,w:qw}=q;
    const ix=qw*x+qy*z-qz*y,iy=qw*y+qz*x-qx*z,iz=qw*z+qx*y-qy*x,iw=-qx*x-qy*y-qz*z;
    return this.set(ix*qw+iw*-qx+iy*-qz-iz*-qy,iy*qw+iw*-qy+iz*-qx-ix*-qz,iz*qw+iw*-qz+ix*-qy-iy*-qx);
  }
}
class Quaternion {
  constructor(x=0,y=0,z=0,w=1){this.x=x;this.y=y;this.z=z;this.w=w;}
  clone(){return new Quaternion(this.x,this.y,this.z,this.w);}
  copy(q){Object.assign(this,q);return this;}
  setFromAxisAngle(a,r){const s=Math.sin(r/2);return this.copy({x:a.x*s,y:a.y*s,z:a.z*s,w:Math.cos(r/2)});}
  multiply(q){
    const a=this,b=q;
    const result={
      x:a.x*b.w+a.w*b.x+a.y*b.z-a.z*b.y,
      y:a.y*b.w+a.w*b.y+a.z*b.x-a.x*b.z,
      z:a.z*b.w+a.w*b.z+a.x*b.y-a.y*b.x,
      w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z,
    }; return this.copy(result);
  }
}
const THREE={Vector3,Quaternion}; // Implemented only for geometry testing of the actual browser module.
let releaseCount=0;
const window={THREE,CharacterActionLocks:{acquire(opts){assert.deepEqual(
  opts.participants.map(p=>p.id),['player','sloomi']);return {release(){releaseCount++;}};
}}};
const ctx=vm.createContext({window,performance:{now:()=>1000},console});
vm.runInContext(fs.readFileSync('docs/js/festival-wheel-dance-runtime.js','utf8'),ctx);
const api=window.FestivalWheelDanceRuntime;
const close=(a,b,eps=1e-6)=>Math.abs(a-b)<eps;
const approx=(a,b)=>{assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert(close(a[i],b[i]),`coordinate ${i}: ${a[i]} vs ${b[i]}`);};
const first=api.sample(0),quarter=api.sample(1),half=api.sample(2),full=api.sample(4);
assert(close(first.radius,0.2006));
assert(close(first.spin,0)&&close(quarter.spin,Math.PI)&&close(half.spin,Math.PI*2));
assert(close(full.spin,0),'four-second authored wheel loops cleanly');
assert(close(api.sample(.5).tilt,0),'four tilt oscillations per four seconds');
assert(close(api.sample(.25).tilt,22*Math.PI/180),'authored tilt-jump reaches twenty-two degrees');
const node=(x,z)=>({parent:{},position:new Vector3(x,0,z),quaternion:new Quaternion(),updateMatrix(){this.matrixRefresh=(this.matrixRefresh||0)+1;}});
const player=node(20,30),partner=node(20.6,30.3),walker={rec:{id:'sloomi'},area:'town',root:partner};
const originalP=player.position.clone(),originalN=partner.position.clone(),originalPQ=player.quaternion.clone();
assert.equal(api.start(walker,player),true);
assert.equal(api.start(walker,player),false,'second simultaneous pair must not overwrite original transforms');
assert(api.activeFor('sloomi')&&api.isPartner(walker));
assert.equal(api.diagnostics().authorRevolutions,2);
const atStart=player.position.toArray();
assert(close(Math.hypot(player.position.x-partner.position.x,player.position.z-partner.position.z),.4012),
  'the two avatars start opposite one another at the authored separation');
api.update(.5,true,'town');
assert.equal(api.elapsedSeconds('sloomi'),0,'pause does not advance the dance or reward clock');
for(let i=0;i<80;i++)api.update(.05,false,'town');
assert(close(api.elapsedSeconds('sloomi'),4),'the paired runtime counts precisely four seconds of rendered simulation');
approx(player.position.toArray(),atStart);
assert(close(Math.hypot(player.position.x-partner.position.x,player.position.z-partner.position.z),.4012));
api.update(.05,false,'interior');
assert.equal(api.activeFor('sloomi'),false,'leaving the town cancels the pair');
approx(player.position.toArray(),originalP.toArray());approx(partner.position.toArray(),originalN.toArray());
assert.equal(releaseCount,1,'synchronized interaction releases its lock exactly once');
assert.equal(api.stop('again'),false,'canceling an inactive pair is idempotent');
assert.deepEqual(player.quaternion.clone(),originalPQ,'original player root orientation is restored');
assert.equal(api.diagnostics().lastStopReason,'partner-or-scene-gone');
assert.equal(api.start(walker,player),true);
walker.root.parent=null;
api.update(.05,false,'town');
assert.equal(api.diagnostics().active,false,'unloaded NPC safely ends the animation');
assert.equal(releaseCount,2,'NPC unload also releases action locks');
const game=fs.readFileSync('docs/game.js','utf8');
const festival=fs.readFileSync('docs/js/festival-system.js','utf8');
const index=fs.readFileSync('docs/index.html','utf8');
assert(game.includes('if (window.FestivalWheelDanceRuntime?.isPartner?.(w)) continue;'),'NPC pathfinding is paused only while this NPC is the dance partner');
assert(game.includes("window.FestivalWheelDanceRuntime?.update?.(dt,paused,currentArea);"),'animation sync occurs after player/NPC visuals update');
assert(game.includes('getPlayerMesh: () => playerMesh'),'real player root is available to the gameplay subsystem');
assert(festival.includes('window.FestivalWheelDanceRuntime?.start?.(walker,deps.getPlayerMesh?.())'),'NPC dance invitation starts two-avatar playback');
assert(festival.includes('elapsedSeconds?.(dance.targetNpcId)'),'Festival Fun uses actual played animation seconds');
assert(!festival.includes("if(dance||!prop||!window.SocialActionWheel?.startDance"),'NPC paired dance no longer invokes solo fallback');
assert(index.includes('js/festival-wheel-dance-runtime.js'),'the paired runtime is loaded before the core game');
console.log('Festival Wheel Dance: author curves, two live roots, paired motion, pause, cleanup, reward clock and integration passed.');
