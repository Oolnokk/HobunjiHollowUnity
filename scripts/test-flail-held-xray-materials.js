#!/usr/bin/env node
'use strict';

// Guard flail art participation in held-object x-ray without requiring a browser.
// The real GPU/terrain result still needs an in-game pixel comparison.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const assembly = fs.readFileSync('docs/js/weapon-sprite-assemblies.js', 'utf8');
const compositor = fs.readFileSync('docs/js/held-object-render-order.js', 'utf8');

function functionBetween(source, name, following, scope = {}) {
  const start = source.indexOf('  function ' + name + '(');
  const end = source.indexOf('\n  function ' + following + '(', start);
  assert(start >= 0 && end > start, name + ' still lives in its expected module');
  return vm.runInNewContext('(' + source.slice(start, end).trim() + ')', scope);
}

class PlaneGeometry {
  constructor(width, height) { this.parameters = { width, height }; }
}
class Material {
  constructor(options) { Object.assign(this, options); }
}
class Mesh {
  constructor(geometry, material) {
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
    this.userData = {};
    this.position = { set() {} };
    this.scale = { set() {} };
    this.quaternion = new Quaternion();
    this.matrixRefreshes = 0;
    this.updateMatrixWorld = () => { this.matrixRefreshes++; };
  }
}
class Group {
  constructor() { this.children = []; this.userData = {}; this.matrixWorld = new Matrix4(); }
  add(child) { this.children.push(child); child.parent = this; }
}
// Small translation/basis math fixture executes the actual rope hook, not just
// construction. Distinct camera/parent orientations must invalidate its cache.
class Vector3 {
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){Object.assign(this,{x,y,z});return this;}
  copy(v){return this.set(v.x,v.y,v.z);}
  equals(v){return this.x===v.x&&this.y===v.y&&this.z===v.z;}
  setFromMatrixPosition(m){return this.set(m.x,m.y,m.z);}
  applyMatrix4(m){return this.set(this.x+m.x,this.y+m.y,this.z+m.z);}
  lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}
  normalize(){const n=Math.sqrt(this.lengthSq())||1;return this.set(this.x/n,this.y/n,this.z/n);}
  crossVectors(a,b){return this.set(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);}
}
let inversions=0;
class Matrix4 {
  constructor(){this.x=this.y=this.z=0;this.elements=[];}
  copy(m){this.x=m.x;this.y=m.y;this.z=m.z;return this;}
  equals(m){return this.x===m.x&&this.y===m.y&&this.z===m.z;}
  invert(){inversions++;this.x=-this.x;this.y=-this.y;this.z=-this.z;return this;}
  makeBasis(r,u,n){this.facing=Math.atan2(n.x,n.z);return this;}
}
class Quaternion {
  constructor(){this.facing=0;}
  copy(q){this.facing=q.facing;return this;}
  equals(q){return this.facing===q.facing;}
  setFromRotationMatrix(m){this.facing=m.facing;return this;}
}
const THREE = { PlaneGeometry, MeshBasicMaterial: Material, Mesh, Group,
  Vector3, Matrix4, Quaternion, DoubleSide: 2, ClampToEdgeWrapping: 1001,
  sRGBEncoding: 3001, LinearFilter: 1006 };
const texture = {
  image: { width: 50, height: 120 },
  clone() {
    return {
      image: this.image,
      offset: { set() {} },
      repeat: { set() {} },
    };
  },
};
const factory = { // Stand-in for the shared PNG factory's depth/alpha contract.
  maskAlphaTest: () => 0.35,
  makeMaterial: (three, map, name, override) => new Material({
    ...override, name, map, transparent: true, alphaTest: override.depthWrite ? 0.35 : 0.001,
  }),
};
const buildPlane = functionBetween(assembly, 'buildPlane', 'destroyPart',
  { global: { HobunjiSpritePngSurface: factory } });
