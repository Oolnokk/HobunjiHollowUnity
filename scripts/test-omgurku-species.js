// Regression coverage for NPC-only Omgurku + quadruped lower body.
// Run with: node scripts/test-omgurku-species.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Repository root for asset/existing-system validation.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const species = JSON.parse(read('docs/config/species/omgurku.json')); // Authored NPC fighter, head, and torso mapping.
const index = JSON.parse(read('docs/config/species/index.json')); // Discoverability in the shared portrait species loader.

assert.equal(species.speciesId, 'omgurku');
assert.equal(species.npcOnly, true);
assert.equal(species.playerSelectable, false);
assert.deepEqual(species.genders, ['male']); // No female Omgurku assets were included in main.
assert(index.entries.some(entry => entry.speciesId === 'omgurku' && entry.path === './omgurku.json'));
assert.equal(species.parentSpecies, 'engh-sho');
for (const slot of ['hat', 'hood', 'hairFront', 'hairBack', 'hairSide', 'hairSideL', 'facialHair']) {
  assert.deepEqual(species.male.exclusiveSlotCosmetics[slot], ['none'], slot);
}
for (const asset of [
  species.male.headSprite,
  ...species.male.headUrLayers.map(layer => layer.url),
  ...species.male.portraitBodyLayers.map(layer => layer.url),
  'creaturesprites/omgurku-lower_idle.png',
  'creaturesprites/omgurku-lower_run1.png',
  'creaturesprites/omgurku-lower_run2.png',
]) assert(fs.existsSync(path.join(root, 'docs/assets', asset)), `missing Omgurku art: ${asset}`);

assert(read('docs/js/attachment-rig-latest-authored-snapshot.js').includes('omgurku-species-runtime.js'));
assert(read('docs/js/procedural-leg-animation.js').includes("if (speciesId === 'omgurku') return null"));

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(other) { return this.set(other.x, other.y, other.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
}
class Group {
  constructor() {
    this.userData = {};
    this.position = new Vector3();
    this.scale = { setScalar() {} };
    this.visible = true;
    this.children = [];
    this.parent = null;
  }
  add(child) { child.parent = this; this.children.push(child); }
  remove(child) { child.parent = null; this.children = this.children.filter(item => item !== child); }
  getWorldPosition(out) {
    let node = this;
    out.set(0, 0, 0);
    while (node) {
      out.x += node.position.x;
      out.y += node.position.y;
      out.z += node.position.z;
      node = node.parent;
    }
    return out;
  }
}

let gaitTick = null; // Captured shared visual clock to simulate NPC walking without any creature AI.
let humanoidBuilds = 0; // Checks that Omgurku still uses the ordinary humanoid NPC avatar builder.
let standardDisposals = 0; // Checks upper-body teardown is delegated to PNGPlaneAvatar.
let lowerDisposals = 0; // Counts direct calls to each animal-plane refcounted disposal.
const lowerBuilds = []; // Exposes selected Omgurku art URLs and Voorg-ass rig selection.
const api = {
  buildSinglePlaneAvatarModel() {
    humanoidBuilds++;
    const group = new Group();
    group.userData = { handAttachY: 0.6, portraitModelHeight: 1, neckRig: { available: true } };
    return group;
  },
  buildAnimalPlaneAvatarModel(_THREE, url, options) {
    const group = new Group();
    lowerBuilds.push({ group, url, options });
    return { group, dispose() { lowerDisposals++; } };
  },
  disposeAvatarModel() { standardDisposals++; },
};
const cfg = { game: { appearanceEditor: { species: { 'engh-sho': {} } }, portrait: { armOnlyOpacityMask: { profiles: {} } } } };
const rigs = { characters: { 'engh-sho::male': { species: 'engh-sho', gender: 'male', anatomy: { rigScaleX: 1 }, posteriorRule: { appearanceSpeciesId: 'engh-sho' } } } };
const hands = { data: { speciesModels: { 'engh-sho': 'feline' } }, mutate(callback) { callback(this.data); } };
const window = {
  SCRATCHBONES_CONFIG: cfg, HOBUNJI_ATTACHMENT_RIG_PROFILES: rigs, HobunjiHandModelProfiles: hands,
  PNGPlaneAvatar: api, resolveOptionLayers(_option, fighter) { return fighter.speciesId; },
  getPortraitFighters() { return [{ id: 'E', speciesId: 'engh-sho', gender: 'male' }, { id: 'O', speciesId: 'omgurku', gender: 'male' }]; },
  async loadPortraitCosmetics() { return { bodyColorRangesByGender: { E: { A: '#123456' } } }; },
};
const currentScript = { src: 'https://example.test/docs/js/omgurku-species-runtime.js' };
const document = { currentScript, hidden: false };
const location = { href: 'https://example.test/docs/index.html', search: '' };
const clock = { now: () => 2000 };
vm.runInNewContext(read('docs/js/omgurku-species-runtime.js'), {
  window, document, location, performance: clock, URL,
  setInterval(fn, ms) { assert.equal(ms, 100); gaitTick = fn; return 1; },
  console,
});
assert.equal(cfg.game.appearanceEditor.species.omgurku.npcOnly, true);
assert(rigs.characters['omgurku::male']);
assert.notEqual(rigs.characters['omgurku::male'], rigs.characters['engh-sho::male']);
assert.equal(hands.data.speciesModels.omgurku, 'feline');
assert.equal(window.resolveOptionLayers(null, { speciesId: 'omgurku' }), 'engh-sho');
assert.equal(window.resolveOptionLayers(null, { speciesId: 'harlyao' }), 'harlyao');

async function main() {
  const cosmetics = await window.loadPortraitCosmetics();
  assert.equal(cosmetics.bodyColorRangesByGender.O, cosmetics.bodyColorRangesByGender.E);
  const root = api.buildSinglePlaneAvatarModel({ Group, Vector3 }, {}, { speciesId: 'omgurku' });
  assert.equal(humanoidBuilds, 1);
  assert.equal(root.userData.omgurkuNpc, true);
  assert.equal(root.children.length, 4);
  assert.equal(lowerBuilds.length, 3);
  for (const [i, frame] of ['idle', 'run1', 'run2'].entries()) {
    assert(lowerBuilds[i].url.endsWith(`/docs/assets/creaturesprites/omgurku-lower_${frame}.png`));
    assert.equal(lowerBuilds[i].options.creatureId, 'voorg-ass');
    assert.equal(lowerBuilds[i].group.visible, i === 0);
  }
  assert(root.userData.handAttachY > 0.6);
  new Group().add(root);
  gaitTick(); // Initial stationary state stays on the idle frame.
  root.position.x += 1; // NPC-owned path movement drives lower-frame selection.
  gaitTick();
  assert.match(root.userData.omgurkuComposite.frame, /^run[12]$/);
  const oldJoin = root.userData.omgurkuJoin.z;
  window.HobunjiOmgurkuSpecies.setPlacement({ saddleU: 0.4 });
  assert.notEqual(root.userData.omgurkuJoin.z, oldJoin);
  api.disposeAvatarModel(root);
  assert.equal(lowerDisposals, 3);
  assert.equal(standardDisposals, 1);
  assert.equal(window.HobunjiOmgurkuSpecies.debugSnapshot().liveCount, 0);
  api.buildSinglePlaneAvatarModel({ Group, Vector3 }, {}, { speciesId: 'engh-sho' });
  assert.equal(humanoidBuilds, 2);
  console.log('Omgurku NPC subspecies/hybrid rig tests passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
