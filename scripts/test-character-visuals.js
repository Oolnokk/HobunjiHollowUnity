#!/usr/bin/env node
'use strict';

// Executes the character-visual layer:
//  * js/character-visuals.js — enumeration by kind, kind filters, early stop,
//    portrait-mesh resolution, capability audit.
//  * js/character-held-tools.js — one weapon factory for every holder; the
//    player's tools use the player's mastery/plating, other holders their own
//    (or none), and a non-player metal weapon gets its own texture variant.
//  * js/cloud-forest-avatar-depth-occluder.js — mist depth helpers for every
//    character in the mist, not just the player and their shoulder pet.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

// ── Minimal THREE ───────────────────────────────────────────────────────────
class Object3D {
  constructor() { this.children = []; this.parent = null; this.userData = {}; this.visible = true; this.name = ''; this.uuid = 'u' + (Object3D.seq = (Object3D.seq || 0) + 1); this.rotation = { x: 0, y: 0, z: 0 }; this.layers = { mask: 1 }; }
  add(child) { if (child.parent) child.parent.remove(child); this.children.push(child); child.parent = this; return this; }
  remove(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); if (child.parent === this) child.parent = null; return this; }
  traverse(fn) { fn(this); for (const child of this.children.slice()) child.traverse(fn); }
  getObjectByName(name) { let found = null; this.traverse(o => { if (!found && o.name === name) found = o; }); return found; }
}
class Group extends Object3D { constructor() { super(); this.isGroup = true; } }
class Scene extends Object3D { constructor() { super(); this.isScene = true; } }
class Material {
  constructor(params = {}) { Object.assign(this, { depthWrite: true, alphaTest: 0, side: 0 }, params); }
  clone() { return new Material({ ...this }); }
  dispose() { this.disposed = true; }
}
class Mesh extends Object3D { constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry || {}; this.material = material; } }
class SkinnedMesh extends Mesh { constructor(geometry, material) { super(geometry, material); this.isSkinnedMesh = true; this.bindMatrix = { copy() {} }; this.bindMatrixInverse = { copy() {} }; } }
class PlaneGeometry { constructor(w, h) { this.parameters = { width: w, height: h }; } }
class Texture { constructor(url) { this.url = url; this.image = { width: 10, height: 30 }; } }
const THREE = {
  Object3D, Group, Scene, Mesh, SkinnedMesh, PlaneGeometry, MeshBasicMaterial: Material,
  DoubleSide: 2, NearestFilter: 1003, NoBlending: 0,
  TextureLoader: class { load(url, onLoad) { const t = new Texture(url); if (onLoad) onLoad(t); return t; } },
};

// ── CharacterVisuals registry ───────────────────────────────────────────────
const win = { THREE, console, performance: { now: () => 0 }, addEventListener() {} };
win.window = win;
const documentStub = { readyState: 'loading', addEventListener() {}, createElement: () => ({ width: 0, height: 0 }) };
const context = vm.createContext({ window: win, THREE, console, performance: win.performance, Promise, document: documentStub, setTimeout: () => 0 });
vm.runInContext(read('docs/js/character-visuals.js'), context, { filename: 'character-visuals.js' });
const CV = win.CharacterVisuals;
const K = CV.KINDS;

function portraitRoot(materialName, depthWrite) {
  const rootNode = new Group();
  const portrait = new SkinnedMesh({}, new Material({ name: materialName, depthWrite, map: {} }));
  portrait.name = 'portrait';
  const hand = new Mesh({}, new Material({ name: 'hand' }));
  rootNode.add(hand);
  rootNode.add(portrait);
  return { rootNode, portrait };
}
const scene = new Scene();
const player = portraitRoot('npc_avatar_skinned_front_material', false);
const npc = portraitRoot('npc_avatar_skinned_front_material', false);
const enemy = portraitRoot('npc_avatar_skinned_front_material', true); // Writes depth itself: no extra draw.
const creatureRoot = new Group();
const creatureFront = new Mesh({}, new Material({ name: 'creature_front', depthWrite: false, map: {} }));
const creatureBack = new Mesh({}, new Material({ name: 'creature_back', depthWrite: false, map: {} }));
creatureRoot.add(creatureFront); creatureRoot.add(creatureBack);
const pet = { health: 10, avatarRef: { frontPlane: new Mesh({}, new Material({ name: 'pet_front', depthWrite: false })), backPlane: null } };
const petRoot = new Group(); petRoot.add(pet.avatarRef.frontPlane);
for (const node of [player.rootNode, npc.rootNode, enemy.rootNode, creatureRoot, petRoot]) scene.add(node);

