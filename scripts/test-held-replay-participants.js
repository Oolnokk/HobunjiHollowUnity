#!/usr/bin/env node
'use strict';

// The hand/foot ground x-ray replays used to include every visible NPC's
// hands and feet; in town that made most draw calls per frame. By default
// only the player's own parts (and parts with no resolvable owner) take part.
// This runs the module's real ownership + split code against a fake scene.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'docs/js/held-object-render-order.js'), 'utf8');
const slice = (startMarker, endMarker) => {
  const a = source.indexOf(startMarker), b = source.indexOf(endMarker, a);
  assert.ok(a > 0 && b > a, 'found ' + startMarker);
  return source.slice(a, b);
};
const code = [
  slice('  const XRAY_TILE_RADIUS =', '  const XRAY_CIRCLE_RADIUS ='),
  slice('  function isDescendantOf(', '  function worldYOf('),
  slice('  function actorRootForXrayMesh(', '  function actorXrayScope('),
].join('\n');

const node = (name, parent = null, userData = {}) => ({ name, parent, userData, isMesh: true, matrixWorld: { elements: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] }, traverse(fn) { fn(this); } });
const at = (mesh, x, z) => { mesh.matrixWorld.elements[12] = x; mesh.matrixWorld.elements[14] = z; return mesh; };
const scene = { isScene: true, parent: null, userData: {} };
const player = node('player_root', scene);
const hand = (parent) => node('hand', parent, { hobunjiProceduralHand: true });
const playerHand = hand(node('arm', player));
const playerFootRig = node('player_feet_rig', scene); // Composer-owned external root.
const playerFootNear = at(node('foot', playerFootRig), 2, 0);
const playerFootFar = at(node('foot', playerFootRig), 9, 0);
const playerBlade = node('blade', player);
const tall = node('npc_walker_takua', scene, { speciesId: 'kenkari' });
const tallHand = hand(node('arm', tall)), tallFoot = at(node('foot', tall), 1, 0), tallSpear = node('spear', tall);
const shorty = node('porakaneki_hunter', scene, { hobunjiXrayActorRoot: true, speciesId: 'porakaneki' });
const shortHand = hand(node('arm', shorty)), shortFootNear = at(node('foot', shorty), 3, 0), shortFootFar = at(node('foot', shorty), 20, 0), shortClub = node('club', shorty);
const orphanHand = hand(node('loose_group', scene)); // No resolvable owner: keeps the old fail-safe x-ray.

const window = { PlayerBodyTransformComposer: { getPlayerMesh: () => player, getVisualRoots: () => [playerFootRig], getPlayerLegHandle: () => null } };
const api = new Function('window', 'performance', code + `
  let footGroundXray = 'off'; // Mirrors the shipped default; opt in for the legacy A/B fixtures below.
  const xrayRule = key => key === 'feet.groundXray' ? footGroundXray : undefined;
  let lastSceneScan = new WeakMap(); // Standalone ownership harness supplies the scene-discovery cache.
  const syncShoulderPetLayering = () => {}; // This test exercises the replay partition only.
  replayCameraPosition = { x: 0, y: 0, z: 0 };
  const repaired = []; // Nonparticipant weapon-hand invariants are maintained in the same split loop.
  const enforceHeldMesh = mesh => repaired.push(mesh);
  return { setFootXray: value => { footGroundXray = value ? 'on' : 'off'; }, setCamera: (x,y,z) => { replayCameraPosition = {x,y,z}; }, ringDefault: localReplayRingEnabled, setRing: v => { localReplayRingEnabled = v; }, ringSkips: () => localReplayRingSkips, actorXrayDefaults, setActorXrayEnabled, refreshActorXrayRoots, split: (m, s, o, foot, repair = false) => splitReplayParticipants(m, s, o, foot, repair), repaired, setPolicy: v => { replayParticipantPolicy = v; }, skips: () => nonParticipantReplaySkips,
    actorOf: (m, s) => actorRootForXrayMesh(m, s), setOwnerLink: v => { heldOwnerLinkEnabled = v; participantCache = new WeakMap(); }, setLimit: n => { otherWeaponXrayLimit = n; },
    budgetSkips: () => otherWeaponXrayBudgetSkips, ownerLinkDefault: heldOwnerLinkEnabled, limitDefault: otherWeaponXrayLimit };`)(window, { now: () => 0 });

