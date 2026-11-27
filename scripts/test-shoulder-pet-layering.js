#!/usr/bin/env node
'use strict';

// Exercises production compositor policy without WebGL. Render-list and GPU masking
// receive separate source guards because this fixture has no framebuffer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const game = fs.readFileSync('docs/game.js', 'utf8');
const render = fs.readFileSync('docs/js/held-object-render-order.js', 'utf8');
const attachment = fs.readFileSync('docs/js/shoulder-pet-attachment-runtime.js', 'utf8'); // Confirms the real 180-degree sprite turn keeps its original observation trigger.
const config = fs.readFileSync('docs/js/xray-hierarchy.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');

assert.match(game, /const SHOULDER_PET_XRAY_ENABLED = false/, 'retired pet-specific x-ray remains off');
assert.match(attachment, /shoulderFacingTurnDeg = facingTowardPlayerCenter !== authoredFacesInward/,
  'the attachment resolves the authored heading before choosing its half-turn');
assert.match(game, /function updatePetLayering\(active, pet\)[\s\S]*?HeldObjectRenderOrder\?\.setShoulderPetLayering\?\.\(/,
  'gameplay delegates player/pet visual decisions to the shared compositor');
assert.doesNotMatch(game, /function _setLayerDepthWrite\(/, 'gameplay no longer writes shoulder-pet depth independently');
assert.doesNotMatch(game, /function _setPlayerBodyRenderOrder\(/, 'gameplay no longer reorders shoulder-pet portraits independently');
assert.match(render, /if \(baseWorldPass\) \{[^}]*syncShoulderPetLayering\(camera\)/,
  'the compositor restores its shared policy immediately before a real world draw');
assert.match(render, /const needsOwnerMask = held\.some\(isPortraitMaskedGear\)/,
  'held owners still receive front-art masks in scenes with no nearby ground/water');
assert.match(render, /frontPortraitMaskReason: lastFrontPortraitMaskReason/,
  'mobile diagnostics explain zero eligible/masked gear rather than silently reporting 0\/0');
assert.doesNotMatch(config, /'shoulderPet\\.presentation':\\s*\\{/, 'no independent pet x-ray mode');
assert.doesNotMatch(game, /_cameraSeesPlayerFrontFace/, 'camera side never decides pet occlusion');
assert.doesNotMatch(game, /\bSHOULDER_PET_PLANE_RENDER_ORDER\b/, 'no removed shoulder render constant remains in game startup dependencies');
for (const id of [
  'settingDisableHatXray', 'settingShoulderPetRotationSource',
  'settingInvertShoulderPetRotationSource', 'settingCancelShoulderPetRotationalOffset',
  'settingFrontSpriteXrayThroughShoulderPet', 'settingBackSpriteXrayThroughShoulderPet',
  'settingDisableShoulderFrontXray', 'settingDisableShoulderBackXray',
]) assert.doesNotMatch(index, new RegExp('id="'+id+'"'), 'retired independent pet control stays absent: '+id);

const start = render.indexOf('  const SHOULDER_PET_RENDER_ORDERS');
const end = render.indexOf('  const maskedHands =', start);
assert.ok(start > 0 && end > start, 'shoulder presentation and stencil setup reside inside HeldObjectRenderOrder');
let mode = 'unused';
const actorXrayEnabled = { animals: true }; // Exercise the same group gate as the Performance switch.
const masks = new Set();
let synced = 0;
const windowStub = { HobunjiShoulderSplitLayerParity: { syncAvatar(avatar) { synced++; for (const split of avatar?.group?.children || []) { if (!split.userData?.hobunjiShoulderSplitOverlay) continue; const source = split.userData.hobunjiPlaneFace === 'front' ? avatar.frontPlane : avatar.backPlane; split.renderOrder = source.renderOrder + 0.01; split.material.depthWrite = source.material.depthWrite; } } } };
const registry = { has: mesh => masks.has(mesh), add: mesh => masks.add(mesh), delete: mesh => masks.delete(mesh) };
// The identity portrait faces +Z; the fixtures supply cameras on either side.
const three = { Vector3: class { applyMatrix4() { return this; } }, Matrix4: class { copy() { return this; } invert() { return this; } } };
const view = frontView => ({ getWorldPosition(point) { point.z = frontView ? 5 : -5; return point; } });
const api = new Function('window', 'THREE', 'forEachMaterial', 'xrayRule', 'isFrontPortraitMesh',
  'hasLayer', 'frontPortraitRegistry', 'FRONT_PORTRAIT_MASK_LAYER', 'actorXrayEnabled',
  render.slice(start, end) +
  '\nreturn { setShoulderPetLayering, syncShoulderPetLayering, compareShoulderPetDrawFaces, shoulderPetDrawFace, orders: SHOULDER_PET_RENDER_ORDERS, get state() { return lastShoulderPetDecision; } };')(
    windowStub, three,
    (material, fn) => { for (const entry of Array.isArray(material) ? material : [material]) if (entry) fn(entry); },
    key => key === 'shoulderPet.presentation' ? mode : null,
    mesh => mesh?.name === 'player_avatar_front_plane',
    (mesh, layer) => !!(mesh.layers.mask & (1 << layer)),
    registry, 24, actorXrayEnabled,
  );
const makeMesh = name => ({
  name, isMesh: true, renderOrder: 2, material: { depthWrite: true },
  layers: { mask: 1, enable(layer) { this.mask |= 1 << layer; }, disable(layer) { this.mask &= ~(1 << layer); } },
  userData: {},
});
const front = makeMesh('player_avatar_front_plane');
front.matrixWorld = {}; // Identity in this camera-side fixture.
front.updateWorldMatrix = () => {};
const back = makeMesh('player_avatar_back_plane');
const ownerHatFront = makeMesh('player_avatar_front_hat_xray_plane'); // Tests real auxiliary front portrait depth participation.
const ownerHatBack = makeMesh('player_avatar_back_hat_xray_plane'); // Tests rear hat overlay parity independently.
const unrelatedTransparent = makeMesh('ambient_transparent_effect'); // Unrelated item catches render-list cycles that pairwise tests miss.
const ownerRoot = { children: [front, back, ownerHatFront, ownerHatBack] }; // Fake player's bounded portrait assembly.
for (const mesh of ownerRoot.children) mesh.parent = ownerRoot;
ownerHatFront.renderOrder = 12; // Deliberately later than the foreground pet: the pair sort must still win.
ownerHatBack.renderOrder = 12;
unrelatedTransparent.renderOrder = 10; // Renders in the same transparency list but owns no shoulder-pet stage.

const makePet = () => {
  const petFront = makeMesh('pet_front');
  const petBack = makeMesh('pet_back');
  const splitFront = makeMesh('pet_split_front');
  const splitBack = makeMesh('pet_split_back');
  splitFront.userData = { hobunjiShoulderSplitOverlay: true, hobunjiPlaneFace: 'front' };
  splitBack.userData = { hobunjiShoulderSplitOverlay: true, hobunjiPlaneFace: 'back' };
  return { __hobunjiShoulderFacingInward: false, avatarRef: {
    group: { userData: {}, children: [petFront, petBack, splitFront, splitBack] },
    frontPlane: petFront, backPlane: petBack, splitFront, splitBack,
  } };
};
const pet = makePet();
for (const mesh of pet.avatarRef.group.children) mesh.parent = pet.avatarRef.group;
const activeOwner = { frontMesh: front, backMesh: back }; // Tracks the actual owner meshes in both rigid and skinned portrait test setups.
const use = (companion, viewerSeesFront) => {
  activeOwner.frontMesh = front;
  activeOwner.backMesh = back;
  api.setShoulderPetLayering(companion, front, back, front.material, back.material);
  api.syncShoulderPetLayering(view(viewerSeesFront));
};

function testFacing(inward) {
  pet.__hobunjiShoulderFacingInward = inward;
  use(pet, true);
  const a = pet.avatarRef;
  assert.equal(front.renderOrder, inward ? api.orders.front : api.orders.back);
  assert.equal(back.renderOrder, inward ? api.orders.back : api.orders.front);
  for (const material of [front.material, back.material, a.frontPlane.material, a.backPlane.material]) {
    assert.equal(material.depthWrite, false, 'attached owner/pet remain depth-write-free');
  }
  assert.equal(a.frontPlane.renderOrder, api.orders.pet);
  assert.equal(a.backPlane.renderOrder, api.orders.pet);
  assert.equal(a.frontPlane.renderOrder > front.renderOrder, inward, 'front plane swaps across owner front');
  assert.equal(Math.sign(api.compareShoulderPetDrawFaces('owner-front', 'pet-front')), inward ? -1 : 1,
    'front pet must x-ray over EVERY owner front sprite in its inward pose');
  assert.equal(Math.sign(api.compareShoulderPetDrawFaces('owner-back', 'pet-back')), inward ? 1 : -1,
    'rear pet must x-ray over EVERY owner rear sprite in its outward pose');
  assert.equal(Math.sign(api.compareShoulderPetDrawFaces('owner-front', 'pet-back')), inward ? -1 : 1,
    'cross-face ordering remains consistent while observation flips the pet');
  assert.equal(Math.sign(api.compareShoulderPetDrawFaces('owner-front', 'owner-back')), inward ? -1 : 1,
    'the two owner faces bracket the pet even when shared by a skinned mesh');
  assert.equal(api.shoulderPetDrawFace({object:a.splitFront,material:a.splitFront.material}), 'pet-front');
  assert.equal(api.shoulderPetDrawFace({object:a.splitBack,material:a.splitBack.material}), 'pet-back');
  assert.equal(api.shoulderPetDrawFace({object:ownerHatFront,material:ownerHatFront.material}), 'owner-front');
  assert.equal(api.shoulderPetDrawFace({object:ownerHatBack,material:ownerHatBack.material}), 'owner-back');
  assert.equal(ownerHatFront.material.depthWrite, false, 'hat front cannot depth-occlude paired pet');
  assert.equal(ownerHatBack.material.depthWrite, false, 'hat back cannot depth-occlude paired pet');
  assert.equal(a.backPlane.renderOrder > back.renderOrder, !inward, 'back plane swaps across owner back');
  assert.equal(a.splitFront.renderOrder, a.frontPlane.renderOrder + 0.01, 'split front inherits front stage');
  assert.equal(a.splitBack.renderOrder, a.backPlane.renderOrder + 0.01, 'split back inherits back stage');
  assert.equal(a.splitFront.userData.hobunjiShoulderPortraitFace, 'front', 'split front inherits manual-sort portrait category');
  assert.equal(a.splitBack.userData.hobunjiShoulderPortraitFace, 'back', 'split back inherits manual-sort portrait category');
  assert.equal(a.frontPlane.userData.hobunjiShoulderPortraitFace, 'front');
  assert.equal(a.backPlane.userData.hobunjiShoulderPortraitFace, 'back');
  for (const [mesh, shouldMask] of [
    [a.frontPlane, inward], [a.splitFront, inward],
    [a.backPlane, inward], [a.splitBack, inward],
  ]) {
    assert.equal(masks.has(mesh), shouldMask, 'either animal card can supply the foreground silhouette');
    assert.equal(mesh.userData.hobunjiShoulderPetStencilForeground === true, shouldMask);
  }
  assert.equal(api.state.mode, 'owner-portrait-stages');
  assert.equal(api.state.frontForeground, inward);
  assert.equal(api.state.backForeground, !inward);
  assert.equal(a.group.userData.hobunjiShoulderPetLayering.xrayEnabled, true);
  assert.equal(api.state.pairedFaceSort, true);
  assert.ok(masks.has(front), 'owner front portrait remains eligible for the private stencil');
}
// Manual ordering must not classify a rear split as a front sprite merely
// because a skinned helper material happens to have a front-material name.
const layerStart = render.indexOf('  function visualLayerFor(');
const layerEnd = render.indexOf('  function protectedDrawPhase(', layerStart);
assert.ok(layerStart >= 0 && layerEnd > layerStart);
const visualLayerFor = new Function('isPresentationBackdrop', 'heldPriorityLayer', 'surfaceKindForObject',
  render.slice(layerStart, layerEnd) + '\nreturn visualLayerFor;')(
    () => false, () => 'actor.hands', () => 'solid');
assert.equal(visualLayerFor({object: {name:'split',userData:{hobunjiShoulderPortraitFace:'front'}},
  material: {name:'avatar_skinned_back_material'}}), 'actor.front');
assert.equal(visualLayerFor({object: {name:'split',userData:{hobunjiShoulderPortraitFace:'back'}},
  material: {name:'avatar_skinned_front_material'}}), 'actor.rear');

testFacing(false);
pet.__hobunjiShoulderFacingInward = true; // The active pet switches observation pose without reattachment.
api.syncShoulderPetLayering(view(true));
assert(front.renderOrder < pet.avatarRef.backPlane.renderOrder, 'either animal card draws above the front portrait when inward');
assert(back.renderOrder > pet.avatarRef.frontPlane.renderOrder, 'either animal card draws behind the rear portrait when inward');
assert(masks.has(pet.avatarRef.backPlane), 'the visible reverse card can stamp the front-view mask');
api.syncShoulderPetLayering(view(false));
assert(!masks.has(pet.avatarRef.backPlane), 'the rear view omits the inward pet from the foreground mask');
pet.__hobunjiShoulderFacingInward = false;
api.syncShoulderPetLayering(view(false));
assert(front.renderOrder > pet.avatarRef.backPlane.renderOrder, 'the front portrait covers either animal card in the outward pose');
assert(back.renderOrder < pet.avatarRef.frontPlane.renderOrder, 'the animal stays in front of the rear portrait in the outward pose');
assert(masks.has(pet.avatarRef.frontPlane), 'the rear view can stamp either card in the outward pose');
testFacing(true);

// Exercise the common skinned owner, where one mesh has two material-group
// render items. The compositor must classify by each group's real material.
const sharedSkinnedOwner = makeMesh('player_avatar_skinned_plane');
// Material groups keep their face identity even if a live rebuild leaves names blank.
const skinnedFrontMaterial = {depthWrite:true};
const skinnedBackMaterial = {depthWrite:true};
activeOwner.frontMesh = sharedSkinnedOwner;
activeOwner.backMesh = sharedSkinnedOwner;
api.setShoulderPetLayering(pet,sharedSkinnedOwner,sharedSkinnedOwner,skinnedFrontMaterial,skinnedBackMaterial);
assert.equal(api.shoulderPetDrawFace({object:sharedSkinnedOwner,material:skinnedFrontMaterial}), 'owner-front',
  'one skinned owner mesh still exposes its front material stage');
assert.equal(api.shoulderPetDrawFace({object:sharedSkinnedOwner,material:skinnedBackMaterial}), 'owner-back',
  'one skinned owner mesh still exposes its back material stage');
use(pet, true);

// Execute the production transparent-sort transaction for BOTH normal and
// manual categories; the previous compositor checked renderOrder only, which
// let manual ranking or an owner hat overlay silently reverse the pet x-ray.
const sorterStart = render.indexOf('  function withVisualSort(');
const sorterEnd = render.indexOf('  function nearbyPortraitOrder(', sorterStart);
const rankedSortStart = render.indexOf('  function comparePortraitDraws('); // Actual camera-depth comparator, needed when another NPC activates actor sorting.
const rankedSortEnd = render.indexOf('  function withPortraitDrawOrder(', rankedSortStart);
assert(rankedSortStart > 0 && rankedSortEnd > rankedSortStart, 'production actor-depth sorter is available');
const rankedPortraitCompare = new Function('PORTRAIT_SORT_ORDER',
  render.slice(rankedSortStart, rankedSortEnd) + '\nreturn comparePortraitDraws;')(2);
const faceRankStart = render.indexOf('  function shoulderPetFaceSortRank(');
const faceRankEnd = render.indexOf('  function compareShoulderPetDrawFaces(', faceRankStart);
assert(faceRankStart > 0 && faceRankEnd > faceRankStart, 'production face-rank helper is available for the real transparent sorter');
assert(sorterStart > 0 && sorterEnd > sorterStart);
const stateRef = { get pet() { return api.state.active ? pet : null; },
  get frontMesh() { return activeOwner.frontMesh; }, get backMesh() { return activeOwner.backMesh; } }; // Reflects the actual skinned/rigid owner passed into the compositor.
const overrideRank = category => category === 'garment.headwear' ? 8 : 1; // Manual sorter deliberately prefers owner hat over pet front art.
windowStub.XrayHierarchy = { layerRank: overrideRank };
let useManual = false;
const drawTransactionEnd = render.indexOf('  function rankedHeldOverlayOrder(', rankedSortEnd); // Includes the main draw's scoped material changes.
const { withVisualSort: productionSort, withPortraitDrawOrder: productionDraw } = new Function('window', 'xrayRule', 'visualLayerFor', 'protectedDrawPhase',
  'comparePortraitDraws', 'shoulderPetPresentation', 'previouslyPresentedPet', 'shoulderPetDrawFace', 'compareShoulderPetDrawFaces', 'SHOULDER_PET_RENDER_ORDERS', 'forEachMaterial',
  render.slice(faceRankStart, faceRankEnd) + render.slice(sorterStart,sorterEnd)
    + render.slice(rankedSortEnd, drawTransactionEnd) + '\nreturn { withVisualSort, withPortraitDrawOrder };')(
  windowStub, key => key === 'layers.manualOrder' && useManual ? 'on' : 'off',
  item => item.object === ownerHatFront ? 'garment.headwear' : 'actor.front',
  () => 0,
  rankedPortraitCompare, stateRef, pet, api.shoulderPetDrawFace, api.compareShoulderPetDrawFaces, api.orders,
  (material, fn) => fn(material));
const sorterRenderer = {
  sort: null, setTransparentSort(value) { this.sort = value; },
  setOpaqueSort() {},
};
const drawItem = (mesh) => ({ object:mesh, material:mesh.material, groupOrder:0,
  renderOrder:mesh.renderOrder, z:0, id:0 });
for (const inward of [false, true]) for (const manual of [false, true]) {
  pet.__hobunjiShoulderFacingInward = inward;
  use(pet, true);
  useManual = manual;
  productionSort(sorterRenderer, null, () => {
    assert.equal(typeof sorterRenderer.sort, 'function', 'paired x-ray installs a sorter even without a nearby NPC');
    const frontPair = sorterRenderer.sort(drawItem(pet.avatarRef.frontPlane), drawItem(ownerHatFront));
    const backPair = sorterRenderer.sort(drawItem(pet.avatarRef.backPlane), drawItem(ownerHatBack));
    assert.equal(Math.sign(frontPair), inward ? 1 : -1, 'front face ordering survives owner hat and manual sort');
    assert.equal(Math.sign(backPair), inward ? -1 : 1, 'rear face ordering survives owner hat and manual sort');
    const splitPair = sorterRenderer.sort(drawItem(pet.avatarRef.splitFront), drawItem(ownerHatFront));
    assert.equal(Math.sign(splitPair), inward ? 1 : -1, 'split face follows foreground under both sort modes');
  });
}
// Pairwise checks cannot detect a non-transitive sorter: Three sorts all
// skinned materials, split cards and hats together. Cycle the real draw items
// through different input permutations so an observation flip cannot preserve
// stale x-ray ordering just because another item was compared first.
for (const inward of [false, true]) for (const manual of [false, true]) {
  pet.__hobunjiShoulderFacingInward = inward;
  use(pet, true);
  useManual = manual;
  const base = [
    drawItem(pet.avatarRef.frontPlane), drawItem(front), drawItem(back),
    drawItem(pet.avatarRef.backPlane), drawItem(ownerHatFront), drawItem(ownerHatBack),
    drawItem(pet.avatarRef.splitFront), drawItem(pet.avatarRef.splitBack), drawItem(unrelatedTransparent),
  ]; // Includes both owner faces, hats at order 12, split overlays and an unrelated transparent item.
  productionSort(sorterRenderer, null, () => {
    for (let shift = 0; shift < base.length; shift++) for (const reverse of [false, true]) {
      const shuffled = base.slice(shift).concat(base.slice(0, shift));
      if (reverse) shuffled.reverse();
      shuffled.sort(sorterRenderer.sort);
      const positions = new Map(shuffled.map((item, index) => [item.object, index])); // Verify the complete array, not just one comparator invocation.
      const indexOf = mesh => positions.get(mesh);
      const petFront = indexOf(pet.avatarRef.frontPlane), petBack = indexOf(pet.avatarRef.backPlane);
      const ownerFront = indexOf(front), ownerBack = indexOf(back);
      assert.equal(petFront > ownerFront, inward, 'observation flip swaps the pet front across its owner (full sort)');
      assert.equal(petFront > indexOf(ownerHatFront), inward, 'front pet crosses its owner hat even when the hat sort order is late');
      assert.equal(petBack > ownerBack, !inward, 'observation flip swaps the pet back across its owner (full sort)');
      assert.equal(petBack > indexOf(ownerHatBack), !inward, 'back pet crosses its owner hat even when the hat sort order is late');
      assert.ok(indexOf(pet.avatarRef.splitFront) > petFront, 'front split follows its parent front card');
      assert.ok(indexOf(pet.avatarRef.splitBack) > petBack, 'back split follows its parent back card');
    }
  });
}
// Repeating the same whole-list checks with the actual skinned-owner shape
// catches both front/back material groups sharing one mesh and renderOrder.
for (const inward of [false, true]) {
  pet.__hobunjiShoulderFacingInward = inward;
  activeOwner.frontMesh = sharedSkinnedOwner;
  activeOwner.backMesh = sharedSkinnedOwner;
  api.setShoulderPetLayering(pet, sharedSkinnedOwner, sharedSkinnedOwner,
    skinnedFrontMaterial, skinnedBackMaterial);
  useManual = false;
  const ownerFrontItem = { ...drawItem(sharedSkinnedOwner), material: skinnedFrontMaterial };
  const ownerBackItem = { ...drawItem(sharedSkinnedOwner), material: skinnedBackMaterial };
  productionSort(sorterRenderer, null, () => {
    const items = [
      drawItem(pet.avatarRef.frontPlane), ownerBackItem, drawItem(ownerHatFront),
      ownerFrontItem, drawItem(pet.avatarRef.backPlane), drawItem(ownerHatBack),
    ].sort(sorterRenderer.sort);
    const position = item => items.indexOf(item);
    const petFrontItem = items.find(item => item.object === pet.avatarRef.frontPlane);
    const petBackItem = items.find(item => item.object === pet.avatarRef.backPlane);
    const hatFrontItem = items.find(item => item.object === ownerHatFront);
    const hatBackItem = items.find(item => item.object === ownerHatBack);
    assert.equal(position(petFrontItem) > position(ownerFrontItem), inward, 'skinned owner front flips relative to pet');
    assert.equal(position(petFrontItem) > position(hatFrontItem), inward, 'skinned owner hat front respects pet pose');
    assert.equal(position(petBackItem) > position(ownerBackItem), !inward, 'skinned owner back flips relative to pet');
    assert.equal(position(petBackItem) > position(hatBackItem), !inward, 'skinned owner hat back respects pet pose');
  });
}
// A second visible actor activates the game's ranked-portrait draw path.
// The pet's face sprites and the owner's hat must keep exactly the same
// relative ordering whether the pet itself was registered as an actor
// portrait or inherited its holder's player rank through the compositor.
const nearbyNpcPortrait = makeMesh('npc_avatar_front_plane'); // Represents another visible actor whose depth ranking enables the ranked sorter.
for (const inward of [false, true]) for (const manual of [false, true]) for (const petDirectlyRanked of [false, true]) for (const npcDepth of [0.1, 0.6]) {
  pet.__hobunjiShoulderFacingInward = inward;
  use(pet, true);
  useManual = manual;
  const ownerRank = { owner: { id: 1 }, depth: 0.3 }; // The active player's rank, reused by the pet's two face stages.
  const npcRank = { owner: { id: 2 }, depth: npcDepth }; // Compare actors nearer and farther than the player without affecting the pet's internal ordering.
  const ranks = new Map([[front, ownerRank], [back, ownerRank], [nearbyNpcPortrait, npcRank]]);
  if (petDirectlyRanked) { ranks.set(pet.avatarRef.frontPlane, ownerRank); ranks.set(pet.avatarRef.backPlane, ownerRank); }
  const nearbyActorOrder = { ranks, extras: new Map() };
  const items = [
    drawItem(pet.avatarRef.frontPlane), drawItem(front), drawItem(pet.avatarRef.backPlane),
    drawItem(back), drawItem(ownerHatFront), drawItem(ownerHatBack),
    drawItem(pet.avatarRef.splitFront), drawItem(pet.avatarRef.splitBack),
    drawItem(nearbyNpcPortrait), drawItem(unrelatedTransparent),
  ]; // Uses the exact portrait/split/hat/effect combination that previously produced non-transitive comparisons.
  productionSort(sorterRenderer, nearbyActorOrder, () => {
    const compare = sorterRenderer.sort; // Real production comparator; inspect its complete sorted arrays and transitivity.
    for (let shift = 0; shift < items.length; shift++) for (const reverse of [false, true]) {
      const ordered = items.slice(shift).concat(items.slice(0, shift));
      if (reverse) ordered.reverse();
      ordered.sort(compare);
      const indexOf = mesh => ordered.findIndex(item => item.object === mesh); // Reads the actual sorted list, including the external actor.
      assert.equal(indexOf(nearbyNpcPortrait) < indexOf(front), npcDepth > ownerRank.depth,
        'all actor portraits keep far-to-near order while the shoulder pet flips');
      assert.equal(indexOf(pet.avatarRef.frontPlane) > indexOf(ownerHatFront), inward,
        'nearby NPC and manual ranks must not prevent the front observation face swap');
      assert.equal(indexOf(pet.avatarRef.backPlane) > indexOf(ownerHatBack), !inward,
        'nearby NPC and manual ranks must not prevent the rear observation face swap');
      assert.ok(indexOf(pet.avatarRef.splitFront) > indexOf(pet.avatarRef.frontPlane),
        'front split overlays follow the observed orientation under ranked-actor sorting');
      assert.ok(indexOf(pet.avatarRef.splitBack) > indexOf(pet.avatarRef.backPlane),
        'back split overlays follow the observed orientation under ranked-actor sorting');
    }
    // A cyclic comparator can pass a few handpicked arrays but produce a
    // different output when Three.js submits the same objects in another order.
    // Exhaust all triples of these ten items, not just matching pet/owner pairs.
    for (const a of items) for (const b of items) for (const c of items) {
      if (a === b || b === c || a === c) continue;
      assert.ok(!(compare(a, b) < 0 && compare(b, c) < 0 && compare(c, a) < 0),
        'ranked transparent-list comparisons must remain transitive across nearby actors and effects');
    }
  });
}
// The ordinary player portrait is one SkinnedMesh with two material groups;
// combine that real shape with nearby-actor sorting, rather than testing its
// two material groups only in an otherwise empty scene.
for (const inward of [false, true]) for (const manual of [false, true]) {
  pet.__hobunjiShoulderFacingInward = inward;
  activeOwner.frontMesh = sharedSkinnedOwner;
  activeOwner.backMesh = sharedSkinnedOwner;
  api.setShoulderPetLayering(pet, sharedSkinnedOwner, sharedSkinnedOwner,
    skinnedFrontMaterial, skinnedBackMaterial);
  useManual = manual;
  const playerRank = { owner: { id: 1 }, depth: 0.3 }; // Both material groups receive one shared actor camera-depth rank.
  const npcRank = { owner: { id: 2 }, depth: 0.6 }; // Another actor activates portrait depth sorting.
  const rankedOrder = { ranks: new Map([[sharedSkinnedOwner, playerRank], [nearbyNpcPortrait, npcRank]]), extras: new Map() };
  const frontItem = { ...drawItem(sharedSkinnedOwner), material: skinnedFrontMaterial };
  const backItem = { ...drawItem(sharedSkinnedOwner), material: skinnedBackMaterial };
  productionSort(sorterRenderer, rankedOrder, () => {
    const items = [
      drawItem(pet.avatarRef.frontPlane), frontItem, drawItem(ownerHatFront),
      drawItem(pet.avatarRef.backPlane), backItem, drawItem(ownerHatBack),
      drawItem(nearbyNpcPortrait), drawItem(unrelatedTransparent),
    ]; // Covers skinned front/back groups, both pet faces, hats, a nearby NPC and unrelated art.
    for (let shift = 0; shift < items.length; shift++) for (const reverse of [false, true]) {
      const ordered = items.slice(shift).concat(items.slice(0, shift));
      if (reverse) ordered.reverse();
      ordered.sort(sorterRenderer.sort);
      const position = item => ordered.indexOf(item); // Distinguishes two render items sharing the same SkinnedMesh object.
      const petFront = ordered.find(item => item.object === pet.avatarRef.frontPlane);
      const petBack = ordered.find(item => item.object === pet.avatarRef.backPlane);
      const hatFront = ordered.find(item => item.object === ownerHatFront);
      const hatBack = ordered.find(item => item.object === ownerHatBack);
      assert.equal(position(petFront) > position(frontItem), inward,
        'the real skinned front material must swap relative to the pet front on observation');
      assert.equal(position(petBack) > position(backItem), !inward,
        'the real skinned back material must swap relative to the pet back on observation');
      assert.equal(position(petFront) > position(hatFront), inward,
        'skinned front-owner hats remain in the same pet orientation stage');
      assert.equal(position(petBack) > position(hatBack), !inward,
        'skinned back-owner hats remain in the same pet orientation stage');
    }
  });
}
// Exercise both layout shapes with live back-stow classification and an unrelated hand-carried load.
const stowedLoad = makeMesh('stowed_burden'); // Alternately represents ordinary furniture and a baby PNG.
const babyHand = makeMesh('family_baby_left_hand'); // Modeled parts keep their real depth.
babyHand.userData.shattercaskKeepsOwnDepth = true;
babyHand.material.transparent = false;
babyHand.material.depthTest = true;
const heldLoad = makeMesh('hand_carried_burden'); // Must retain its original layer while the back is occupied.
const rearReplacement = makeMesh('shattercask_carrier_rear_only_xray'); // Normal skinned owner's visible rear pass while stowed.
rearReplacement.userData.shattercaskRearOverlay = true;
stowedLoad.renderOrder = 2.15;
heldLoad.renderOrder = 1.4;
rearReplacement.renderOrder = 2.05;
windowStub.Shattercasks = {
  backCarriedInfo: () => ({ kind: stowedLoad.userData.hobunjiFamilyBabyPhysicalCarry ? 'familyBaby' : 'witchBomb' }),
  isStowedSortMesh: mesh => mesh === stowedLoad || mesh === babyHand,
  stowedDepthParts: () => stowedLoad.userData.hobunjiFamilyBabyPhysicalCarry ? [babyHand] : [],
};
for (const skinned of [false, true]) for (const inward of [false, true]) {
  pet.__hobunjiShoulderFacingInward = inward;
  use(pet, true);
  if (skinned) {
    activeOwner.frontMesh = sharedSkinnedOwner;
    activeOwner.backMesh = sharedSkinnedOwner;
    api.setShoulderPetLayering(pet, sharedSkinnedOwner, sharedSkinnedOwner, skinnedFrontMaterial, skinnedBackMaterial);
  }
  const frontItem = { ...drawItem(activeOwner.frontMesh), material: skinned ? skinnedFrontMaterial : front.material }; // The live carrier front.
  const rearItem = drawItem(skinned ? rearReplacement : back); // The rear material is replaced only for the skinned carrier.
  const petItems = pet.avatarRef.group.children.map(drawItem); // Check both faces and both split overlays.
  const actor = { owner: { id: 1 }, depth: 0.3 }; // A nearby NPC activates the actor-depth comparison path.
  const ranked = {
    ranks: new Map([[activeOwner.frontMesh, actor], [rearItem.object, actor],
      [nearbyNpcPortrait, { owner: { id: 2 }, depth: 0.7 }]]),
    extras: new Map([[stowedLoad, actor], [heldLoad, actor]]),
  };
  for (const baby of [false, true]) for (const order of [null, ranked]) for (const manual of [false, true]) {
    stowedLoad.userData.hobunjiFamilyBabyPhysicalCarry = baby;
    useManual = manual;
    productionDraw(sorterRenderer, order, () => {
      const hand = drawItem(babyHand); // Checks the opaque-to-transparent handoff in the actual base-draw transaction.
      const load = drawItem(stowedLoad); // The same sorter stage applies to ordinary furniture and babies.
      const items = [frontItem, load, ...petItems, rearItem, drawItem(ownerHatBack), drawItem(ownerHatFront)];
      if (baby) {
        assert.equal(babyHand.material.transparent, true, 'the modeled limb joins the pet sort queue');
        assert.equal(babyHand.material.depthWrite, true, 'the modeled limb retains depth writing');
        assert.equal(babyHand.material.depthTest, true, 'the modeled limb retains its world depth test');
        items.push(hand);
      }
      if (order) items.push(drawItem(nearbyNpcPortrait));
      if (!manual) items.push(drawItem(heldLoad));
      items.reverse().sort(sorterRenderer.sort);
      for (const petItem of petItems) {
        assert.ok(items.indexOf(rearItem) < items.indexOf(petItem), 'the rear portrait stays behind the pet');
        assert.ok(items.indexOf(petItem) < items.indexOf(load), 'the stowed load paints over every pet card');
        if (baby) assert.ok(items.indexOf(petItem) < items.indexOf(hand), 'baby limbs also paint over every pet card');
      }
      assert.ok(items.indexOf(load) < items.indexOf(frontItem), 'the carrier front still occludes the stowed load');
      assert.ok(items.indexOf(load) < items.findIndex(item => item.object === ownerHatFront),
        'the carrier front hat remains in front of the stowed load');
      if (!manual) assert.ok(items.findIndex(item => item.object === heldLoad) < items.indexOf(load),
        'the hand-carried load keeps its ordinary sort stage');
      if (baby) assert.ok(items.indexOf(hand) < items.indexOf(load), 'the baby PNG can depth-test against the limbs');
    }, true);
    assert.equal(babyHand.material.transparent, false, 'the later shell and depth passes see the original material');
  }
}
assert.throws(() => productionDraw(sorterRenderer, null, () => {
  assert.equal(babyHand.material.transparent, true);
  throw new Error('interrupted stowed baby draw');
}, true), /interrupted stowed baby draw/);
assert.equal(babyHand.material.transparent, false, 'an interrupted world draw restores the limb material');
delete windowStub.Shattercasks;
use(pet, true); // Restore the original rigid owner for detachment assertions.
testFacing(true);
use(pet, false);
assert.equal(pet.avatarRef.frontPlane.renderOrder, api.orders.pet, 'orbiting the camera does not change the pet stage');
assert.equal(pet.avatarRef.backPlane.renderOrder, api.orders.pet);
testFacing(false);

front.material.depthWrite = true;
front.renderOrder = 91;
api.syncShoulderPetLayering();
assert.equal(front.material.depthWrite, false, 'late depth-write changes are repaired before draw');
assert.equal(front.renderOrder, api.orders.back, 'outward front priority is restored before draw');

const replacement = makePet();
use(replacement, false);
assert.equal(pet.avatarRef.frontPlane.material.depthWrite, true, 'old pet depth restored');
assert.equal(pet.avatarRef.frontPlane.renderOrder, api.orders.front, 'old pet joins regular actor sort');
assert.equal(pet.avatarRef.frontPlane.userData.hobunjiShoulderPortraitFace, undefined);
assert.equal(pet.avatarRef.group.userData.hobunjiShoulderPetLayering, undefined);
assert.equal(masks.has(pet.avatarRef.backPlane), false, 'old pet cannot mask owner tools');
assert.equal(masks.has(replacement.avatarRef.backPlane), true, 'replacement pet masks with either card from the rear');

use(null, false);
assert.equal(front.material.depthWrite, true, 'detaching restores owner front depth');
assert.equal(back.material.depthWrite, true, 'detaching restores owner back depth');
assert.equal(front.renderOrder, api.orders.front);
assert.equal(back.renderOrder, api.orders.back);
assert.equal(replacement.avatarRef.frontPlane.material.depthWrite, true);
assert.equal(replacement.avatarRef.group.userData.hobunjiShoulderPetLayering, undefined);
assert.equal(masks.has(replacement.avatarRef.frontPlane), false);
assert.equal(masks.has(replacement.avatarRef.backPlane), false);
assert.equal(ownerHatFront.material.depthWrite, true, 'detachment restores original front hat depth');
assert.equal(ownerHatBack.material.depthWrite, true, 'detachment restores original back hat depth');
assert.equal(api.state.active, false);
assert.ok(synced >= 5, 'split sprites synchronized on swaps and detachment');

use(pet, true);
actorXrayEnabled.animals = false;
api.syncShoulderPetLayering(view(true));
assert.equal(api.state.active, false, 'animal x-ray off restores ordinary shoulder-pet depth');
assert.equal(api.shoulderPetDrawFace({ object: pet.avatarRef.frontPlane }), null, 'the disabled pet is absent from the special portrait sort');
assert.equal(pet.avatarRef.frontPlane.material.depthWrite, true);
assert.equal(front.material.depthWrite, true);
actorXrayEnabled.animals = true;
api.syncShoulderPetLayering(view(true));
assert.equal(api.state.active, true, 're-enabling restores layering without detaching the pet');

// The actual gameplay path no longer enables the legacy portrait-stage stack.
api.setShoulderPetLayering(pet, front, back, front.material, back.material, { geometricDepth: true });
api.syncShoulderPetLayering(view(true));
assert.equal(api.state.mode, 'geometric-depth');
assert.equal(api.state.xrayEnabled, false);
assert.equal(api.shoulderPetDrawFace({ object: pet.avatarRef.frontPlane }), null);
assert.equal(front.material.depthWrite, true);
assert.equal(back.material.depthWrite, true);
assert.equal(pet.avatarRef.frontPlane.material.depthWrite, true);
actorXrayEnabled.animals = false;
api.syncShoulderPetLayering(view(false));
assert.equal(api.state.mode, 'geometric-depth', 'animal x-ray toggle does not restore shoulder x-ray');
actorXrayEnabled.animals = true;
api.syncShoulderPetLayering(view(true));
assert.equal(api.state.xrayEnabled, false);
console.log('Shoulder pet paired front/back occlusion and geometric depth: ok');
