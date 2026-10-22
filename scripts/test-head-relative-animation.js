'use strict';
const assert = require('node:assert/strict'); // Checks production head-anchor and pose sampling behavior.
const fs = require('node:fs'); // Loads the shared production module in an isolated browser realm.
const vm = require('node:vm'); // Keeps globals out of other regression tests.
const context = { window: {} }; // Minimal browser realm for the dependency-free pose module.
vm.runInNewContext(fs.readFileSync('docs/js/combat/shared-attack-pose.js', 'utf8'), context);
const api = context.window.SharedAttackPose; // Production pose API under test.
const point = { set(x,y,z) { this.x=x; this.y=y; this.z=z; return this; } }; // Caller-owned scratch: the helper must never replace it.
const root = { updateWorldMatrix() {}, worldToLocal(p) { p.x-=10; p.y-=20; p.z-=30; return p; } }; // Actor's translated root.
const neckJoint = { updateWorldMatrix() {}, localToWorld(p) { p.x+=10; p.y+=21; p.z+=30; return p; } }; // Visible neck after hierarchy/world transforms.
const avatar = { userData: { neckRig: { available:true, headCentroidLocal:{x:0.1,y:0.3,z:0}, neckLocal:{x:0,y:0.1,z:0}, neckJoint } } }; // Nonzero head centroid ensures the neck itself is not mistaken for the head.
assert.equal(api.headAnchor(point,avatar,root),true);
assert(Math.abs(point.x-0.1)<1e-9 && Math.abs(point.y-1.2)<1e-9 && point.z===0);
neckJoint.localToWorld = p => { const x=p.x; p.x=10-p.z; p.y+=21; p.z=30+x; return p; }; // A turned head must carry the centroid with it.
api.headAnchor(point,avatar,root);
assert(Math.abs(point.x)<1e-9 && Math.abs(point.z-0.1)<1e-9);
assert.equal(api.headAnchor(point,null),false);
const fallback = { userData:{portraitModelHeight:2}, updateWorldMatrix(){}, localToWorld:p=>p }; // Missing sprite/rig falls back safely to the model's head region.
api.headAnchor(point,fallback);
assert.equal(point.y,0.6);
const sample = api.createSample(); // Reused result verifies reference-frame state never leaks into the next swing.
api.samplePose(sample,{neutral:{headRelative:true}},api.STYLE_NEUTRAL_POSE.ranged,0,0.2,0.4,0.6);
assert.equal(sample.headRelative,true);
api.samplePose(sample,{},api.STYLE_NEUTRAL_POSE.ranged,0,0.2,0.4,0.6);
assert.equal(sample.headRelative,false);
console.log('head-relative animation anchors and reused samples PASS');
