'use strict';
// Omgurku hostiles keep their compound rider+quadruped hierarchy, and their
// world-space weapon holders are re-based onto the mounted rider's floor.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/js/combat/combat-bandit.js','utf8'); // Execute the production avatar factory and mount helper.
const factory=source.slice(source.indexOf('  async function buildBanditAvatar('),source.indexOf('  function copyBanditExpressionCanvas('));
class Vec{constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}setScalar(v){return this.set(v,v,v);}multiplyScalar(v){return this.set(this.x*v,this.y*v,this.z*v);}}
class Group{constructor(){this.children=[];this.parent=null;this.position=new Vec();this.rotation=new Vec();this.scale=new Vec(1,1,1);this.userData={};}
  add(child){child.parent?.remove(child);child.parent=this;this.children.push(child);return this;}
  getWorldPosition(target){target.set(this.position.x,this.position.y,this.position.z);for(let parent=this.parent;parent;parent=parent.parent){target.x*=parent.scale.x;target.y*=parent.scale.y;target.z*=parent.scale.z;const cos=Math.cos(parent.rotation.y),sin=Math.sin(parent.rotation.y),x=target.x,z=target.z;target.x=x*cos+z*sin;target.z=-x*sin+z*cos;target.x+=parent.position.x;target.y+=parent.position.y;target.z+=parent.position.z;}return target;}
  remove(child){this.children=this.children.filter(c=>c!==child);if(child.parent===this)child.parent=null;return this;}}
const upper=new Group();upper.position.set(.1,.31,.4);upper.scale.setScalar(.885);
upper.userData={portraitModelHeight:.9,portraitModelWidth:.9,handAttachX:-.3,handAttachY:.5,armLength:.4};
const riderFrame=new Group();riderFrame.position.y=-.45;upper.add(riderFrame);
const portrait=new Group();portrait.add(upper);
portrait.userData={proceduralBodyRoot:upper,proceduralHandParent:riderFrame,omgurkuComposite:{},speciesId:'omgurku',gender:'male'};
let disposed=[];
const profile={fighter:{speciesId:'omgurku',gender:'male'},bodyColors:{}};
const context={window:{NpcAvatarPreview:{ensurePortraitCosmetics:async()=>{},buildProfileFromNpcExport:()=>profile,renderProfileToCanvas:async()=>{}},
  PNGPlaneAvatar:{buildSinglePlaneAvatarModel:()=>portrait,disposeAvatarModel:value=>disposed.push(value)}},
  document:{createElement:()=>({getContext:()=>({drawImage(){}})})},THREE:{Group},COMBAT_FROWN_COMPOSER:{},
  characterBuildStatus:{},ensureEnemyPants:()=>null,applyRosterDyesToProfile:()=>({})};
vm.createContext(context);vm.runInContext(factory+';this.build=buildBanditAvatar;this.mount=applyRiderMount;',context);
(async()=>{
  const ref=await context.build({appearance:{speciesId:'omgurku',gender:'male'}});
  assert.equal(portrait.parent,ref.frontPlane,'the whole compound rides the front pivot that facing/death rotate');
  assert.equal(ref.backPlane.children.length,0,'no second rigid plane is extracted from the rider');
  assert.equal(portrait.position.y,-.45,'compound floor origin sits at the center-anchored hostile floor');
  assert.equal(ref.textureRoot,upper,'combat frown refreshes the rider portrait textures');
  assert.equal(ref.handRigAvatarRoot,portrait,'procedural hands keep driving through the compound root');
  assert.equal(portrait.userData.proceduralHandParent,riderFrame,'hands stay parented to the mounted rider frame');
  assert.equal(ref.legs,null,'no humanoid feet are attached to the quadruped');
  // Facing 0: no yaw, so rider X/Z offsets add directly; pose offsets scale by the rider scale about the floor.
  const c={avatarRef:ref,halfHeight:.45};ref.group.position.set(10,.45,20);
  const holder=new Group();holder.position.set(10+.2,.5,20+.1);
  const riderWorld=new Vec();riderFrame.getWorldPosition(riderWorld);
  assert.equal(context.mount(c,holder),true);
  const near=(a,b)=>Math.abs(a-b)<1e-9;
  assert(near(holder.position.x,riderWorld.x+.2*.885),'lateral rider offset plus scaled pose');
  assert(near(holder.position.y,riderWorld.y+.5*.885),'pose height re-based on the saddle floor');
  assert(near(holder.position.z,riderWorld.z+.1*.885),'forward saddle offset plus scaled pose');
  assert(near(holder.scale.x,.885),'weapon shrinks with the rider');
  // A quarter turn swaps the compound's local X/Z into world axes.
  ref.group.rotation.y=Math.PI/2;holder.position.set(10,.45,20);holder.scale.setScalar(1);context.mount(c,holder);
  const turnedRiderWorld=new Vec();riderFrame.getWorldPosition(turnedRiderWorld);
  assert(near(holder.position.x,turnedRiderWorld.x),'forward offset follows the compound yaw');
  assert(near(holder.position.z,turnedRiderWorld.z),'lateral offset follows the compound yaw');
  assert.equal(context.mount({avatarRef:{group:ref.group}},holder),false,'ordinary humanoids are untouched');
  ref.dispose();
  assert.deepEqual(disposed,[portrait,ref.group],'compound root is released through its own disposer');
  console.log('Omgurku hostile compound avatar passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
