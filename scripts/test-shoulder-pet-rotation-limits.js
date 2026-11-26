// Pure collision math plus integration contracts; browser parity needs an actual avatar.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const windowStub={};
new Function('window',fs.readFileSync('docs/js/shoulder-pet-rotation-limits.js','utf8'))(windowStub);
const overlap=windowStub.ShoulderPetRotationLimits.trianglesOverlap;
const t=[0,0,0, 1,0,0, 0,1,0], ix=[0,3,6];
assert.equal(overlap(t,ix,[.2,.2,-1,.2,.2,1,.8,.2,0],ix,0),true,'intersecting cards');
assert.equal(overlap(t,ix,[2,0,0,3,0,0,2,1,0],ix,0),false,'coplanar separated cards');
assert.equal(overlap(t,ix,[.2,.2,1,.8,.2,1,.2,.8,1],ix,0),false,'parallel separated cards');
assert.equal(overlap(t,ix,[.2,.2,0,.8,.2,0,.2,.8,0],ix,0),true,'coplanar overlap');
assert.equal(overlap(t,ix,[.2,.2,.001,.8,.2,.001,.2,.8,.001],ix,.002),true,'clearance');
const runtime=fs.readFileSync('docs/js/shoulder-pet-attachment-runtime.js','utf8');
assert.match(runtime,/rotationLimits\?\.constrain/);
assert.match(runtime,/geometryConstraint/);
const game=fs.readFileSync('docs/game.js','utf8');
assert.match(game,/getOwnerPortraitMeshes: \(\) => \[_playerAvatarFrontMesh, _playerAvatarBackMesh\]/);
assert.match(game,/geometricDepth: true/);
console.log('shoulder pet geometry collision math and wiring passed');
