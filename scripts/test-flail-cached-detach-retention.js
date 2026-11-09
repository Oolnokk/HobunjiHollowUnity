#!/usr/bin/env node
'use strict';

// The real flail setup must survive long detachment in the *current* player
// equipment map, but orphaned objects must still be released after five seconds.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const registry = fs.readFileSync('docs/config/weapon-sprite-assemblies.js', 'utf8'); // Uses the live Grapple-Flail recipe.
const runtime = fs.readFileSync('docs/js/weapon-sprite-assemblies.js', 'utf8'); // Exercises actual assembly construction and cleanup.
const vector = () => ({ set() {}, copy() {} }); // Texture UV parameters are not modified after creation in this regression.
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  toArray() { return [this.x, this.y, this.z]; }
}
class Object3D {
  constructor() {
    this.parent = null;
    this.children = [];
    this.position = new Vector3();
    this.scale = new Vector3(1, 1, 1);
    this.userData = {};
    this.renderOrder = 0;
  }
  add(...objects) {
    for (const object of objects) {
      object.parent?.remove?.(object);
      object.parent = this;
      this.children.push(object);
    }
  }
  remove(object) {
    this.children = this.children.filter(child => child !== object);
    if (object.parent === this) object.parent = null;
  }
  traverse(callback) {
    callback(this);
    for (const child of this.children) child.traverse(callback);
  }
}
class Texture {
  constructor(image) {
    this.image = image;
    this.offset = vector();
    this.repeat = vector();
  }
  clone() { return new Texture(this.image); }
  dispose() { this.disposed = true; }
}
const images = {
  'rope_long.png': { width:16, height:40 },
  'grapple-flail_grapple-back.png': { width:30, height:60 },
  'grapple-flail_grapple-front.png': { width:30, height:60 },
}; // The rope and both composite-head PNGs load as distinct asynchronous source textures.
class TextureLoader {
  load(url, success) {
    const key = url.split('/').at(-1);
    const image = images[key];
    if (!image) throw new Error('unexpected asset ' + key);
    success(new Texture(image));
  }
}
class PlaneGeometry {
  constructor(width, height) { this.parameters = { width, height }; }
  dispose() { this.disposed = true; }
}
class MeshBasicMaterial {
  constructor(options) { Object.assign(this, options); }
  dispose() { this.disposed = true; }
}
class CanvasTexture extends Texture {
  constructor(canvas) { super(canvas); }
}
class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
    this.isMesh = true;
  }
}
const THREE = {
  Vector3, Quaternion:class {}, Matrix4:class {}, TextureLoader, PlaneGeometry, MeshBasicMaterial,
  CanvasTexture, Mesh, Group:Object3D, DoubleSide:2, ClampToEdgeWrapping:3, sRGBEncoding:3001,
  LinearFilter:1006, NearestFilter:1003,
}; // Browser-independent Three-shaped objects are sufficient to test real async setup and lifetime.
const document = {
  currentScript:{ src:'https://example.test/js/weapon-sprite-assemblies.js' },
  createElement(type) {
    assert.equal(type, 'canvas');
    const canvas = {
      width:0,
      height:0,
      getContext() {
        return {
          drawImage() {},
          getImageData(_x, _y, width, height) {
            const data = new Uint8ClampedArray(width * height * 4); // Opaque center stripe exercises the real rope-crop loop.
            for (let y = 0; y < height; y++) for (let x = 4; x < width - 4; x++) data[(y * width + x) * 4 + 3] = 255;
            return { data };
          },
          putImageData() {},
        };
      },
    };
    return canvas;
  },
};
const window = {
  WEAPON_SPRITE_ASSEMBLY_CONFIG:null,
  ColorFill:{ shadeFillPixels() {} },
  RuntimeFrameScheduler:{ register() {} },
}; // Explicitly expose the same 3D assembly API used by gameplay.
vm.runInNewContext(registry, { window });
let now = 100;
vm.runInNewContext(runtime, {
  window, document, URL, THREE, performance:{ now() { return now; } },
  location:{ href:'https://example.test/game.html', pathname:'/game.html' },
  setTimeout() {}, console,
});
const api = window.HobunjiWeaponSpriteAssemblies;
const handleImage = { width:450, height:1204 }; // Real handle-pixel coordinates drive connector and head geometry.
const plane = new Mesh(new PlaneGeometry(.5, 1204/900), new MeshBasicMaterial({ map:new Texture(handleImage) }));
const root = new Object3D();
root.userData.toolPlane = plane;
root.add(plane);
api.decorate(root, 'grappleFlail', { shapeKey:'grappleFlail' }, { THREE });

