#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Verifies PNG depth replay ignores temporary hidden NPC parents.
const fs = require('node:fs'); // Runs the actual registered-mesh occluder implementation.
const source = fs.readFileSync('docs/js/png-plane-outline-occluder.js','utf8'); // Authoritative game code.
const windowLike = {};
const THREE = {LessEqualDepth:3};
new Function('window','THREE',source)(windowLike,THREE);
const api=windowLike.PngPlaneOutlineOccluder;
assert(api,'PNG depth adapter is initialized');
let renders=0;
let matrixRefreshes=0; // Verifies the selective transform refresh without walking the whole scene.
const camera={layers:{mask:1,set(n){this.mask=1<<n;}}};
api.init({camera,renderer:{render(scene,view){renders++;assert.equal(view.layers.mask,16,'only PNG depth layer renders');assert.equal(scene.autoUpdate,false,'depth replay skips a redundant whole-scene matrix update');}}});

const scene={isScene:true,visible:true,parent:null,autoUpdate:true};
const npcRoot={visible:false,parent:scene};
const mesh={isMesh:true,visible:true,parent:npcRoot,userData:{},
  updateWorldMatrix(updateParents,updateChildren){matrixRefreshes++;assert.equal(updateParents,true);assert.equal(updateChildren,false);}, // Refresh only visible PNG participants and their ancestor transforms.
  layers:{mask:1,enable(n){this.mask|=1<<n;}},
  material:{colorWrite:true,depthWrite:false,depthTest:false,depthFunc:2,alphaTest:.12,map:{}},
}; // NPC's actual PNG mesh remains visible while the whole actor root is render-hidden.
api.registerDepthMesh(mesh);
api.renderDepth(scene);
assert.equal(renders,0,'a hidden parent prevents unnecessary PNG depth render');
assert.equal(matrixRefreshes,0,'a hidden actor never incurs a transform refresh');
assert.equal(api.snapshot().registered,1,'render-only hiding never permanently unregisters the NPC portrait');
assert.equal(mesh.material.depthWrite,false,'materials remain unchanged when every NPC is hidden');

npcRoot.visible=true;
api.renderDepth(scene);
assert.equal(renders,1,'the same NPC portrait immediately resumes its depth occlusion when re-exposed');
assert.equal(matrixRefreshes,1,'the visible participant refreshes its world transform once');
assert.equal(scene.autoUpdate,true,'the colour and shell passes retain their usual scene update policy');
assert.equal(mesh.material.depthWrite,false,'the temporary depth-writing override is restored');
assert.equal(mesh.material.colorWrite,true,'the original color-writing flag is restored');
assert.equal(mesh.material.alphaTest,.12,'the original authored sprite-alpha threshold is restored');
assert.equal(camera.layers.mask,1,'camera layer mask is restored');

// Even a throwing renderer must not disable world updates for the following game frame.
api.init({camera,renderer:{render(){assert.equal(scene.autoUpdate,false);throw new Error('depth-pass failure');}}});
assert.throws(()=>api.renderDepth(scene),/depth-pass failure/);
assert.equal(scene.autoUpdate,true,'scene autoUpdate is restored after a failed depth replay');
assert.equal(mesh.material.colorWrite,true,'material colour writes are restored after a failed depth replay');
assert.equal(mesh.material.depthWrite,false,'material depth writes are restored after a failed depth replay');
assert.equal(camera.layers.mask,1,'camera layers are restored after a failed depth replay');
scene.autoUpdate=false;
api.init({camera,renderer:{render(){assert.equal(scene.autoUpdate,false);}}});
api.renderDepth(scene);
assert.equal(scene.autoUpdate,false,'a scene whose automatic matrix updates are already disabled stays disabled');
scene.autoUpdate=true;
npcRoot.visible=false;
api.prune();
assert.equal(api.snapshot().registered,1,'pruning an off-camera NPC must not delete its registration');
npcRoot.parent=null;
api.prune();
assert.equal(api.snapshot().registered,0,'an actual despawn still prunes detached NPC planes');
console.log('NPC PNG depth: ancestor visibility, reversible occlusion and real despawn pruning passed.');
