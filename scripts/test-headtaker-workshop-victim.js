'use strict';
// Runs the real workshop preview class against a deterministic bandit factory
// and a spy for the real Headtaker combat API; no browser or Unity required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/tools/enemy-loadout-editor/preview.js', 'utf8');
const app = fs.readFileSync('docs/tools/enemy-loadout-editor/app.js', 'utf8');
for (const file of ['combat-animal-attacks.js','combat-attach.js','combat-maskbound-headtaker.js']) {
  assert(source.includes(file), 'workshop must load ' + file);
}
assert(app.includes("await preview.play($('attackChoice').value)"));
assert(app.includes("$('scrub').onchange"), 'fast mobile scrubs commit on release');
class V {
  constructor(x=0,y=0,z=0) { this.set(x,y,z); }
  set(x,y,z) { Object.assign(this,{x,y,z}); return this; }
  copy(v) { return this.set(v.x,v.y,v.z); }
  clone() { return new V(this.x,this.y,this.z); }
}
let count=0, ticks=0, waited=0;
const kinds=[];
const window={
  EnemyLoadoutSourceData:{
    async spawn(kind) {
      kinds.push(kind);
      return {
        id:'bandit'+(++count), name:'Test '+kind, health:100, maxHealth:100, halfHeight:0.5,
        avatarRef:{group:{position:new V(),rotation:{y:0},visible:true,updateWorldMatrix(){}},frontPlane:{rotation:{y:0}},backPlane:{rotation:{y:0}},legs:{update(){}}},
        groundShadow:{position:new V()},
      };
    },
  },
  MaskboundHeadtaker:{
    tuning:{leapS:1.15,reversiblePullS:1.5,repetitions:2,finalPullS:3,throwS:1.3}, // Shorter terminal pitch is reflected in workshop total duration and phase boundaries.
    cancel(){}, async headArtReady(){waited++;return true;},
    update(enemy,dt,victim){ticks++; assert(victim.id.startsWith('bandit')); if(ticks>23)enemy._attachment={stage:'attached'};},
  },
};
const ThreeModule={Vector3:V};
const context=vm.createContext({window,ThreeModule,OrbitControls:class{}});
const code=source.replace(/^import[^\n]+\n/gm,'').replace('export class EnemyPreview','class EnemyPreview');
const EnemyPreview=vm.runInContext(code+'\nEnemyPreview;',context);
const logs=[],removed=[];
const preview=new EnemyPreview({},text=>logs.push(text));
preview.fit=()=>{};
preview.discard=v=>removed.push(v.id);
preview.data={};preview.textureTasks=[];
preview.dependencies={TILE:55,hostileObjects:[]};
preview.actor={
  maskboundTroop:'headtaker',health:99,maxHealth:99,halfHeight:0.6,banditTier:0,
  def:{moveSpeed:1,chaseSpeed:2},
  avatarRef:{group:{position:new V(),rotation:{y:0},visible:true},frontPlane:{rotation:{y:0}},backPlane:{rotation:{y:0}},legs:{update(){}},handRigAvatarRoot:{userData:{proceduralHandRig:{applyOwnedPose(){}}}}},
  groundShadow:{position:new V()},
};
(async()=>{
  await preview.play('skyfallHeadGrip');
  assert(/^bandit:(grunt|lieutenant|captain)$/.test(kinds[0]));
  assert.equal(preview.dependencies.hostileObjects.length,2);
  assert.equal(preview.attack.victim,preview.headtakerVictim);
  assert.equal(preview.actor.avatarRef.group.rotation.y,-Math.PI/2,'Headtaker front portrait faces the +Z workshop camera');
  assert.equal(preview.headtakerVictim.avatarRef.group.rotation.y,-Math.PI/2,'random victim front portrait also faces the +Z workshop camera');
  assert(source.includes('center.y + distance * 0.025'),'Headtaker camera frames the portraits almost straight on');
  preview.stepHeadtakerAttack(.05);
  assert(ticks>0,'real controller is called');
  const first=preview.headtakerVictim;
  await preview.play('skyfallHeadGrip');
  assert(removed.includes(first.id),'old victim disposed');
  assert.equal(preview.dependencies.hostileObjects.length,2);
  await preview.play('skyfallHeadGrip',.85,true);
  assert(preview.attack?.frozen && preview.attack.elapsed>6,'real shortened timeline was scrubbed');
  assert(preview.attack.duration < 9,'three-second third pull shortens workshop duration');
  assert(source.includes('FINAL PULL · NECK PITCH'),'workshop reports neck-pitch phase');
  assert(waited>0,'asynchronous head art awaited');
  preview.clearHeadtakerVictim();
  assert.equal(preview.dependencies.hostileObjects.length,1);
  assert.equal(removed.length,3);
  assert(logs.some(v=>v.includes('Headtaker attacking generated')));
  console.log('PASS Headtaker workshop random victim / real combat / replay / scrub / cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
