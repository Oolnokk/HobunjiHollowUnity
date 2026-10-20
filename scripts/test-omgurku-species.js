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
assert.deepEqual(species.genders, ['male']);
assert.deepEqual(species.male.behindHeadUrLayers.map(layer => layer.url.split('/').pop()), [
  'ur-horns-front_omgurku_m.png','ur-head-behind_omgurku_m.png','ur-horns-back_omgurku_m.png'
], 'back horns reverse depth order and reserve the rear head between them');
assert.equal(species.male.behindHeadUrLayers[1].optional, true);
for (const layer of species.male.behindHeadUrLayers.filter(layer => !layer.optional))
  assert(fs.existsSync(path.join(root,'docs/assets',layer.url)), 'required back overlay '+layer.url);
const portraitSource = read('docs/js/portrait-utils.js');
assert(portraitSource.includes('behindUrLayers') && portraitSource.includes('optionalBehindUrls'), 'rear overlays are optional in shared renderer');
assert(portraitSource.includes('behindHeadUrLayers'), 'species rear overlays reach the fighter renderer'); // No female Omgurku assets were included in main.
assert(index.entries.some(entry => entry.speciesId === 'omgurku' && entry.path === './omgurku.json'));
assert.equal(species.parentSpecies, 'engh-sho');
assert(species.hybridPlacement && typeof species.hybridPlacement === 'object');
for (const key of ['lowerWidth','lowerHeight','visibleFloorCorrection','saddleU','saddleV','joinDepth','riderScale',
  'upperOffsetX','upperOffsetY','upperOffsetZ','lowerOffsetX','lowerOffsetY','lowerOffsetZ']) {
  assert(Number.isFinite(species.hybridPlacement[key]), 'authored placement: '+key);
}
assert(read('docs/tools/animation-author/index.html').includes('omgurku-calibration/index.html'), 'Animation Author link');
const calibrationHtml = read('docs/tools/omgurku-calibration/index.html');
const calibrationScript = read('docs/tools/omgurku-calibration/calibration.js');
assert(calibrationHtml.includes('calibration.js') && calibrationHtml.includes('spriteCanvas'));
assert(calibrationHtml.includes('Download omgurku.json') && calibrationHtml.includes('Apply to game on this browser'));
const v10Advanced = read('docs/tools/omgurku-calibration/advanced-lab.js');
for (const id of ['v10Weapon','v10Attack','v10Combo','v10Stance','v10Speed','v10Loop','v10EraseMode',
  'v10SaddleMode','v10Brush','v10DownloadSetup','v10ImportSetup','v10AnimalDead','v10RiderDead',
  'v10NpcDbPath','v10CopyDebug']) {
  assert(calibrationHtml.includes('id="'+id+'"'), 'restored original V10 control '+id);
}
assert(calibrationHtml.includes('advanced-lab.js'), 'V10 behavior loaded in calibrated tool');
assert(v10Advanced.includes('config/combat/attack-values.json') &&
       v10Advanced.includes('config/combat/weapon-idle-stances.json'), 'authored combat source');
assert(v10Advanced.includes('omgurku_garwolf_setup.v1') &&
       v10Advanced.includes("destination-out"), 'legacy mask export and non-destructive hidden-pixel painter');
assert(read('docs/js/omgurku-species-runtime.js').includes('setPreviewDeadzones'), 'V10 independent radius API');
assert(calibrationScript.includes('HobunjiOmgurkuSpecies') && calibrationScript.includes('hybridPlacement'));
new vm.Script(calibrationScript, {filename:'calibration.js'});
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
    this.scale = { setScalar() {}, set(x,y,z) { this.x=x; this.y=y; this.z=z; } };
    this.visible = true;
    this.children = [];
    this.parent = null;
  }
  add(child) { child.parent = this; this.children.push(child); }
  remove(child) { child.parent = null; this.children = this.children.filter(item => item !== child); }
  traverse(visitor) { visitor(this); for (const child of this.children) child.traverse?.(visitor); }
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
  assert.equal(root.userData.proceduralHandParent.parent, root, 'hand parent must remain in same NPC hierarchy');
  assert.equal(lowerBuilds.length, 3);
  for (const [i, frame] of ['idle', 'run1', 'run2'].entries()) {
    assert(lowerBuilds[i].url.endsWith(`/docs/assets/creaturesprites/omgurku-lower_${frame}.png`));
    assert.equal(lowerBuilds[i].options.creatureId, 'voorg-ass');
    assert.equal(lowerBuilds[i].group.visible, i === 0);
  }
  assert.equal(root.userData.handAttachY, root.userData.omgurkuComposite.upper.userData.handAttachY,
    'hand coordinates stay local to the portrait instead of being displaced by the animal join');
  assert.equal(root.userData.proceduralHandParent, root.userData.omgurkuComposite.upper,
    'direct hand driver must parent the free/tool hands under the same upper portrait half');
  new Group().add(root);
  gaitTick(); // Initial stationary state stays on the idle frame.
  root.position.x += 1; // NPC-owned path movement drives lower-frame selection.
  gaitTick();
  assert.match(root.userData.omgurkuComposite.frame, /^run[12]$/);
  const oldJoin = root.userData.omgurkuJoin.z;
  assert.equal(window.HobunjiOmgurkuSpecies.setPreviewFrame(root,'run2'),true);
  assert.equal(root.userData.omgurkuComposite.frame,'run2','preview may drive V10 12-frame/s cadence');
  assert.equal(root.userData.omgurkuComposite.previewFrameOwner,true);
  assert.equal(window.HobunjiOmgurkuSpecies.setPreviewFacing(root, .6), true);
  assert.equal(root.userData.omgurkuPreviewRawYaw, .6);
  const initialWidth = lowerBuilds[0].options.modelWidth;
  window.HobunjiOmgurkuSpecies.setPlacement({ lowerWidth: initialWidth * 1.2, lowerHeight: .95,
    lowerOffsetX: .2, lowerOffsetY: .3, lowerOffsetZ: .1, upperOffsetY: .05 });
  assert(Math.abs(lowerBuilds[0].group.scale.x - 1.2 * species.hybridPlacement.lowerScaleX) < 1e-6,
    'V10 Large scale multiplies the live lower sprite width without rebuilding textures');
  assert.equal(lowerBuilds[0].group.position.x, .2, 'per-half lower offset');
  assert.equal(lowerBuilds[0].group.position.z, .1, 'per-half depth offset');
  assert(root.userData.omgurkuJoin.y > .3, 'saddle follows lower floor offset');
  assert.equal(window.HobunjiOmgurkuSpecies.debugSnapshot().placement.lowerWidth, initialWidth * 1.2);
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
