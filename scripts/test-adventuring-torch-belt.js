#!/usr/bin/env node
'use strict';
// Run: node scripts/test-adventuring-torch-belt.js
// Exercises the shipped belt presenter together with the real portable torch state machine.
const assert = require('node:assert/strict');
const fs = require('node:fs'); // Reads the game modules, not duplicated implementations.
const vm = require('node:vm');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Group {
  constructor() {
    this.children = []; this.parent = null; this.visible = true; this.userData = {};
    this.position = new Vector3(); this.scale = new Vector3(1, 1, 1);
    this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  }
  add(node) { node.parent?.remove(node); this.children.push(node); node.parent = this; }
  remove(node) { this.children = this.children.filter(child => child !== node); node.parent = null; }
  worldToLocal(position) { return position; }
  updateWorldMatrix() {}
}
class Material { constructor(options = {}) { Object.assign(this, options); } }
class Mesh extends Group { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
class Sprite extends Group { constructor(material) { super(); this.material = material; } }
const THREE = {
  Group, Vector3, Mesh, Sprite,
  MeshBasicMaterial: Material, SpriteMaterial: Material,
  PlaneGeometry: class { constructor(width, height) { this.width = width; this.height = height; } },
  CanvasTexture: class { constructor(canvas) { this.image = canvas; } },
  TextureLoader: class { load(path, done) { const map = { image: { width: 20, height: 60 }, path }; done(map); return map; } },
  DoubleSide: 2, AdditiveBlending: 3, LinearFilter: 4,
}; // Minimal geometric API: the test cares about attachment ownership, not rasterization.
const document = {
  createElement() {
    return { width: 0, height: 0, getContext() {
      return {
        createLinearGradient() { return { addColorStop() {} }; },
        beginPath() {}, moveTo() {}, bezierCurveTo() {}, fill() {}, set fillStyle(value) { this._fillStyle = value; },
      };
    } };
  },
}; // Allows the real tiny flame to be created without requiring WebGL.

let now = 0; // Virtual monotonic time for the shared 30-second burning deadline.
let heldMode = 'tool'; // Simulates tool draw/put-away while keeping the selected torch.
let player = new Group(); // Player roots may be replaced when an avatar respawns or loads.
player.userData = { speciesId:'mao-ao', gender:'male', portraitModelHeight:1 };
let avatar = new Group(); player.add(avatar); // Current PNG portrait used to sample live belt anchors.
const handMap = { image: { width:20, height:60 } }; // Exact authored/colored held sprite texture.
const toolMeshMap = { adventuring: { userData: { toolPlane: { material: { map:handMap } } } } };
const subscribers = new Map(); // Captures the real shared frame-scheduler registration.
const world = {
  THREE,
  RuntimeFrameScheduler: { register(id, callback, options) {
    assert.equal(options.phase, 'pre-render'); subscribers.set(id, callback);
  } },
  ProceduralHandAttachments: { gameDeps: { playerMesh:player, toolMeshMap } },
  PlayerBodyTransformComposer: { getPlayerMesh: () => player, getPosteriorY: () => .5 },
  WorldPortraitLife: { getPlayerAvatar: () => ({ group:avatar }) },
  PantsRigRuntime: {
    characterRecord: () => ({ portraitBeltSpline:[{}, {}, {}, {}, {}] }),
    resolveLiveBeltWorldPoints: () => [
      new Vector3(-.19,.47,0), new Vector3(-.1,.49,0),
      new Vector3(0,.5,0), new Vector3(.12,.48,0), new Vector3(.21,.47,0),
    ],
  },
  CharacterMetaSave: { update() {} },
  WeaponToolStances: { poses:{ torchHold:{ scale:.68 } } }, // Simulates the same idle stance consumed by the game and editor.
};
const context = vm.createContext({ window:world, performance:{now:() => now}, document, Date });
vm.runInContext(fs.readFileSync('docs/js/belt-stow-rig.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/adventuring-tools.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/adventuring-torch-belt.js', 'utf8'), context);
const torch = world.AdventuringTools;
torch.init({
  getActiveTool: () => 'adventuring', getHeldMode: () => heldMode,
  getEquippedTool: () => 'torch', getUnlocked: () => [],
  refreshActionBar() {}, toolMeshMap,
});
const sync = subscribers.get('adventuring-torch-belt');
assert.equal(typeof sync, 'function', 'presenter registers on the existing scheduler, not its own RAF');
sync({timestamp:now});
const unlitBelt = player.children.find(node => node.name === 'adventuring_torch_belt'); // Hidden cached art before a flame is lit.
assert.equal(unlitBelt.visible, false, 'unlit torch is not placed visibly on the belt');
heldMode = 'none'; torch.stow(); sync({timestamp:now});
assert.equal(unlitBelt.visible, false, 'stowing an unlit torch does not display belt art');
assert.equal(torch.debug.onBelt, false, 'mobile debug reports no unlit belt torch');
heldMode = 'tool';
assert.equal(torch.light(), true);
sync({timestamp:now});
const belt = player.children.find(node => node.name === 'adventuring_torch_belt');
assert(belt, 'there is a belt-attached torch');
assert.equal(belt.visible, false, 'held torch never has a duplicate on the belt');
assert.equal(torch.debug.belt.visible, false, 'mobile status reports hidden belt copy');
torch.stow();
heldMode = 'none';
now = 1000;
sync({timestamp:now});
assert.equal(belt.visible, true, 'the stowed torch appears on the actual player');
assert.equal(belt.children[0].material.map, handMap, 'belt shares the already-colored held PNG');
assert.equal(belt.children[0].rotation.z, Math.PI, 'authored -Y torch tip is upright on the belt');
assert.equal(belt.children[0].scale.x, .68, 'belt torch reads the authored idle scale, not its raw size');
assert(Math.abs(belt.children[0].position.y - (-.38 / 2 * .32)) < 1e-8, 'idle scaling keeps the grip end anchored');
assert.equal(torch.debug.belt.idleScale, .68, 'Pixel Probe exposes the actual belt multiplier');
assert.equal(torch.debug.onBelt, true, 'only a lit, stowed torch is reported on the belt');
world.WeaponToolStances.poses.torchHold.scale = .81; sync({timestamp:now});
assert.equal(belt.children[0].scale.x, .81, 'editing Neutral scale changes the stowed sprite without rebuilding it');
assert(Math.abs(belt.children[1].position.y - (belt.children[0].position.y + .24 * .81)) < 1e-8, 'flame follows the resized tip');
world.WeaponToolStances.poses.torchHold.scale = .68; sync({timestamp:now});
assert.equal(belt.children[1].visible, true, 'belt flame continues burning after stow');
assert.equal(world.AdventuringTorchBelt.debug.placement, 'animated pants-belt spline');
assert(belt.position.x > .21, 'belt attaches to the rightmost live waist anchor');
const displayCount = player.children.length; // Repeated frames must not allocate or duplicate meshes.
for (let frame = 1; frame < 150; frame++) sync({timestamp:1000 + frame * 17});
assert.equal(player.children.length, displayCount, 'the belt artwork is cached, not respawned');
now = 30000;
sync({timestamp:now});
assert.equal(torch.isLit(), false, 'exact expiry operates even when stowed');
assert.equal(belt.visible, false, 'a burned-out torch and its belt sprite disappear together');
assert.equal(belt.children[1].visible, false, 'the stowed flame visibly goes out');
assert.equal(torch.debug.onBelt, false, 'mobile debug reports the hidden expired torch');
heldMode = 'tool';
sync({timestamp:now});
assert.equal(belt.visible, false, 'drawing hides belt geometry even when the torch is unlit');
assert.equal(torch.light(), true, 'the same torch can be lit again after being drawn');
now = 31000;
torch.stow(); heldMode = 'none';
const formerPlayer = player; // Test reparent rather than leaking to a detached old avatar.
player = new Group(); player.userData = { speciesId:'mao-ao', gender:'male', portraitModelHeight:1.2 };
avatar = new Group(); player.add(avatar);
sync({timestamp:now});
assert.equal(belt.parent, player, 'player rebuild moves the single cached belt root');
assert.equal(formerPlayer.children.includes(belt), false, 'old character scene no longer owns the belt mesh');
assert.equal(belt.children[1].visible, true, 'respawn/reparent does not reset an unexpired flame');
assert.equal(torch.debug.belt.attachedToPlayer, true, 'status reports actual new player attachment');
world.HOBUNJI_ATTACHMENT_RIG_PROFILES = { characters:{
  'mao-ao::male': { anchors:{ beltStow:{
    position:{x:-.31,y:.44,z:.15}, rotationDeg:{x:0,y:0,z:24}, scale:{x:1.5,y:1.5,z:1.5},
  } } },
} }; // The saved Rig Coordinates species profile must override the generic pants-spline placement.
now = 32000;
sync({timestamp:now});
assert.equal(Number(belt.position.x.toFixed(2)), -.31, 'authored left/right hip placement wins');
assert.equal(Number(belt.position.y.toFixed(2)), .44);
assert.equal(Number(belt.scale.x.toFixed(2)), 1.5, 'authored item scale affects the actual belt mesh');
assert(Math.abs(belt.rotation.z - (24 * Math.PI / 180)) < 1e-6, 'authored 3D rotation is used in gameplay');
assert.equal(world.AdventuringTorchBelt.debug.placement, 'authored species/gender belt-stow rig');

const manifest = fs.readFileSync('docs/js/bootstrap/classic-groups/render.js', 'utf8');
assert.match(manifest, /js\/adventuring-torch-belt\.js/, 'gameplay parser loads this presenter before game.js');
console.log('torch belt: real state, colored PNG, visible flame, 30s expiry, draw, avatar-rebuild and mobile debug PASS');
