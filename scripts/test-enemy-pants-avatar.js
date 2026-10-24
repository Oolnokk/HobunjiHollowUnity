'use strict';
const assert = require('node:assert/strict'); // Verifies hostile builder wiring without a GPU.
const fs = require('node:fs'); // Reads the real avatar factory.
const vm = require('node:vm'); // Isolates browser rendering collaborators.
const source = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8'); // Production owner under test.
const factory = source.slice(source.indexOf('  async function buildBanditAvatar('), source.indexOf('  function copyBanditExpressionCanvas(')); // Includes compound-builder helpers used by this factory.
class Group {
  constructor() {
    this.children = []; this.userData = {}; this.parent = null;
    this.position = { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } };
    this.rotation = { x: 0, y: 0, z: 0 };
  }
  add(child) { child.parent?.remove(child); child.parent = this; this.children.push(child); }
  remove(child) { this.children = this.children.filter(value => value !== child); child.parent = null; }
}
let attachment = null, ready = false, disposed = false; // Captures garment hierarchy, asynchronous completion and lifecycle.
const profile = { bodyColors: { PANTS: { hex: '#336699' } } }; // Profile produced after roster dye reconciliation.
const legs = { dispose() { disposed = true; } }; // The existing leg lifecycle is the sole owner of pants teardown.
const portrait = new Group(), assembly = new Group(); // Hostile builder extracts these source portrait meshes.
assembly.add(new Group()); assembly.add(new Group()); portrait.add(assembly);
const renderer = {
  garmentForCosmetics: ids => ids?.find(id => id === 'draped_pants'),
  appearanceFromBodyColors: colors => ({ primaryHex: colors.PANTS.hex }),
  buildOverlayMask: () => 'cloth-mask',
  attachToLegs(_THREE, handle, options) {
    attachment = { handle, options };
    handle.pants = { readyPromise: Promise.resolve().then(() => { ready = true; return true; }) };
    return handle.pants;
  },
}; // Rendering is stubbed only at the canonical garment API boundary.
const context = {
  window: {
    NpcAvatarPreview: { ensurePortraitCosmetics: async () => {}, buildProfileFromNpcExport: () => profile, renderProfileToCanvas: async () => {} },
    PNGPlaneAvatar: { buildSinglePlaneAvatarModel: () => portrait, disposeAvatarModel() {} },
    ProceduralLegAnimation: { attach: () => legs }, PantsGarmentRenderer: renderer,
  },
  document: { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) },
  THREE: { Group }, COMBAT_FROWN_COMPOSER: {}, characterBuildStatus: {},
  ensureEnemyPants: () => 'draped_pants', applyRosterDyesToProfile: () => ({}),
}; // Minimal host retains all real factory assembly logic.
vm.runInNewContext(factory + ';this.build = buildBanditAvatar;', context);
(async () => {
  const ref = await context.build({ name: 'Ghoul', appearance: { speciesId: 'ghoul', gender: 'male' }, equippedCosmetics: ['draped_pants'] }); // Same path used by bandits, ghouls, skeletons, liches and ghosts.
  assert.equal(attachment.options.avatarGroup, ref.frontPlane, 'pants follow the same facing/death pivot as the portrait');
  assert.equal(attachment.handle, ref.legs);
  assert.equal(attachment.options.garmentId, 'draped_pants');
  assert.equal(attachment.options.appearance.primaryHex, '#336699');
  assert.equal(attachment.options.overlayMask, 'cloth-mask');
  assert(ready, 'factory awaits garment mesh before downstream material conversions');
  assert(context.characterBuildStatus.pantsAttached, 'mobile build diagnostics expose successful attachment');
  ref.dispose(); assert(disposed, 'existing avatar teardown disposes the leg-owned garment');
  console.log('Enemy pants avatar hierarchy, appearance, async readiness and teardown passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
