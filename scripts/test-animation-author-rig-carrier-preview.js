#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('docs/js/animation-author-rig-carrier-preview.js', 'utf8'); // Test production inverse placement.
const html = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8'); // Verify user-facing integration.
class M { // Affine XY matrix with the same multiply/invert calls as THREE.Matrix4.
  constructor(a=1,b=0,c=0,d=1,x=0,y=0) { Object.assign(this,{a,b,c,d,x,y}); }
  clone(){return new M(this.a,this.b,this.c,this.d,this.x,this.y);}
  copy(m){return Object.assign(this,m);}
  multiplyMatrices(l,r){const a=l.a*r.a+l.c*r.b,b=l.b*r.a+l.d*r.b,c=l.a*r.c+l.c*r.d,d=l.b*r.c+l.d*r.d,x=l.a*r.x+l.c*r.y+l.x,y=l.b*r.x+l.d*r.y+l.y;return Object.assign(this,{a,b,c,d,x,y});}
  multiply(r){return this.multiplyMatrices(this.clone(),r);}
  premultiply(l){return this.multiplyMatrices(l,this.clone());}
  invert(){const {a,b,c,d,x,y}=this;const n=a*d-b*c;if(!n)throw Error('singular');return Object.assign(this,{a:d/n,b:-b/n,c:-c/n,d:a/n,x:(c*y-d*x)/n,y:(b*x-a*y)/n});}
}
function t(x,y,angle,sx,sy){const c=Math.cos(angle),s=Math.sin(angle);return new M(c*sx,s*sx,-s*sy,c*sy,x,y);}
function near(a,b,msg){for(const k of ['a','b','c','d','x','y'])assert(Math.abs(a[k]-b[k])<1e-9,msg+' '+k+': '+a[k]+' vs '+b[k]);}
const w={};new Function('window',source)(w);
const solve=w.AnimationAuthorRigCarrierPreview.placeNpcAtGrip;
assert.equal(solve({THREE:{}}),false);
function check(grip,basis,body,perch){
 const fixed=grip.clone();
 const parent={matrixWorld:basis,updateWorldMatrix(){}};
 const root={parent,matrixAutoUpdate:true,matrix:new M(),updateMatrixWorld(){this.matrixWorld=parent.matrixWorld.clone().multiply(this.matrix);}};
 const visualOffset={matrix:body,updateMatrix(){}};
 const shoulderPerch={matrix:perch,updateMatrix(){}};
 const creatureGrip={matrixWorld:grip,updateWorldMatrix(){}};
 assert.equal(solve({THREE:{Matrix4:M},root,visualOffset,shoulderPerch,creatureGrip}),true);
 assert.equal(root.matrixAutoUpdate,false);
 near(root.matrixWorld.clone().multiply(body).multiply(perch),fixed,'rig joint correspondence');
 near(creatureGrip.matrixWorld,fixed,'animal anchor unchanged');
 return root.matrix.clone();
}
const one=check(t(.2,-.3,.4,.35,.28),t(1,2,.2,1.2,.9),t(0,.1,.15,1.4,1.4),t(-.2,.6,1.15,.7,.7));
const two=check(t(-.4,.8,-1.1,.3,.3),t(-1,.7,.8,.7,1.15),t(0,.12,-.2,.9,.9),t(-.13,.4,-.5,1.3,1.3));
assert.notDeepEqual(one,two,'different species+gender placements must differ');
assert.match(html,/applyCreatureSizeClass\(actor, 'small', \{ announce: false, render: false \}\)/,'grip automatically shows the Small pet');
assert.match(html,/shoulderCarrierRequestedV1553\?\.creatureId !== actor\.id/,'stale NPC build restarts for new animal');
assert.match(html,/shoulderCarrierPreviewV1553 = \{[\s\S]*?feet: null/,'preview resources are owned before leg build');
assert.match(html,/shoulderCarrierStatusV1553\('NPC preview unavailable:/,'mobile error is visible');
assert.match(html,/rigWorldAxesV1553\.quaternion\.identity\(\)/,'world axes do not inherit grip rotation');
assert.match(html,/controls\.setSpace\('world'\)/,'actual TransformControls gizmo is world-aligned');
assert.match(html,/window\.AnimationAuthorRigCarrierPreview\?\.placeNpcAtGrip/,'shared solver is used');
assert.match(html,/setAnimationAuthorMode = async function\(mode, \.\.\.args\)/,'leaving rig mode cleans up temporary model');
const extension=html.slice(html.indexOf('// V15.53'));
assert.doesNotMatch(extension,/animationAuthor\.actors\.push\(/,'temporary NPC never joins selectable actors');
console.log('Animation Author inverse grip carrier regression passed');
