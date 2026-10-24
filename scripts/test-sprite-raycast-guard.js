// Executes docs/js/sprite-raycast-guard.js against a stub THREE.Sprite to
// prove camera-less rays skip sprites while setFromCamera rays still test them.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const calls = [];
function Sprite() {}
Sprite.prototype.raycast = function (raycaster, intersects) {
  calls.push(raycaster);
  raycaster.camera.matrixWorld; // r128 dereferences the camera unconditionally.
  intersects.push({ object: this });
};
const window = { THREE: { Sprite } };
const source = fs.readFileSync('docs/js/sprite-raycast-guard.js', 'utf8');
vm.runInNewContext(source, { window });
vm.runInNewContext(source, { window }); // Second load must not double-wrap.

const sprite = new Sprite();
const hits = [];
assert.doesNotThrow(() => sprite.raycast({ camera: null }, hits), 'camera-less ray must not reach r128 Sprite.raycast');
assert.strictEqual(calls.length, 0);
assert.strictEqual(hits.length, 0);

sprite.raycast({ camera: { matrixWorld: {} } }, hits);
assert.strictEqual(calls.length, 1, 'setFromCamera rays still use the original sprite hit test');
assert.strictEqual(hits.length, 1);

const index = fs.readFileSync('docs/index.html', 'utf8');
const threeAt = index.indexOf('three.js/r128/three.min.js');
const guardAt = index.search(/js\/sprite-raycast-guard\.js\?v=[A-Za-z0-9_-]+/);
assert(threeAt >= 0 && guardAt > threeAt, 'guard loads after three.js');
assert(guardAt < index.indexOf('game.js?v='), 'guard loads before game.js');
console.log('sprite raycast guard ok');
