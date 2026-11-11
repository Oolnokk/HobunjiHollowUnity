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
const camera={layers:{mask:1,set(n){this.mask=1<<n;}}};
api.init({camera,renderer:{render(scene,view){renders++;assert.equal(view.layers.mask,16,'only PNG depth layer renders');}}});

const scene={isScene:true,visible:true,parent:null};
const npcRoot={visible:false,parent:scene};
const mesh={isMesh:true,visible:true,parent:npcRoot,userData:{},
  layers:{mask:1,enable(n){this.mask|=1<<n;}},
  material:{colorWrite:true,depthWrite:false,depthTest:false,depthFunc:2,alphaTest:.12,map:{}},
}; // NPC's actual PNG mesh remains visible while the whole actor root is render-hidden.
api.registerDepthMesh(mesh);
api.renderDepth(scene);
assert.equal(renders,0,'a hidden parent prevents unnecessary PNG depth render');
assert.equal(api.snapshot().registered,1,'render-only hiding never permanently unregisters the NPC portrait');
assert.equal(mesh.material.depthWrite,false,'materials remain unchanged when every NPC is hidden');

npcRoot.visible=true;
api.renderDepth(scene);
assert.equal(renders,1,'the same NPC portrait immediately resumes its depth occlusion when re-exposed');
assert.equal(mesh.material.depthWrite,false,'the temporary depth-writing override is restored');
assert.equal(mesh.material.colorWrite,true,'the original color-writing flag is restored');
assert.equal(mesh.material.alphaTest,.12,'the original authored sprite-alpha threshold is restored');
assert.equal(camera.layers.mask,1,'camera layer mask is restored');

npcRoot.visible=false;
api.prune();
assert.equal(api.snapshot().registered,1,'pruning an off-camera NPC must not delete its registration');
npcRoot.parent=null;
api.prune();
assert.equal(api.snapshot().registered,0,'an actual despawn still prunes detached NPC planes');
console.log('NPC PNG depth: ancestor visibility, reversible occlusion and real despawn pruning passed.');
