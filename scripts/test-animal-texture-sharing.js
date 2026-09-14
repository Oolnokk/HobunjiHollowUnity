'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
}

class MockTexture {
  constructor(url) {
    this.url = url;
    this.wrapS = 'clamp';
    this.wrapT = 'clamp';
    this.repeat = new Vec2(1, 1);
    this.offset = new Vec2(0, 0);
    this.disposeCalls = 0;
    this.needsUpdate = false;
  }
  dispose() { this.disposeCalls++; }
}

const loaderCalls = [];
class TextureLoader {
  load(url) {
    loaderCalls.push(url);
    return new MockTexture(url);
  }
}

function makeUv(xs) {
  const values = xs.slice();
  return {
    count: values.length,
    needsUpdate: false,
    getX(index) { return values[index]; },
    setX(index, value) { values[index] = value; },
    values,
  };
}

function makeGeometry(xs) {
  const uv = makeUv(xs);
  return {
    userData: {},
    attributes: { uv },
    getAttribute(name) { return this.attributes[name]; },
    clone() { return makeGeometry(this.attributes.uv.values); },
  };
}

const THREE = { TextureLoader, RepeatWrapping: 'repeat' };

const api = {
  buildAnimalPlaneAvatarModel(THREEArg, spriteUrl) {
    const loader = new THREEArg.TextureLoader();
    const frontTexture = loader.load(spriteUrl);
    const backTexture = loader.load(spriteUrl);
    backTexture.wrapS = THREEArg.RepeatWrapping;
    backTexture.repeat.set(-1, 1);
    backTexture.offset.set(1, 0);

    const frontPlane = {
      name: 'test_front_plane',
      geometry: makeGeometry([0, 0.25, 1]),
      material: { map: frontTexture, userData: {}, needsUpdate: false },
      userData: {},
    };
    const backPlane = {
      name: 'test_back_plane',
      geometry: makeGeometry([0, 0.25, 1]),
      material: { map: backTexture, userData: {}, needsUpdate: false },
      userData: {},
    };
    return {
      group: { children: [frontPlane, backPlane] },
      frontPlane,
      backPlane,
    };
  },
};

const context = {
  console,
  window: { PNGPlaneAvatar: api },
  document: undefined,
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/animal-texture-sharing.js', 'utf8'), context, { filename: 'animal-texture-sharing.js' });

assert.equal(context.window.AnimalTextureSharing.getDebug().installed, true, 'texture-sharing wrapper installs against the live PNG avatar API');

const avatar = context.window.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(THREE, 'mount.png', {});
assert.equal(loaderCalls.length, 1, 'front/back base cards issue only one TextureLoader request');
assert.strictEqual(avatar.frontPlane.material.map, avatar.backPlane.material.map, 'front/back cards share one live texture object');
assert.equal(avatar.frontPlane.material.map.wrapS, 'clamp', 'legacy back-card texture transform is restored on the shared source texture');
assert.deepEqual([avatar.frontPlane.material.map.repeat.x, avatar.frontPlane.material.map.repeat.y], [1, 1], 'shared source texture repeat remains unmirrored');
assert.deepEqual([avatar.frontPlane.material.map.offset.x, avatar.frontPlane.material.map.offset.y], [0, 0], 'shared source texture offset remains unmirrored');
assert.deepEqual(avatar.frontPlane.geometry.attributes.uv.values, [0, 0.25, 1], 'front UVs remain unchanged');
assert.deepEqual(avatar.backPlane.geometry.attributes.uv.values, [1, 0.75, 0], 'back card mirrors horizontally in geometry UVs');
assert.equal(avatar.backPlane.geometry.attributes.uv.needsUpdate, true, 'mirrored back UV buffer is marked dirty');

const animatedFront = new MockTexture('genotype-canvas-front');
const duplicateLegacyBack = new MockTexture('genotype-canvas-back');
duplicateLegacyBack.repeat.set(-1, 1);
avatar.frontPlane.material.map = animatedFront;
avatar.backPlane.material.map = duplicateLegacyBack;
assert.strictEqual(avatar.frontPlane.material.map, animatedFront, 'legacy back assignment cannot overwrite the newly assigned front frame');
assert.strictEqual(avatar.backPlane.material.map, animatedFront, 'back material aliases whatever frame the front material currently owns');
assert.equal(duplicateLegacyBack.disposeCalls, 0, 'globally cached legacy back textures are not disposed by one avatar');

const second = context.window.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(THREE, 'second.png', {});
assert.equal(loaderCalls.length, 2, 'each avatar still loads its own sprite once rather than cross-avatar aliasing unrelated ownership');
assert.strictEqual(second.frontPlane.material.map, second.backPlane.material.map, 'sharing applies to every newly built animal avatar');

const debug = context.window.AnimalTextureSharing.getDebug();
assert.equal(debug.patchedAvatars, 2, 'debug counts patched animal avatars');
assert.equal(debug.baseTextureLoadsAvoided, 2, 'one redundant base load is avoided per two-card avatar');
assert.equal(debug.mirroredBackGeometries, 2, 'each back geometry receives one UV mirror');
assert.ok(debug.suppressedBackMapAssignments >= 1, 'legacy runtime back-map swaps are suppressed');

console.log('animal texture sharing regression passed');