let npcPresent = true;
CV.registerProvider({
  id: 'test',
  each(area, visit) {
    if (area !== 'cloud') return;
    if (visit(K.PLAYER, player.rootNode, {}, null)) return;
    if (npcPresent && visit(K.NPC, npc.rootNode, {}, null)) return;
    if (visit(K.ENEMY, enemy.rootNode, {}, null)) return;
    if (visit(K.CREATURE, creatureRoot, { avatarRef: { frontPlane: creatureFront, backPlane: creatureBack } }, null)) return;
    visit(K.SHOULDER_PET, petRoot, pet, player.rootNode);
  },
});

const seen = [];
CV.forEachCharacter('cloud', kind => { seen.push(kind); });
assert.deepEqual(seen, ['player', 'npc', 'enemy', 'creature', 'shoulderPet'], 'every kind is enumerated');
const humanoids = [];
CV.forEachCharacter('cloud', kind => { humanoids.push(kind); }, CV.HUMANOID_KINDS);
assert.deepEqual(humanoids, ['player', 'npc', 'enemy'], 'kind filter');
let visits = 0;
CV.forEachCharacter('cloud', () => { visits++; return true; });
assert.equal(visits, 1, 'returning true stops the enumeration');
assert.equal(CV.portraitMeshOf(npc.rootNode), npc.portrait, 'portrait mesh is the shared avatar material mesh, not a hand');
assert.equal(CV.portraitMeshOf(npc.rootNode), npc.portrait, 'cached');
npc.rootNode.remove(npc.portrait);
const rebuilt = new SkinnedMesh({}, new Material({ name: 'npc_avatar_skinned_front_material', depthWrite: false, map: {} }));
npc.rootNode.add(rebuilt);
assert.equal(CV.portraitMeshOf(npc.rootNode), rebuilt, 'a rebuilt portrait replaces the stale cache entry');
npc.portrait = rebuilt;

const report = CV.audit('cloud');
assert.equal(report.characters.player, 1);
assert.equal(report.characters.shoulderPet, 1);
assert.ok(report.capabilities.every(entry => entry.owner && Array.isArray(entry.covers)), 'every capability names its owner and kinds');
assert.ok(report.capabilities.filter(entry => entry.playerOnly).every(entry => entry.gap), 'every player-only capability explains its gap');
const mist = report.capabilities.find(entry => entry.id === 'mist-depth-occluder');
assert.deepEqual(plain(mist.missing), [], 'mist depth occlusion covers every kind');
assert.ok(report.capabilities.find(entry => entry.id === 'held-tool-mesh').covers.includes('enemy'), 'held tools cover enemies');