// Default geometric grounding keeps every foot and pants mesh in the ordinary pass, including ownerless and legacy-all paths.
const defaultPants = node('pants', player, {hobunjiPantsGarment:true});
const defaultParts = [playerFootNear, tallFoot, shortFootNear, defaultPants, node('orphan_foot', scene)];
for (const policy of ['rule', 'all']) {
  api.setPolicy(policy);
  const ordinary = [];
  assert.deepEqual(api.split(defaultParts, scene, ordinary, true), []);
  assert.deepEqual(ordinary, defaultParts);
}
api.setPolicy('rule');
assert.deepEqual(api.split([playerHand, playerBlade], scene, [], false, true), [playerHand, playerBlade], 'hands and weapons are unchanged');
api.setFootXray(true); // Existing fixtures verify the explicit legacy comparison still works.
// The shipped local gate keeps whole actors together, independent of the camera.
assert.equal(api.ringDefault, true);
at(player, -0.2, -0.2);
at(shorty, -1.2, 0.8);
const nearClub = shortClub;
const farShort = at(node('far_short', scene, { hobunjiXrayActorRoot:true, speciesId:'porakaneki' }), 1.2, -0.2);
const farClub = node('far_club', farShort);
const farOrphan = at(node('orphan', scene), 12, 12);
const ringOthers = [];
assert.deepEqual(api.split([playerBlade, nearClub, farClub, farOrphan], scene, ringOthers, false, true), [playerBlade, nearClub]);
assert.deepEqual(ringOthers, [farClub, farOrphan]);
assert.equal(api.ringSkips(),2);
at(player, 1.5, -0.2);
assert.deepEqual(api.split([nearClub, farClub], scene, [], false, true), [farClub], 'crossing tiles changes membership immediately');
// Foot/pants and hand selection must agree with the same owner tile,
// including the player's scene-sibling visual rigs and linked weapons.
at(player, 0.9, 0.9); at(shorty, 1.9, 1.9); at(farShort, 2.0, 0.9);
const nearFoot = at(node('foot', shorty), 1.9, 1.9);
const farFoot = at(node('foot', farShort), 2.0, 0.9);
const nearPants = at(node('pants', shorty, {hobunjiPantsGarment:true}), 1.9, 1.9);
const farPants = at(node('pants', farShort, {hobunjiPantsGarment:true}), 2.0, 0.9);
const externalHolder = node('external_tool', scene, {hobunjiHeldPortraitOwner:farShort});
externalHolder.isObject3D = true; farShort.isObject3D = true;
const remoteFlail = at(node('flail', externalHolder), 0.5, 0.5);
assert.deepEqual(api.split([nearFoot, farFoot, nearPants, farPants, playerFootNear], scene, [], true),
  [nearFoot, nearPants, playerFootNear], 'feet and pants follow the owner ring, not the part position');
assert.deepEqual(api.split([shortHand, remoteFlail], scene, [], false, true), [shortHand],
  'scene-sibling weapon remains ordinary when its holder is distant, even if the weapon swings into the ring');
// The active player-ring policy supersedes the old six-unit camera sphere.
api.setCamera(0, 20, 0);
assert.deepEqual(api.split([nearFoot,farFoot,nearPants,farPants,playerFootNear],scene,[],true),
  [nearFoot,nearPants,playerFootNear], 'camera elevation cannot disable local foot and pants X-ray');
api.setRing(false);
assert.deepEqual(api.split([nearFoot,nearPants,playerFootNear],scene,[],true), [],
  'legacy range retains the previous camera-distance test');
api.setRing(true);
api.setCamera(0,0,0);
at(player, 1.0, 0.9);
assert.deepEqual(api.split([nearFoot,farFoot,nearPants,farPants],scene,[],true),
  [nearFoot,farFoot,nearPants,farPants], 'diagonal and axial neighbors are admitted immediately across the tile boundary');
assert.deepEqual(api.split([shortHand,remoteFlail],scene,[],false,true),[shortHand,remoteFlail]);
const preview = {isScene:true,parent:null};
assert.deepEqual(api.split([farOrphan],preview,[],false,true),[farOrphan],'unrelated preview scenes retain legacy presentation');
api.setPolicy('all');
assert.deepEqual(api.split([farOrphan],scene,[],false,true),[farOrphan],'explicit full replay bypasses the local gate');
api.setPolicy('rule');
at(player, 0, 0); at(shorty, 0, 0);
api.repaired.length = 0;
api.setRing(false); // The remaining legacy A/B fixtures deliberately exercise the old distance policy.

// Shipped defaults: owners resolved, other characters' weapons in the base pass (budget 0).
assert.equal(api.ownerLinkDefault, true, 'owner link on by default');
assert.deepEqual(api.actorXrayDefaults, { animals: true, enemies: false, player: true });
assert.equal(api.limitDefault, 0, 'other characters\' weapons draw in the base pass by default');
api.setOwnerLink(false); api.setLimit(Infinity); // The Settings "off" position: every weapon x-rays (the rules below).