const decoration = buildPlane(THREE, texture.image, texture, 0.01, 1.50);
const headBack = buildPlane(THREE, texture.image, texture, 0.01, 1.52, null, true);
const headFront = buildPlane(THREE, texture.image, texture, 0.01, 1.521, null, true);
assert.equal(decoration.material.depthWrite, false, 'unrelated static weapon overlays keep their previous blending');
for (const part of [headBack, headFront]) {
  assert.equal(part.material.depthWrite, true, 'both flail head layers write visible depth');
  assert(part.material.alphaTest >= 0.35, 'head depth excludes translucent PNG fringes');
  assert.equal(part.userData.hobunjiHeldObjectPlane, true, 'head layers register for held-object replay');
  assert.equal(part.userData.hobunjiWeaponAssemblyPart, true, 'head preserves authored layering');
  assert.equal(part.userData.noOutline, true, 'authored head outline stays intact');
}
assert.notEqual(headBack.renderOrder, headFront.renderOrder, 'front and back head layer ordering remains explicit');

// Exercise the rope factory with an in-memory PNG surrogate and inert 3D math.
const makeRope = functionBetween(assembly, 'makeRope', 'relativePartScale', {
  ropeOpaqueBounds: () => ({ minX: 0, minY: 0, maxX: 49, maxY: 119 }),
  ropeSpriteSizing: () => ({ widthScale: 1, length: 1 }),
  tintedRopeTexture: (_three, source) => source,
});
const ropeGroup = makeRope(THREE, { sprite: 'assets/objectsprites/rope_long.png' },
  0.01, 1.51, texture);
const rope = ropeGroup.children[0];
assert.equal(rope.material.depthWrite, true, 'flail rope writes solid depth');
assert.equal(rope.material.depthTest, undefined, 'rope retains Three.js default depth testing');
assert.equal(rope.material.alphaTest, 0.35, 'rope uses the solid PNG coverage threshold');
assert.equal(rope.userData.hobunjiHeldObjectPlane, true, 'rope registers for the held overlay');
assert.equal(rope.userData.hobunjiWeaponAssemblyPart, true, 'rope stays in authored assembly order');
assert.equal(rope.userData.noOutline, true, 'rope keeps its authored PNG outline');
const camera={matrixWorld:new Matrix4(),getWorldPosition(out){return out.setFromMatrixPosition(this.matrixWorld);}};
camera.matrixWorld.z=10;
rope.onBeforeRender(null,null,camera);
assert.equal(inversions,1);
const initialFacing=rope.quaternion.facing;
rope.onBeforeRender(null,null,camera);
assert.equal(inversions,1,'same replay camera and carrier skip inversion');
assert.equal(rope.matrixRefreshes,2,'leaf matrices still refresh in each native pass');
assert.equal(rope.userData.ropeFacingReuses,1);
camera.matrixWorld.x=10;
rope.onBeforeRender(null,null,camera);
assert.notEqual(rope.quaternion.facing,initialFacing,'camera change updates billboard');
assert.equal(inversions,2);
ropeGroup.matrixWorld.x=10;
rope.onBeforeRender(null,null,camera);
assert.equal(rope.quaternion.facing,initialFacing,'moving carrier updates billboard');
assert.equal(inversions,3);
rope.quaternion.facing=123;
rope.onBeforeRender(null,null,camera);
assert.equal(rope.quaternion.facing,initialFacing,'external quaternion change restores correct facing');
assert.equal(inversions,4);

const isLegacyHeldPlane = functionBetween(compositor, 'isLegacyHeldPlane', 'forEachMaterial',
  { LEGACY_HELD_RENDER_ORDER: 1.5 });
for (const part of [headBack, headFront, rope]) {
  assert.equal(isLegacyHeldPlane(part), true, 'each flail part is individually registered as held art');
}
const isReplayParticipant = functionBetween(compositor, 'isReplayParticipant', 'splitReplayParticipants',
  { replayParticipantPolicy: 'nearby', participantOwner: () => 'other', withinFeetXrayDistance: () => false });
for (const part of [headBack, headFront, rope]) {
  assert.equal(isReplayParticipant(part, {}), true, 'held weapons x-ray regardless of owner-distance foot restrictions');
}
assert.match(assembly, /buildPlane\(THREE, chainImg, chainTex, unit, order \+ 0\.01, null, true\)/,
  'authored raster-chain connections get the same solid-depth treatment');
assert.match(assembly, /buildPlane\(THREE, headTextures\[i\]\.image, headTextures\[i\], unit, headOrder \+ i \* 0\.001, layer\.offsetPx, true\)/,
  'every flail head sprite opts into solid-depth treatment');
console.log('OK: flail rope, chain and both head layers retain held x-ray participation and solid depth; unrelated overlays are unchanged.');
