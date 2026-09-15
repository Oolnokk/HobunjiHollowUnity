'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/procedural-hand-foot-material-roles.js'), 'utf8');

function object3d(children = []) {
  return {
    children,
    add(...added) {
      this.children.push(...added);
      return this;
    },
    traverse(visitor) {
      visitor(this);
      for (const child of this.children) {
        if (typeof child.traverse === 'function') child.traverse(visitor);
        else visitor(child);
      }
    },
  };
}

function mesh(material) {
  return Object.assign(object3d(), {
    isMesh: true,
    material,
    geometry: { userData: {} },
    userData: {},
  });
}

const mapperCalls = [];
const windowMock = {
  SCRATCHBONES_CONFIG: {
    game: {
      assets: {
        pngPlaneAvatar: {
          proceduralFeet: {
            species: {
              mashtzarr: { materialRoles: { 'Mat 1': 'bone', 'Mat 2': 'body' } },
              tletingan: { materialRoles: { 'Mat 1': 'bone', 'Mat 2': 'body' } },
              'mao-ao': { materialRoles: { 'Mat 1': 'body' } },
            },
          },
        },
      },
    },
  },
  HobunjiHandModelProfiles: {
    data: {
      models: {
        pachyderm: { materialRoles: {} },
        sloth: { materialRoles: {} },
        feline: { materialRoles: {} },
        parrot: { materialRoles: {} },
      },
    },
    mutate(callback) { callback(this.data); },
  },
  HobunjiSurfaceStretchUV: {
    mapGeometry(geometry, options) {
      mapperCalls.push({ geometry, options: Object.assign({}, options) });
      return {
        userData: {
          hobunjiSurfaceStretch: { patchCount: 2, boundaryLoopCount: 1 },
          hobunjiSurfacePerimeterFrame: { version: 1 },
        },
      };
    },
  },
  addEventListener() {},
};
windowMock.window = windowMock;

vm.runInNewContext(source, { window: windowMock, console });

assert.equal(windowMock.ProceduralHandAttachments, undefined, 'hand API should remain unset until its runtime assigns it');
assert.equal(windowMock.ProceduralLegAnimation, undefined, 'foot API should remain unset until its runtime assigns it');

windowMock.ProceduralHandAttachments = {
  attach() {
    const bone = mesh({ userData: { hobunjiHandRole: 'bone' } });
    const body = mesh({ userData: { hobunjiHandRole: 'body' } });
    return { group: object3d([bone, body]), bone, body };
  },
};

windowMock.ProceduralLegAnimation = {
  attach() {
    return { group: object3d() };
  },
};

const hand = windowMock.ProceduralHandAttachments.attach();
assert.equal(mapperCalls.length, 1, 'only the unrecolored hand bone mesh should use the farm surface mapper');
assert.equal(Object.hasOwn(mapperCalls[0].options, 'materialIndex'), false, 'a single-material bone primitive should map as one full detected surface');
assert.equal(hand.bone.userData.hobunjiHandFootBoneSurfaceUv.method, 'farm-cliff-detected-surface-jigsaw-stretch');
assert.equal(hand.bone.userData.hobunjiHandFootBoneSurfaceUv.perimeterFrameApplied, true);
assert.equal(hand.body.userData.hobunjiHandFootBoneSurfaceUv, undefined, 'recolored hand body material must stay on its existing UV path');

const feet = windowMock.ProceduralLegAnimation.attach();
const asyncFootBone = mesh([
  { userData: { hobunjiFootRole: 'body' } },
  { userData: { hobunjiFootRole: 'bone' } },
]);
feet.group.add(object3d([asyncFootBone]));
assert.equal(mapperCalls.length, 2, 'an asynchronously swapped-in foot GLB should be mapped when added to the observed rig');
assert.equal(mapperCalls[1].options.materialIndex, 1, 'only the foot bone material slot should be remapped on a mixed-material mesh');

const snapshot = windowMock.ProceduralHandFootMaterialRoles.surfaceUvSnapshot();
assert.equal(snapshot.wrappedApis, 2, 'both attachment APIs should be wrapped exactly once');
assert.equal(snapshot.mappedMeshes, 2, 'debug snapshot should count the hand and foot bone meshes');
assert.equal(snapshot.mappedMaterialSlots, 2, 'debug snapshot should count only bone slots');
assert.equal(snapshot.pendingMeshes, 0, 'no mesh should remain deferred when the farm mapper is available');

console.log('hand/foot bone farm-surface jigsaw mapping tests passed');
