#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('docs/js/animation-author-rig-carrier-preview.js', 'utf8'); // Test the production inverse carrier math.
const html = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8'); // Guard the browser-facing integration.
const avatarSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'); // The real NPC builder's +Z front and -Z back planes define correct portrait orientation.
class V { // Minimal Three.Vector3 stand-in for planar world poses.
  constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
  multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this;}
  applyQuaternion(q){const c=Math.cos(q.angle),s=Math.sin(q.angle),x=this.x,y=this.y;this.x=x*c-y*s;this.y=x*s+y*c;return this;}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
}
class Q { // Planar quaternion-angle adapter; composition and inversion preserve yaw-equivalent rotations.
  constructor(){this.angle=0;}
  setFromAxisAngle(axis,radians){assert.equal(axis.y,1,'portrait yaw rotates around world up');this.angle=radians;return this;}
  invert(){this.angle=-this.angle;return this;}
  multiply(q){this.angle+=q.angle;return this;}
}
class M { // Affine XY equivalent of THREE.Matrix4 for rotated/scaled parent and anchor hierarchies.
  constructor(a=1,b=0,c=0,d=1,x=0,y=0){Object.assign(this,{a,b,c,d,x,y});}
  clone(){return new M(this.a,this.b,this.c,this.d,this.x,this.y);}
  copy(m){return Object.assign(this,m);}
  multiplyMatrices(l,r){const a=l.a*r.a+l.c*r.b,b=l.b*r.a+l.d*r.b,c=l.a*r.c+l.c*r.d,d=l.b*r.c+l.d*r.d,x=l.a*r.x+l.c*r.y+l.x,y=l.b*r.x+l.d*r.y+l.y;return Object.assign(this,{a,b,c,d,x,y});}
  multiply(r){return this.multiplyMatrices(this.clone(),r);}
  premultiply(l){return this.multiplyMatrices(l,this.clone());}
  invert(){const {a,b,c,d,x,y}=this,n=a*d-b*c;if(!n)throw Error('singular');return Object.assign(this,{a:d/n,b:-b/n,c:-c/n,d:a/n,x:(c*y-d*x)/n,y:(b*x-a*y)/n});}
  decompose(pos,q,scale){pos.x=this.x;pos.y=this.y;pos.z=0;q.angle=Math.atan2(this.b,this.a);scale.x=Math.hypot(this.a,this.b);scale.y=Math.hypot(this.c,this.d);scale.z=1;return this;}
  compose(pos,q,scale){return this.copy(t(pos.x,pos.y,q.angle,scale.x,scale.y));}
}
function t(x,y,angle,sx,sy){const c=Math.cos(angle),s=Math.sin(angle);return new M(c*sx,s*sx,-s*sy,c*sy,x,y);}
function near(a,b,msg){assert(Math.abs(a-b)<1e-9,msg+': '+a+' vs '+b);}
function nearAngle(a,b,msg){near(Math.atan2(Math.sin(a-b),Math.cos(a-b)),0,msg);}
const w={};new Function('window',source)(w);
const solve=w.AnimationAuthorRigCarrierPreview.placeNpcAtGrip;
assert.equal(solve({THREE:{}}),false);
function check(grip,basis,body,perch,camera={position:{x:grip.x,z:5}}){ // Camera is varied only to verify that the NPC never billboards.
 const fixed=grip.clone(),worldParent={matrixWorld:basis,updateWorldMatrix(){}};
 const root={parent:worldParent,matrixAutoUpdate:true,matrix:new M(),
   updateMatrixWorld(){this.matrixWorld=worldParent.matrixWorld.clone().multiply(this.matrix);}};
 const visualOffset={matrix:body,updateMatrix(){}};
 const shoulderPerch={matrix:perch,scale:{x:Math.hypot(perch.a,perch.b)},updateMatrix(){}};
 const creatureGrip={matrixWorld:grip,updateWorldMatrix(){}};
 assert.equal(solve({THREE:{Matrix4:M,Quaternion:Q,Vector3:V},root,visualOffset,shoulderPerch,creatureGrip,camera}),true); // Intentionally pass camera to guard against restoring an unused billboard input.
 assert.equal(root.matrixAutoUpdate,false);
 const matched=root.matrixWorld.clone().multiply(body).multiply(perch);
 near(matched.x,grip.x,'fixed shoulder contact X');
 near(matched.y,grip.y,'fixed shoulder contact Y');
 const expectedYaw=0; // The ordinary NPC front (+Z) stays world-aligned as the camera orbits.
 nearAngle(Math.atan2(root.matrixWorld.b,root.matrixWorld.a),expectedYaw,'NPC portrait must NOT follow viewport camera or animal grip yaw');
 const localShoulder=body.clone().multiply(perch); // Socket rotation still belongs to the NPC, independently of the pet's chosen grip rotation.
 nearAngle(Math.atan2(matched.b,matched.a),Math.atan2(localShoulder.b,localShoulder.a),'socket orientation follows neither camera nor pet grip yaw');
 near(Math.hypot(root.matrixWorld.a,root.matrixWorld.b),1/shoulderPerch.scale.x,'NPC root uses reciprocal perch scale');
 near(Math.hypot(matched.a,matched.b),Math.hypot(body.a,body.b),'carrier body retains species size (not Small animal size)');
 for(const k of ['a','b','c','d','x','y'])near(grip[k],fixed[k],'animal grip unchanged '+k);
 return root.matrixWorld.clone();
}
const fixture={basis:t(1,2,.2,1.2,.9),body:t(0,.1,.15,1.4,1.4),perch:t(-.2,.6,1.15,.7,.7)};
const one=check(t(.2,-.3,.4,.35,.28),fixture.basis,fixture.body,fixture.perch);
const smallAgain=check(t(.2,-.3,.4,.15,.12),fixture.basis,fixture.body,fixture.perch);
for(const k of ['a','b','c','d','x','y'])near(one[k],smallAgain[k],'creature size cannot change NPC scale/pose '+k);
const turnedGrip=check(t(.2,-.3,.4+Math.PI,.35,.28),fixture.basis,fixture.body,fixture.perch); // Pet grip yaw must never affect carrier facing or contact.
for(const k of ['a','b','c','d','x','y'])near(one[k],turnedGrip[k],'animal grip rotation cannot rotate or relocate the owner '+k);
for(const [side,camera] of [['front',{position:{x:.2,z:4}}],['back',{position:{x:.2,z:-4}}],['right',{position:{x:4,z:0}}],['left',{position:{x:-4,z:0}}]]) {
 const turned=check(t(.2,-.3,1.4,.35,.28),fixture.basis,fixture.body,fixture.perch,camera);
 for(const key of ['a','b','c','d','x','y'])near(turned[key],one[key],'camera orbit '+side+' must not billboard/reposition NPC '+key);
}
const two=check(t(-.4,.8,-1.1,.3,.3),t(-1,.7,.8,.7,1.15),t(0,.12,-.2,.9,.9),t(-.13,.4,-.5,1.3,1.3));
assert.notDeepEqual(one,two,'switching species/gender changes the NPC placement');
assert.match(html,/applyCreatureSizeClass\(actor, 'small', \{ announce: false, render: false \}\)/,'grip selects Small size automatically');
assert.match(html,/shoulderCarrierRequestedV1553\?\.creatureId !== actor\.id/,'stale NPC build restarts after selection change');
assert.match(html,/shoulderCarrierPreviewV1553 = \{[\s\S]*?feet: null/,'preview ownership precedes optional leg construction');
assert.match(html,/shoulderCarrierStatusV1553\('NPC preview unavailable:/,'errors are mobile-visible');
assert.match(html,/perch\.rotation\.order = 'YXZ'/,'gameplay rotation order preserved');
assert.match(html,/rigWorldAxesV1553\.quaternion\.identity\(\)/,'world axes ignore local grip rotation');
assert.match(html,/controls\.setSpace\('world'\)/,'actual gizmo is world aligned');
assert.match(html,/window\.AnimationAuthorRigCarrierPreview\?\.placeNpcAtGrip/,'solver integrated');
assert.match(html,/animation-author-rig-carrier-preview\.js\?v=[A-Za-z0-9_-]+/,'browser loader must version the carrier helper without pinning an exact cache token');
assert.doesNotMatch(source,/cameraDX|cameraDZ|faceYaw|camera\?\.position|setFromAxisAngle/,'carrier math must not depend on camera direction');
const liveCarrierCall=html.slice(html.indexOf('function syncShoulderCarrierV1553()'),html.indexOf('function shoulderCarrierStatusV1553('));
assert.doesNotMatch(liveCarrierCall,/camera: state\.three\.camera/,'editor must not pass camera data to carrier placement');
assert.match(avatarSource,/function createSinglePlaneAssembly[\s\S]*?frontMesh\.position\.z = config\.anchorZ;[\s\S]*?backMesh\.rotation\.y = Math\.PI;/,'the normal NPC front plane looks toward +Z; only the back is 180° rotated');
assert.match(avatarSource,/frontMesh\.rotation\.y = Math\.PI \/ 2;/,'animal face plane uses a different +X orientation, not the NPC orientation');
assert.match(avatarSource,/let portraitsFlipped = true/,'the base PNGPlaneAvatar begins horizontally mirrored by default; it cannot substitute for a normal author NPC');
assert.match(html,/async function buildNpcNeckRig\(model, avatar, npc\)/,'standard NPC actor skinned compositor is available');
assert.match(html,/await buildNpcNeckRig\(model, avatar, npc\);[\s\S]{0,400}catch \(rigError\)/,'normal selectable NPCs use skinned portrait rendering');
const carrierStart=html.indexOf('async function buildShoulderCarrierV1553('); // Restrict the parity check to the temporary shoulder carrier, not another NPC builder.
const carrierEnd=html.indexOf('\nfunction syncRigWorldAxesV1553()',carrierStart);
assert(carrierStart>=0 && carrierEnd>carrierStart,'carrier builder is present in Animation Author');
const carrierSource=html.slice(carrierStart,carrierEnd);
assert.match(html,/const frontSource = canvasVariant\(avatar\.front\);[\s\S]{0,480}const frontTexture = makeRigTexture/,'the normal skinned portrait uses front art without the base texture flip state');
assert.match(html,/setAnimationAuthorMode = async function\(mode, \.\.\.args\)/,'mode exit clears temporary preview');
// The carrier perch must come from the same live skinned sourcePixel gameplay pins pets to,
// un-mirrored for the carrier's never-flipped portrait; stored x/y is only a fallback.
const resolvePerch=w.AnimationAuthorRigCarrierPreview.resolvePerchFromSourcePixel;
for(const flipped of [true,false]){
 const asked=[];
 const pos={x:9,y:9,z:9,copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}};
 const api={getPortraitsFlipped:()=>flipped,resolveSkinnedPortraitRoot:()=>({userData:{sourceCanvas:{width:200}}}),
  resolveSkinnedPixelWorldPosition:(model,pixel,out)=>{asked.push(pixel);return Object.assign(out,{x:pixel.x/100,y:pixel.y/100,z:.5});}};
 const visualOffset={worldToLocal:v=>({x:v.x*2,y:v.y*2,z:v.z*2})};
 assert.equal(resolvePerch({avatarApi:api,model:{},visualOffset,shoulderPerch:{position:pos},sourcePixel:{x:60,y:120},scratch:{copy(){}}}),true);
 assert.deepEqual(asked,[{x:flipped?140:60,y:120}],'carrier pixel cancels the shared resolver mirror (flipped='+flipped+')');
 near(pos.x,(flipped?140:60)/50,'perch x moved to skinned pixel');near(pos.y,120/50,'perch y moved to skinned pixel');
}
const untouched={x:1,y:2,z:3,copy(){throw Error('must keep stored x/y');}};
assert.equal(resolvePerch({avatarApi:{resolveSkinnedPixelWorldPosition(){return null;},resolveSkinnedPortraitRoot:()=>({userData:{sourceCanvas:{width:200}}})},model:{},visualOffset:{worldToLocal:v=>v},shoulderPerch:{position:untouched},sourcePixel:{x:1,y:1},scratch:{copy(){}}}),false,'unresolvable pixel keeps stored x/y');
assert.equal(resolvePerch({avatarApi:{},model:{},visualOffset:{worldToLocal:v=>v},shoulderPerch:{position:untouched},sourcePixel:null,scratch:{copy(){}}}),false,'missing pixel keeps stored x/y');
console.log('Animation Author inverse grip carrier regression passed');
assert.match(carrierSource, /buildSinglePlaneAvatarModel[\s\S]*?headCanvas: baseHead, neckRig: true/, 'preview builds the gameplay neck rig');
assert.match(carrierSource, /ShoulderPetAttachmentRuntime.create/, 'shared shoulder attachment solver is wired');
assert.match(liveCarrierCall, /solveSurfaceTransform[\s\S]*?grip.getWorldPosition/, 'gameplay solve is checked against the visible grip');
assert.doesNotMatch(carrierSource, /animationAuthor\.actors\.push\(/, 'carrier remains independent of saved actors');