// ── Mist depth occluder: every character in the mist ───────────────────────
const mistGroup = new Group(); mistGroup.name = 'cloud_forest_mist_cylinders'; scene.add(mistGroup);
let fogUpdates = 0;
win.CloudForestFog = { update() { fogUpdates++; }, setEnabled() {} };
win.GridTileAccessors = { getActiveScene: () => scene, getCurrentArea: () => 'cloud' };
win.PlayerBodyTransformComposer = { getPlayerMesh: () => player.rootNode };
vm.runInContext(read('docs/js/cloud-forest-avatar-depth-occluder.js'), context, { filename: 'cloud-forest-avatar-depth-occluder.js' });
const occluder = win.CloudForestAvatarDepthOccluder;
occluder.install();
win.CloudForestFog.update(0.016); // The fog update drives sync().
assert.equal(fogUpdates, 1);
const helpersOf = node => node.children.filter(child => child.userData?.cloudForestAvatarDepthOccluder);
assert.equal(helpersOf(player.portrait).length, 1, 'player portrait gets a depth helper');
assert.equal(helpersOf(npc.portrait).length, 1, 'NPC portrait gets a depth helper');
assert.equal(helpersOf(enemy.portrait).length, 1, 'enemy portrait gets a helper record');
assert.equal(helpersOf(creatureFront).length, 1, 'creature front plane gets a helper');
assert.equal(helpersOf(creatureBack).length, 1, 'creature back plane gets a helper');
assert.equal(helpersOf(pet.avatarRef.frontPlane).length, 1, 'shoulder pet keeps its helper');
assert.equal(helpersOf(npc.portrait)[0].visible, true, 'drawn while the portrait skips depth writes');
assert.equal(helpersOf(enemy.portrait)[0].visible, false, 'not drawn when the portrait already writes depth');
assert.equal(helpersOf(npc.portrait)[0].material.alphaTest, 0.5, 'raised alpha floor keeps faint fringes from cutting mist');
const detail = occluder.snapshot().detail || occluder.snapshot().records || {};
assert.ok('player' in detail && 'shoulder_pet_front' in detail, 'player and pet keep their historical diagnostic keys');
npcPresent = false;
win.CloudForestFog.update(0.016);
assert.equal(helpersOf(npc.portrait).length, 0, 'a character that leaves releases its helper');
assert.equal(helpersOf(player.portrait).length, 1, 'others are kept');
scene.remove(mistGroup);
win.GridTileAccessors.getActiveScene = () => new Scene(); // Leaving the mist scene.
win.CloudForestFog.update(0.016);
assert.equal(helpersOf(player.portrait)[0].visible, false, 'helpers hide outside the mist');

// ── CharacterHeldTools: holder-scoped mastery and metal ────────────────────
const decorations = [];
win.HobunjiWeaponSpriteAssemblies = { decorate(group, itemKey, def, opts) { decorations.push({ itemKey, mastery: opts.masteryLevel(), metal: opts.metalOptions() }); } };
const recolors = [];
win.ToolMetalRecolor = { getRecoloredCanvas: async (sprite, opts) => { recolors.push(opts); return { recolored: opts.targetHex }; } };
win.document = { createElement: () => ({ width: 0, height: 0 }) };
vm.runInContext(read('docs/js/character-held-tools.js'), context, { filename: 'character-held-tools.js' });
const tools = win.CharacterHeldTools;
const DEFS = {
  hoe_copper: { sprite: 'hoe.png', metalKey: 'copper' },
  rope: { sprite: 'rope.png' },
};
const loaded = [];
tools.init({
  THREE, TOOL_ITEM_DEFS: DEFS,
  markPngPlane(group) { group.userData.markedPng = true; },
  playerMetalOptions: key => DEFS[key]?.metalKey ? { targetHex: '#PLATED', verdigrisHex: '#v', oxidationAmount: 0.8 } : null,
  playerMasteryLevel: () => 5,
  baseMetalOptions: key => DEFS[key]?.metalKey ? { targetHex: '#COPPER', verdigrisHex: '#v', oxidationAmount: 0 } : null,
  quantizeOxidation: value => Math.round((Number(value) || 0) * 10) / 10,
  onTextureLoaded: key => loaded.push(key),
});
const playerHoe = tools.makeToolPlaneMesh('hoe_copper');
assert.ok(playerHoe.userData.markedPng && playerHoe.userData.toolPlane, 'player tool plane is built and tagged');
assert.deepEqual(plain(decorations.at(-1)), { itemKey: 'hoe_copper', mastery: 5, metal: { targetHex: '#PLATED', verdigrisHex: '#v', oxidationAmount: 0.8 } }, "the player's tool uses the player's mastery and plating");
const playerTexture = playerHoe.userData.toolPlane.material.map;
assert.equal(playerTexture, tools.toolTextures.hoe_copper, 'player tools use the shared per-key texture');