const linkedPlayerHolder = node('scene_level_tool_holder', scene, { hobunjiHeldPortraitOwner: player });
const linkedPlayerWeapon = node('weapon', linkedPlayerHolder); // Actual gameplay tool holder is a sibling of the avatar.
const linkedPlayerFlail = node('flail_head', linkedPlayerWeapon); // Nested assembly children need the same standing floor.
for (const piece of [linkedPlayerWeapon, linkedPlayerFlail]) {
  assert.equal(api.actorOf(piece, scene)?.root, player);
  assert.equal(api.actorOf(piece, scene)?.isPlayer, true, 'player gear resolves with the NPC owner-link optimization disabled');
}
api.setActorXrayEnabled('enemies', true); // Exercise the standalone replay-participant policy with all actor groups on.
const heldOthers = [];
const held = api.split([playerHand, playerBlade, tallHand, tallSpear, shortHand, shortClub, orphanHand], scene, heldOthers, false);
assert.deepEqual(held, [playerHand, playerBlade, tallSpear, shortHand, shortClub, orphanHand], 'every weapon keeps the x-ray; hands only for the player and short species');
assert.deepEqual(heldOthers, [tallHand], 'a tall species\' hands draw with ordinary depth');
const heldWithRepairOthers = [];
assert.deepEqual(api.split([playerHand, tallHand, tallSpear], scene, heldWithRepairOthers, false, true), [playerHand, tallSpear],
  'single-pass partition leaves the same hands out of the x-ray');
assert.deepEqual(heldWithRepairOthers, [tallHand], 'only the nonparticipant hand remains in the normal scene pass');
assert.deepEqual(api.repaired, [tallHand], 'ordinary held hand invariant repaired once without a second ownership test');
const feetOthers = [];
const feet = api.split([playerFootNear, playerFootFar, tallFoot, shortFootNear, shortFootFar], scene, feetOthers, true);
assert.deepEqual(feet, [playerFootNear, shortFootNear], 'feet x-ray only for the player and short species, and only near the camera');
assert.deepEqual(feetOthers, [playerFootFar, tallFoot, shortFootFar]);
// Pants must follow the production FEET policy through real avatar ancestry,
// not merely pass a mocked standalone owner predicate. This also verifies
// distant NPC garments never force extra actor-centered depth replays.
const pantsAt = (actor, x) => at(node('PantsGarmentMesh', node('avatar', actor),
  { hobunjiPantsGarment: true }), x, 0); // Same nesting as the authored separate pants mesh.
const playerPantsNear = pantsAt(player, 2), playerPantsFar = pantsAt(player, 10);
const tallPants = pantsAt(tall, 1);
const shortPantsNear = pantsAt(shorty, 3), shortPantsFar = pantsAt(shorty, 20);
const pantsOthers = [];
const includedPants = api.split([playerPantsNear, playerPantsFar, tallPants, shortPantsNear, shortPantsFar],
  scene, pantsOthers, true);
assert.deepEqual(includedPants, [playerPantsNear, shortPantsNear],
  'actual player/short avatar pants follow exactly the near-camera feet replay policy');
assert.deepEqual(pantsOthers, [playerPantsFar, tallPants, shortPantsFar],
  'far pants and taller NPC pants stay in ordinary world depth without a replay');


// Scene-sibling hostile weapons (BanditCombat tool holders) name their bearer
// with userData.hobunjiHeldPortraitOwner. With the link off they are unowned
// (fail-safe x-ray); on (the default), they resolve to the bearer and the
// non-player weapon budget can leave them to ordinary depth.
const bandit = (name, x) => at(node(name, scene, {}), x, 0);
const banditA = bandit('bandit_avatar_group', 2), banditB = bandit('bandit_avatar_group', 9), banditC = bandit('bandit_avatar_group', 5);
const holderOf = owner => { const holder = node('banditToolHolder', scene, { hobunjiHeldPortraitOwner: owner }); holder.isObject3D = true; return node('weapon', holder); };
for (const b of [banditA, banditB, banditC]) b.isObject3D = true;
const weaponA = holderOf(banditA), weaponB = holderOf(banditB), weaponC = holderOf(banditC);
assert.equal(api.actorOf(weaponA, scene), null, 'link off: a scene-sibling weapon has no owner (fail-safe path)');
assert.equal(api.actorOf(node('hand_sprite', banditA), scene), null, 'link off: bandit body parts stay unowned too (today\'s behaviour)');
api.setOwnerLink(true);
assert.equal(api.actorOf(weaponA, scene)?.root, banditA, 'link on: resolved to its bearer');
assert.equal(api.actorOf(weaponA, scene)?.isPlayer, false);
assert.equal(api.actorOf(node('hand_sprite', banditA), scene)?.root, banditA, 'bandit_avatar_group is an actor root, as for the portrait mask');
const allArmed = [];
assert.deepEqual(api.split([playerBlade, weaponB, weaponA, weaponC], scene, allArmed, false, true), [playerBlade, weaponB, weaponA, weaponC], 'no budget: every weapon x-rays');
api.setLimit(1);
const budgetOthers = [];
assert.deepEqual(api.split([playerBlade, weaponB, weaponA, weaponC], scene, budgetOthers, false, true), [playerBlade, weaponA],
  'budget 1: the player plus the armed non-player nearest the camera, original order kept');