(async () => {
  for (let i = 0; i < 20 && !api.debugSnapshot()[0]?.loaded; i++) await Promise.resolve();
  const loaded = api.debugSnapshot()[0];
  assert(loaded?.loaded, 'live async setup creates the rope and both head layers');
  assert.equal(loaded.connector, 'rope');
  assert(root.children.some(child => child.name === 'flail_ruin_rope'), 'the reusable root owns its rendered connector');
  const head = root.children.find(child => child.name === 'grappleFlail_flail_head'); // Parent group is the two-layer metal grapple head.
  assert(head && head.children.length === 2, 'the complete composite head exists before detachment');

  window.ProceduralHandAttachments = { gameDeps:{ toolMeshMap:{ weapon:root } } }; // Mirrors the game's live slot map, which retains unequipped roots.
  now = 200;
  api.tick(0);
  now = 7000; // Old timeout would discard all child meshes here.
  api.tick(0);
  window.ProceduralHandAttachments.gameDeps.toolMeshMap = {}; // Verify the alternative live Combat adapter uses Map without duplicating player references.
  window.Combat = { deps:{ toolMeshMap:new Map([['weapon', root]]) } };
  now = 14000;
  api.tick(0);
  assert(api.debugSnapshot()[0]?.loaded, 'detached equipment retains its loaded assembly beyond both timeout windows');
  assert(root.children.includes(head), 'head survives a long unequipped interval');
  assert(root.children.some(child => child.name === 'flail_ruin_rope'), 'rope survives the same unequipped interval');
  assert(api.debugSnapshot()[0]?.detachedForMs >= 10000, 'mobile diagnostics prove the detached assembly is still retained');

  root.parent = { isScene:true }; // Equipping uses the SAME cached root instead of calling decorate again.
  assert.equal(api.debugSnapshot()[0]?.attached, true, 'equipping exposes existing rope/head without reconstructing art');
  assert.equal(api.debugSnapshot()[0]?.loaded, true, 'equipping does not require a new asynchronous setup');
  root.parent = null;
  api.drop(root); // Actual owner disposal (enemy cleanup / preview teardown) is still authoritative.
  assert.equal(api.debugSnapshot().length, 0, 'explicit teardown releases the state and its strong registry entry');
  assert.equal(root.children.length, 1, 'explicit teardown removes rope and head but preserves the base tool plane');

  const discarded = new Object3D(); // A superseded cached loadout no longer referenced by either current equipment map.
  discarded.userData.toolPlane = new Mesh(new PlaneGeometry(.5, 1204/900), new MeshBasicMaterial({map:new Texture(handleImage)}));
  discarded.add(discarded.userData.toolPlane);
  api.decorate(discarded, 'grappleFlail', { shapeKey:'grappleFlail' }, { THREE });
  for (let i = 0; i < 20 && !api.debugSnapshot()[0]?.loaded; i++) await Promise.resolve();
  assert.equal(api.debugSnapshot().length, 1, 'retired equipment builds using the same live assembly API');
  now = 14100;
  api.tick(0);
  now = 19100;
  api.tick(0);
  assert.equal(api.debugSnapshot().length, 1, 'orphan is not dropped before the original five-second grace period');
  now = 19101;
  api.tick(0);
  assert.equal(api.debugSnapshot().length, 0, 'orphaned assembly is reclaimed when no live equipment cache owns it');
  assert.equal(discarded.children.length, 1, 'orphan cleanup preserves the base mesh while removing the connector/head');
  console.log('flail cached-detach retention: PASS (rope + two-layer head, 14s idle, Map/object ownership, explicit and automatic cleanup)');
})().catch(error => { console.error(error); process.exitCode = 1; });