const banditHoe = tools.makeToolPlaneMesh('hoe_copper', { holder: { kind: 'non-player' } });
assert.deepEqual(plain(decorations.at(-1)), { itemKey: 'hoe_copper', mastery: 0, metal: { targetHex: '#COPPER', verdigrisHex: '#v', oxidationAmount: 0 } }, "another holder never shows the player's mastery or plating");
assert.notEqual(banditHoe.userData.toolPlane.material.map, playerTexture, 'a non-player metal weapon gets its own texture variant');
const captainHoe = tools.makeToolPlaneMesh('hoe_copper', { holder: { weaponMasteryLevel: 3, weaponMetalOptions: () => ({ targetHex: '#GOLD', verdigrisHex: null, oxidationAmount: 0 }) } });
assert.deepEqual(plain(decorations.at(-1)), { itemKey: 'hoe_copper', mastery: 3, metal: { targetHex: '#GOLD', verdigrisHex: null, oxidationAmount: 0 } }, "a holder's own mastery and metal are used");
assert.notEqual(captainHoe.userData.toolPlane.material.map, banditHoe.userData.toolPlane.material.map, 'different metal, different variant');
const secondBandit = tools.makeToolPlaneMesh('hoe_copper', { holder: { kind: 'non-player' } });
assert.equal(secondBandit.userData.toolPlane.material.map, banditHoe.userData.toolPlane.material.map, 'identical appearances share one variant texture');
const rope = tools.makeToolPlaneMesh('rope', { holder: { kind: 'non-player' } });
assert.equal(rope.userData.toolPlane.material.map, tools.toolTextures.rope, 'non-metal items share the one texture for every holder');
assert.equal(tools.snapshot().holderVariantTextures, 2);

tools.refreshMetalToolWorldTexture('hoe_copper');
assert.equal(recolors.at(-1).targetHex, '#PLATED', "re-plating recolours only the player's copy");
assert.ok(tools.setToolMeshLoadedState(rope, 'rope', false), 'loaded-state helper accepts its own item');
assert.equal(tools.setToolMeshLoadedState(rope, 'hoe_copper', false), false, 'and rejects a different item');

// The pure factory used by tools/enemy-loadout-editor builds the same plane from injected textures.
const editorTextures = { rope: new Texture('editor-rope') };
const editorFactory = tools.createToolPlaneFactory({ THREE, defs: DEFS, ensureTexture: key => editorTextures[key], textures: editorTextures, renderOrder: 1.5, markPngPlane() {}, metalOptions: () => null, masteryLevel: () => 0 });
const editorRope = editorFactory('rope');
assert.equal(editorRope.userData.toolPlane.material.map, editorTextures.rope);
assert.equal(editorRope.userData.toolPlane.renderOrder, 1.5);

// ── Shoulder pets: one runtime instance per owner character ───────────────
{
  const petWin = {};
  vm.runInNewContext(read('docs/js/shoulder-pet-attachment-runtime.js'), { window: petWin }, { filename: 'shoulder-pet-attachment-runtime.js' });
  const runtimeTHREE = { Quaternion: class { setFromAxisAngle() { return this; } setFromEuler() { return this; } multiply() { return this; } }, Vector3: class { set() { return this; } }, Euler: class {}, MathUtils: { degToRad: d => d * Math.PI / 180 } };
  const npcOwner = new Group();
  const ownerGetters = { getRotationSource: () => 'head', getInvertRotationSource: () => false, getCancelRotationalOffset: () => false };
  assert.doesNotThrow(() => petWin.ShoulderPetAttachmentRuntime.create({ THREE: runtimeTHREE, getOwnerMesh: () => npcOwner, getOwnerNeckJoint: () => null, ...ownerGetters }),
    'any character can own a shoulder-pet runtime instance');
  assert.doesNotThrow(() => petWin.ShoulderPetAttachmentRuntime.create({ THREE: runtimeTHREE, getPlayerMesh: () => npcOwner, getPlayerNeckJoint: () => null, ...ownerGetters }),
    'legacy player-named getters still work');
  assert.throws(() => petWin.ShoulderPetAttachmentRuntime.create({ THREE: runtimeTHREE, ...ownerGetters }), /getOwnerMesh/);
}

Promise.resolve().then(() => console.log('PASS character visuals: enumeration, audit, mist occluder for every kind, holder-scoped held tools'));