assert.deepEqual(budgetOthers, [weaponB, weaponC], 'the rest draw with ordinary depth');
assert.equal(api.budgetSkips(), 2);
api.setLimit(0);
const noneOthers = [];
assert.deepEqual(api.split([weaponA, tallSpear, playerBlade, shortClub], scene, noneOthers, false, true), [playerBlade, shortClub],
  'budget 0 (the default): only the player\'s and short species\' weapons x-ray');
assert.deepEqual(noneOthers, [weaponA, tallSpear], 'hostile and NPC weapons draw with their bearer in the base pass');
api.setLimit(Infinity); api.setOwnerLink(false);

api.setPolicy('all');
const othersAll = [];
assert.deepEqual(api.split([tallHand, tallFoot], scene, othersAll, true), [tallHand, tallFoot], "'all' restores the previous participant set");
assert.equal(othersAll.length, 0);

// The category switches take precedence over the legacy all-participants and
// weapon-link A/B settings, while the draw lists keep every excluded part in
// the ordinary pass.
const animal = node('nelk_group', scene);
const pet = node('pingdort_group', player);
const namedAnimal = node('npc_walker_hound', scene, { namedAnimalNpc: true });
const animalFoot = node('animal_foot', animal), petFoot = node('pet_foot', pet);
const namedAnimalFoot = node('hound_foot', namedAnimal);
const enemyFoot = node('enemy_foot', banditA);
window.GridTileAccessors = { getCurrentArea: () => 'farm' };
window.CharacterVisuals = {
  KINDS: { PLAYER: 'player', NPC: 'npc', ENEMY: 'enemy', CORPSE: 'corpse' },
  forEachCharacter(area, visit) {
    assert.equal(area, 'farm');
    visit('player', player);
    visit('companion', animal);
    visit('shoulderPet', pet);
    visit('npc', namedAnimal);
    visit('npc', tall);
    visit('enemy', banditA);
  },
};
const replaySet = [animalFoot, petFoot, namedAnimalFoot, enemyFoot, weaponA, playerBlade, linkedPlayerWeapon,
  linkedPlayerFlail, playerFootNear, tallFoot, tallSpear, orphanHand];
for (const [group, expected] of [
  ['animals', [animalFoot, petFoot, namedAnimalFoot]],
  ['enemies', [enemyFoot, weaponA, tallFoot, tallSpear]],
  ['player', [playerBlade, linkedPlayerWeapon, linkedPlayerFlail, playerFootNear]],
]) {
  assert.equal(api.setActorXrayEnabled(group, false), false);
  api.refreshActorXrayRoots(scene);
  const ordinary = [];
  assert.deepEqual(api.split(replaySet, scene, ordinary, false, true), replaySet.filter(mesh => !expected.includes(mesh)));
  assert.deepEqual(ordinary, expected, group + ' alone uses ordinary depth');
  assert.equal(api.setActorXrayEnabled(group, true), true);
}
for (const group of ['player', 'animals', 'enemies']) api.setActorXrayEnabled(group, false);
const allDisabledOrdinary = [];
assert.deepEqual(api.split(replaySet, scene, allDisabledOrdinary, false, true), [],
  'all-off skips even ownerless held parts and legacy all-participants mode');
assert.deepEqual(allDisabledOrdinary, replaySet, 'all-off retains every mesh in ordinary rendering');
assert.deepEqual(api.split(replaySet, scene, [], true), [], 'all-off also excludes every foot');
for (const group of ['player', 'animals', 'enemies']) api.setActorXrayEnabled(group, true);
assert.equal(api.setActorXrayEnabled('unrecognized', false), null);
assert.deepEqual(api.split(replaySet, scene, [], false, true), replaySet, 'turning the settings back on restores the existing replay policy');

// The split runs inside collectVisible, so the replay entry points need no new names.
assert.match(source, /const held = collectVisible\(heldRegistry, scene, replayOthers\);/);
assert.match(source, /const feet = collectVisible\(waterOccludedRegistry, scene, replayOthers\);/);
assert.match(source, /suppressDraws\(otherParticles\?\.length \? replayOthers\.concat\(otherParticles\) : replayOthers, HELD_OVERLAY_MASK\)/, 'non-participants (and their gear particles) are hidden from the replays that draw the held-overlay layer');
assert.match(source, /const shortXraySpecies = new Set\(\['porakaneki'\]\);/, 'Porakaneki are on the short-species list by default');
console.log('ok - other characters weapons in the base pass by default (x-ray for every weapon when switched off); hands for the player and short species; feet for those, near the camera only');
