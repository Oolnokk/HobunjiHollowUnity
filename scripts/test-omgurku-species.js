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
for (const key of ['lowerWidth','lowerHeight','lowerDeadzoneDegrees','visibleFloorCorrection','saddleU','saddleV','joinDepth','riderScale',
  'upperOffsetX','upperOffsetY','upperOffsetZ','lowerOffsetX','lowerOffsetY','lowerOffsetZ']) {
  assert(Number.isFinite(species.hybridPlacement[key]), 'authored placement: '+key);
}
assert(read('docs/tools/animation-author/index.html').includes('omgurku-calibration/index.html'), 'Animation Author link');
const calibrationHtml = read('docs/tools/omgurku-calibration/index.html');
const calibrationScript = read('docs/tools/omgurku-calibration/calibration.js');
assert(calibrationHtml.includes('calibration.js') && calibrationHtml.includes('spriteCanvas'));
assert(calibrationHtml.includes('Download omgurku.json') && calibrationHtml.includes('Apply to game on this browser'));
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
  buildSinglePlaneAvatarModel(_THREE,_canvas,options={}) {
    humanoidBuilds++;
    const group = new Group();
    group.userData = { speciesId: options.speciesId,gender:options.gender,handAttachY: 0.6, portraitModelHeight: 1, neckRig: { available: true } };
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
  const facing = function(raw=this.desiredRot) { return raw; }; // Original walker method must survive repeated avatar rebuilds.
  const walker = { rec:{id:'hybrid-test'}, desiredRot:.8, applyFacingDeadzone:facing };
  window._npcWalkers=[walker];
  const root = api.buildSinglePlaneAvatarModel({ Group, Vector3 }, {}, { speciesId: 'omgurku',npcRecord:{id:'hybrid-test'} });
  assert.equal(humanoidBuilds, 1);
  assert.equal(root.userData.omgurkuNpc, true);
  assert.equal(root.userData.avatarGroundLift,0,'compound NPC uses a floor-relative world origin');
  assert.equal(root.userData.proceduralBodyRoot,root.userData.omgurkuComposite.upper,'held stances rotate the mounted torso and hands together');
  assert.equal(root.children.length, 4);
  assert.equal(root.userData.proceduralHandParent.parent, root.userData.omgurkuComposite.upper, 'hand parent must remain in same NPC hierarchy');
  assert.equal(lowerBuilds.length, 3);
  for (const [i, frame] of ['idle', 'run1', 'run2'].entries()) {
    assert(lowerBuilds[i].url.endsWith(`/docs/assets/creaturesprites/omgurku-lower_${frame}.png`));
    assert.equal(lowerBuilds[i].options.creatureId, 'voorg-ass');
    assert.equal(lowerBuilds[i].group.visible, i === 0);
  }
  assert.equal(root.userData.handAttachY, root.userData.omgurkuComposite.upper.userData.handAttachY,
    'hand coordinates stay local to the portrait instead of being displaced by the animal join');
  assert.equal(root.userData.proceduralHandParent, root.userData.omgurkuComposite.riderFrame,
    'direct hand driver must parent the free/tool hands under the same upper portrait half');
  assert.equal(root.userData.proceduralHandParent.position.y, -.5, 'floor frame offsets the centered portrait by exactly half its height');
  const handY = root.userData.proceduralHandParent.position.y + root.userData.handAttachY;
  assert(Math.abs(handY-.1)<1e-8, 'floor-relative .6 hand anchor lands at .1 in portrait coordinates');
  assert.equal(window.HobunjiOmgurkuSpecies.setPlacement({lowerDeadzoneDegrees:60}).lowerDeadzoneDegrees,60);
  assert.equal(window.HobunjiOmgurkuSpecies.setPlacement({lowerDeadzoneDegrees:200}).lowerDeadzoneDegrees,89);
  assert.equal(window.HobunjiOmgurkuSpecies.setPlacement({lowerDeadzoneDegrees:-2}).lowerDeadzoneDegrees,0);
  window.HobunjiOmgurkuSpecies.setPlacement({lowerDeadzoneDegrees:27.5});
  new Group().add(root);
  gaitTick(); // Initial stationary state stays on the idle frame.
  assert.equal(walker.applyFacingDeadzone,facing,'hybrid facing never wraps the NPC update method');
  assert.equal(walker.applyFacingDeadzone(),.8);
  root.position.x += 1; // NPC-owned path movement drives lower-frame selection.
  gaitTick();
  assert.match(root.userData.omgurkuComposite.frame, /^run[12]$/);
  const oldJoin = root.userData.omgurkuJoin.z;
  assert.equal(window.HobunjiOmgurkuSpecies.setPreviewFacing(root, .6), true);
  assert.equal(root.userData.omgurkuPreviewRawYaw, .6);
  const initialWidth = lowerBuilds[0].options.modelWidth;
  window.HobunjiOmgurkuSpecies.setPlacement({ lowerWidth: initialWidth * 1.2, lowerHeight: .95,
    lowerOffsetX: .2, lowerOffsetY: .3, lowerOffsetZ: .1, upperOffsetY: .05 });
  assert(Math.abs(lowerBuilds[0].group.scale.x - 1.2) < 1e-6, 'live width calibration');
  assert.equal(lowerBuilds[0].group.position.x, .2, 'per-half lower offset');
  assert.equal(lowerBuilds[0].group.position.z, .1, 'per-half depth offset');
  assert(root.userData.omgurkuJoin.y > .3, 'saddle follows lower floor offset');
  assert.equal(window.HobunjiOmgurkuSpecies.debugSnapshot().placement.lowerWidth, initialWidth * 1.2);
  window.HobunjiOmgurkuSpecies.setPlacement({ saddleU: 0.4 });
  assert.notEqual(root.userData.omgurkuJoin.z, oldJoin);
  // Neutral placement remains authored, while the animal turns around a fixed saddle.
  // The humanoid weapon/hand frame must never translate with the lower deadzone.
  const upper = root.userData.omgurkuComposite.upper;
  const neutral = { x: upper.position.x, z: upper.position.z };
  const saddleRadius = (0.5 - 0.4) * (initialWidth * 1.2);
  const layout = window.HobunjiOmgurkuSpecies.debugSnapshot().placement;
  assert(Math.abs(neutral.z - (layout.lowerOffsetZ + saddleRadius + layout.joinDepth + layout.upperOffsetZ)) < 1e-6,
    'neutral saddle retains the original authored lower depth offset');
  for (const ref of lowerBuilds) ref.group.rotation = { y: Math.PI / 2 };
  window.HobunjiOmgurkuSpecies.setPlacement({});
  assert(Math.abs(upper.position.x-neutral.x)<1e-6 && Math.abs(upper.position.z-neutral.z)<1e-6,
    'animal deadzone rotation never translates the upper weapon/hand frame');
  assert(Math.abs(lowerBuilds[0].group.position.x+saddleRadius-layout.lowerOffsetX)<1e-6,
    'the rotated lower card still meets the fixed attachment laterally');
  assert(Math.abs(lowerBuilds[0].group.position.z-(layout.lowerOffsetZ+saddleRadius))<1e-6,
    'the lower card pivots like a lever around its attachment');
  for(const yaw of [-Math.PI,-1.2,0,.7,Math.PI]){
    for(const ref of lowerBuilds)ref.group.rotation.y=yaw;
    window.HobunjiOmgurkuSpecies.setPlacement({});
    assert(Math.abs(upper.position.x-neutral.x)<1e-6&&Math.abs(upper.position.z-neutral.z)<1e-6);
    for(const ref of lowerBuilds){
      assert(Math.abs(ref.group.position.x+Math.sin(yaw)*saddleRadius-layout.lowerOffsetX)<1e-6);
      assert(Math.abs(ref.group.position.z+Math.cos(yaw)*saddleRadius-(layout.lowerOffsetZ+saddleRadius))<1e-6);
    }
  }
  for (const ref of lowerBuilds) ref.group.rotation.y = 0;
  window.HobunjiOmgurkuSpecies.setPlacement({});
  assert(Math.abs(upper.position.x - neutral.x) < 1e-6);
  assert(Math.abs(upper.position.z - neutral.z) < 1e-6);
  api.disposeAvatarModel(root);
  assert.equal(walker.applyFacingDeadzone,facing,'disposal leaves the canonical walker method intact');
  api.disposeAvatarModel(root); // Repeated teardown must not double-dispose upper GPU resources.
  assert.equal(lowerDisposals, 3);
  assert.equal(standardDisposals, 1);
  assert.equal(window.HobunjiOmgurkuSpecies.debugSnapshot().liveCount, 0);
  api.buildSinglePlaneAvatarModel({ Group, Vector3 }, {}, { speciesId: 'engh-sho' });
  assert.equal(humanoidBuilds, 2);
  const appearanceRoot=api.buildSinglePlaneAvatarModel({Group,Vector3},{},{appearance:{speciesId:'omgurku'}});
  assert(appearanceRoot.userData.omgurkuComposite,'appearance-only callers receive the hybrid too');
  assert.equal(appearanceRoot.userData.omgurkuComposite.upper.userData.speciesId,'omgurku',
    'appearance-only callers pass species identity to the canonical anatomy builder');
  api.disposeAvatarModel(appearanceRoot);

  // Ridden mounts (Porakaneki Avengers): a whole Nazgraku card under an
  // ordinary rider, sized/floored/saddled from the creature's authored rig and
  // seated by the rider's posterior, never by the live Omgurku calibration.
  rigs.creatures = { nazgraku: { sizeScales: { large: { x: 1.5, y: 1.5 } }, groundOffsets: { large: .31 },
    anchors: { saddle: { position: { x: 0, y: .08, z: 0 } } } } };
  rigs.characters['porakaneki::male'] = { posteriorRule: { heightPercentFromFloor: 36 } };
  window.HOBUNJI_ATTACHMENT_RIG_MATH = { characterPosteriorY: (rule, height) => height * rule.heightPercentFromFloor / 100 };
  const builtBefore = lowerBuilds.length, disposedBefore = lowerDisposals;
  const mounted = api.buildSinglePlaneAvatarModel({ Group, Vector3 }, {}, { mountSpecies: 'nazgraku', profile: { fighter: { speciesId: 'porakaneki', gender: 'male' } } });
  const mc = mounted.userData.omgurkuComposite;
  assert(mc && mc.mount?.lowerRig === 'nazgraku', 'mountSpecies builds the shared rider composite');
  assert.equal(mounted.userData.omgurkuNpc, false);
  assert.equal(mounted.userData.mountSpecies, 'nazgraku');
  assert.equal(mounted.userData.speciesId, 'porakaneki', 'the rider keeps its own species identity');
  assert.equal(mounted.userData.proceduralBodyRoot, mc.upper, 'hostile compound path receives the rider as the body root');
  const mountBuilds = lowerBuilds.slice(builtBefore);
  assert.equal(mountBuilds.length, 3);
  for (const [i, frame] of ['idle', 'run1', 'run2'].entries()) {
    assert(mountBuilds[i].url.endsWith(`/docs/assets/creaturesprites/nazgraku_${frame}.png`), 'regular whiskered Nazgraku frames');
    assert.equal(mountBuilds[i].options.creatureId, 'nazgraku');
    assert(Math.abs(mountBuilds[i].options.modelWidth - 1.21 * 1.5) < 1e-9, 'Large Nazgraku card width');
    assert(Math.abs(mountBuilds[i].options.modelHeight - 1.21 * 378 / 900 * 1.5) < 1e-9, 'Large Nazgraku card height');
  }
  for (const frame of ['idle', 'run1', 'run2']) assert(fs.existsSync(path.join(__dirname, '..', 'docs/assets/creaturesprites', `nazgraku_${frame}.png`)));
  assert(Math.abs(mountBuilds[0].group.position.y - .31) < 1e-9, 'card center sits at the authored Large ground offset');
  const saddleY = .31 + .08 * 1.5;
  assert(Math.abs(mounted.userData.omgurkuJoin.y - saddleY) < 1e-9, 'join is the authored saddle anchor');
  assert(Math.abs(mc.upper.position.y - (saddleY + .5 - .36)) < 1e-9, 'rider posterior rests on the saddle');
  window.HobunjiOmgurkuSpecies.setPlacement({ lowerWidth: 3 });
  assert(Math.abs(mc.placement.lowerWidth - 1.21 * 1.5) < 1e-9, 'Omgurku calibration never resizes a mount');
  api.disposeAvatarModel(mounted);
  assert.equal(lowerDisposals - disposedBefore, 3, 'mount cards release through the compound disposer');
  window.HobunjiOmgurkuConnector={snapshot:()=>({enabled:true}),create(){throw Error('failed connector');}};
  const fallback=api.buildSinglePlaneAvatarModel({Group,Vector3},{},{speciesId:'omgurku'});
  assert(!fallback.userData.omgurkuComposite,'failed optional construction returns the original upper avatar');
  assert.equal(fallback.parent,null,'fallback upper is detached from the failed hybrid root');
  assert.equal(window.HobunjiOmgurkuSpecies.debugSnapshot().liveCount,0,'partial builds do not leak live avatar records');
  assert.equal(fallback.userData.proceduralHandParent,undefined,'fallback removes the hybrid-only hand parent');
  console.log('Omgurku NPC subspecies/hybrid rig tests passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
