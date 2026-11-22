#!/usr/bin/env node
'use strict';
// Run: node scripts/test-adventuring-torch-belt.js
// Exercises the shipped belt presenter together with the real portable torch state machine.
const assert = require('node:assert/strict');
const fs = require('node:fs'); // Reads the game modules, not duplicated implementations.
const vm = require('node:vm');

class Vector3 {
  constructor(x=0,y=0,z=0) { this.set(x,y,z); }
  set(x,y,z) { Object.assign(this,{x,y,z}); return this; }
  copy(v) { return this.set(v.x,v.y,v.z); }
  clone() { return new Vector3(this.x,this.y,this.z); }
  applyMatrix4(matrix) {
    const e=matrix.elements,x=this.x,y=this.y,z=this.z;
    return this.set(e[0]*x+e[4]*y+e[8]*z+e[12],e[1]*x+e[5]*y+e[9]*z+e[13],e[2]*x+e[6]*y+e[10]*z+e[14]);
  }
}
class Matrix4 {
  constructor() { this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]; }
  copy(other) { this.elements=other.elements.slice(); return this; }
  setPose(p,r,s) {
    const cy=Math.cos(r.y),sy=Math.sin(r.y),cz=Math.cos(r.z),sz=Math.sin(r.z); // Rx is zero for this torch/posterior fixture.
    this.elements=[cy*cz*s.x,sz*s.x,-sy*cz*s.x,0,
      -cy*sz*s.y,cz*s.y,sy*sz*s.y,0,
      sy*s.z,0,cy*s.z,0,p.x,p.y,p.z,1];
    return this;
  }
  multiply(other) {
    const a=this.elements,b=other.elements,c=Array(16).fill(0); // Column-major general affine multiplication, including inherited shear.
    for(let col=0;col<4;col++)for(let row=0;row<4;row++)
      for(let k=0;k<4;k++)c[col*4+row]+=a[k*4+row]*b[col*4+k];
    this.elements=c;return this;
  }
  invert() {
    const e=this.elements;
    const a=e[0],b=e[4],c=e[8],d=e[1],f=e[5],g=e[9],h=e[2],i=e[6],j=e[10];
    const A=f*j-g*i,B=c*i-b*j,C=b*g-c*f;
    const D=g*h-d*j,E=a*j-c*h,F=c*d-a*g;
    const G=d*i-f*h,H=b*h-a*i,I=a*f-b*d;
    const det=a*A+b*D+c*G;
    assert(Math.abs(det)>1e-8,'fixture mounting matrix is invertible');
    const t=[e[12],e[13],e[14]];
    this.elements=[A/det,D/det,G/det,0,B/det,E/det,H/det,0,C/det,F/det,I/det,0,
      -(A*t[0]+B*t[1]+C*t[2])/det,-(D*t[0]+E*t[1]+F*t[2])/det,-(G*t[0]+H*t[1]+I*t[2])/det,1];
    return this;
  }
}
function equalMatrix(actual, expected, message) {
  for(let i=0;i<16;i++)assert(Math.abs(actual.elements[i]-expected.elements[i])<1e-8,message+' matrix index '+i);
}
class Group {
  constructor() {
    this.children=[];this.parent=null;this.visible=true;this.userData={};
    this.position=new Vector3();this.scale=new Vector3(1,1,1);
    this.rotation={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});}};
    this.matrix=new Matrix4();this.matrixWorld=new Matrix4();
    this.matrixAutoUpdate=true;this.matrixWorldNeedsUpdate=false;
  }
  add(node) {node.parent?.remove(node);this.children.push(node);node.parent=this;}
  attach(node) {this.add(node);return this;} // Legacy fallback; production is required to use the exact affine matrix instead.
  remove(node) {this.children=this.children.filter(child=>child!==node);node.parent=null;}
  updateMatrix() {if(this.matrixAutoUpdate)this.matrix.setPose(this.position,this.rotation,this.scale);}
  updateWorldMatrix(updateParents=false,updateChildren=false) {
    if(updateParents)this.parent?.updateWorldMatrix(true,false);
    this.updateMatrix();
    if(this.parent)this.matrixWorld.copy(this.parent.matrixWorld).multiply(this.matrix);
    else this.matrixWorld.copy(this.matrix);
    if(updateChildren)for(const child of this.children)child.updateWorldMatrix?.(false,true);
  }
  updateMatrixWorld() {this.updateWorldMatrix(true,true);}
  worldToLocal(v) {this.updateWorldMatrix(true,false);return v.applyMatrix4(new Matrix4().copy(this.matrixWorld).invert());}
}
class Material { constructor(options = {}) { Object.assign(this, options); } }
class Mesh extends Group { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
class Sprite extends Group { constructor(material) { super(); this.material = material; } }
const THREE = {
  Group, Vector3, Matrix4, Mesh, Sprite,
  MeshBasicMaterial: Material, SpriteMaterial: Material,
  PlaneGeometry: class { constructor(width, height) { this.width = width; this.height = height; } },
  CanvasTexture: class { constructor(canvas) { this.image = canvas; } },
  TextureLoader: class { load(path, done) { const map = {
    image:{width:450,height:1204}, path, dispose(){this.disposed=true;},
    clone(){ return { image:this.image, source:this, minFilter:this.minFilter, magFilter:this.magFilter, generateMipmaps:this.generateMipmaps, dispose(){this.disposed=true;} }; },
  }; loadedMap = map; done(map); return map; } },
  DoubleSide: 2, AdditiveBlending: 3, LinearFilter: 4, NearestFilter: 5,
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
let loadedMap = null; // Original uncolored PNG returned to the stow effects path, not the already-colored held material.
let fireStarts = 0, fireTicks = 0, fireDisposals = 0; // Instrument the exact shared layered-effects adapter used by game.
let heldMode = 'tool'; // Simulates tool draw/put-away while keeping the selected torch.
let player = new Group(); // Player roots may be replaced when an avatar respawns or loads.
player.userData = { speciesId:'mao-ao', gender:'male', portraitModelHeight:1 };
let avatar = new Group(); player.add(avatar); // Current PNG portrait used to sample live belt anchors.
player.scale.set(1.2,.75,1.4); // Nonuniform player-scale regression for the body-to-portrait reparent.
avatar.scale.set(.85,1.3,.9); // Additional anisotropic portrait rig scale makes Object3D.attach() potentially inaccurate.
avatar.rotation.y=.4; // A portrait facing different from its body must retain the posterior world pose while stowing.
const realTorchHeight = .5 * 1204 / 450; // The actual 450×1204 torch PNG's dimensions at game.js's 0.5-unit tool plane width.
const handMap = { image: { width:450, height:1204 } }; // Real torch PNG dimensions, reusing the colored held texture.
const sourcePlane = { geometry:{ parameters:{ width:.5, height:realTorchHeight } }, material:{ map:handMap } }; // The actual equipment-plane dimensions supplied by game.js.
const toolMeshMap = { adventuring: { userData: { toolPlane: sourcePlane } } };
const subscribers = new Map(); // Captures the real shared frame-scheduler registration.
const markerPoint = { x:300, y:1150, width:450, height:1204 }; // Deliberately off-center source-pixel emitter tests true pivot math in both axes.
const primaryGrip = { x:-.08, y:0, z:-.05 }; // Real Harlyao melee primary grip shared by the torch, not the old upper edge of its PNG.
const midpointPosition = (width, height, scale) => ({ // Actual author grip and fire-marker midpoint before the 180° art flip.
  x: (primaryGrip.x / .5 * width * scale + ((markerPoint.x + .5) / markerPoint.width - .5) * width * scale) / 2,
  y: (-primaryGrip.z / realTorchHeight * height * scale + (.5 - (markerPoint.y + .5) / markerPoint.height) * height * scale) / 2,
});
function assertEmitterMidpoint(art, width, height, scale) {
  const expected = midpointPosition(width, height, scale);
  assert(Math.abs(art.position.x - expected.x) < 1e-8 && Math.abs(art.position.y - expected.y) < 1e-8,
    'the sprite is offset by the actual emission-pixel midpoint');
  const gripX = art.position.x - primaryGrip.x / .5 * width * scale;
  const gripY = art.position.y + primaryGrip.z / realTorchHeight * height * scale; // Mirrored PNG grip is the authored item grip, not the image's top edge.
  const imageEmitterX = ((markerPoint.x + .5) / markerPoint.width - .5) * width * scale;
  const imageEmitterY = (.5 - (markerPoint.y + .5) / markerPoint.height) * height * scale;
  const flameX = art.position.x - imageEmitterX, flameY = art.position.y - imageEmitterY;
  assert(Math.abs(gripX + flameX) < 1e-8 && Math.abs(gripY + flameY) < 1e-8,
    'actual grip and emitted fire lie at opposite vectors from the posterior rotation pivot');
}
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
  HobunjiHandToolGrips: { authoredPrimaryGripForTool(item,context) {
    assert.equal(item, 'torch');assert.equal(context,'melee');
    return {position:primaryGrip}; // Canonical Harlyao handle authored through the game's grip editor.
  } },
  HobunjiLayeredWeaponEffects: {
    registerLayer(state, mesh, layer, image) {
      assert.equal(layer.material, 'marker', 'stowed cloth uses the held torch marker material');
      assert.equal(layer.markerReferenceValue, 179, 'stowed torch uses the authored wick shade reference');
      assert.equal(image, loadedMap.image, 'mask is scanned from the original torch PNG, never the lit held canvas');
      assert.notEqual(mesh.material.map, handMap, 'belt has its own texture clone instead of mutating the carried torch');
      state.materialLayers = [{mesh,config:layer,image}];
    },
    activateStatic(state, base, layers, meshes, image, unit) {
      assert.equal(base.vfx.litOnly, true, 'torch VFX retains ignition-only emission');
      assert.equal(base.vfx.worldRise, true, 'torch VFX still rises in world space');
      assert.equal(base.vfx.fixedMasteryRank, 5, 'torch VFX retains the same particle mastery rank');
      assert.equal(image, loadedMap.image);
      assert.equal(unit, .5 / 450);
      const group = new Group();
      state.plane.add(group);
      state.fireEmitters = [{ group, particles:[], image:{width:markerPoint.width,height:markerPoint.height}, sources:[markerPoint.y*markerPoint.width+markerPoint.x] }];
      fireStarts++;
    },
    stepFire(state, dt) {
      const first = !state.hasRenderedFire; // The initial stowed frame primes the portion of the 180ms ignition cloth transition that occurred in hand.
      state.hasRenderedFire = true;
      assert(dt >= 0 && dt <= (first ? .180001 : .05), 'only the first lit-stow frame may prime carried wick elapsed time');
      if (first) assert(Math.abs(dt - .18) < 1e-7, 'already-burning carried wick does not flash back to neutral when stowed');
      assert.equal(state.fireEmitters.length, 1);
      fireTicks++;
    },
    dispose(state) {
      for (const fx of state.fireEmitters || []) fx.group.parent?.remove(fx.group);
      state.fireEmitters = [];
      fireDisposals++;
    },
  },
};
const context = vm.createContext({ window:world, performance:{now:() => now}, document, Date });
vm.runInContext(fs.readFileSync('docs/config/weapon-sprite-assemblies.js', 'utf8'), context);
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
player.updateWorldMatrix(true,false);
const expectedPosteriorWorld = new Matrix4().copy(player.matrixWorld).multiply(
  new Matrix4().setPose(new Vector3(0,.5,-.04),{x:0,y:0,z:-Math.PI/4},new Vector3(1,1,1))); // Correct world pose before moving under an anisotropically scaled portrait.
sync({timestamp:now});
belt.updateWorldMatrix(true,true);
equalMatrix(belt.matrixWorld,expectedPosteriorWorld,'matrix-preserved reparent must not shift or distort the torch');
assert.equal(belt.matrixAutoUpdate,false,'production reparent retains the complete affine/shear rather than decomposing it');
assert.equal(belt.visible, true, 'the stowed torch appears on the actual player');
assert.equal(belt.parent, avatar, 'rear-stowed torch follows live portrait yaw rather than body yaw');
assert.equal(torch.debug.belt.attachedToPortrait, true, 'mobile debug reports portrait-follow attachment');
assert.notEqual(belt.children[0].material.map, handMap, 'belt owns its own separately recolored PNG map');
assert.equal(belt.children[0].material.map.source, loadedMap, 'belt recolors a clone of the original authored torch PNG');
assert.equal(loadedMap.minFilter, THREE.NearestFilter, 'source texture matches the held torch nearest-neighbor filter');
assert.equal(belt.children[0].material.map.magFilter, THREE.NearestFilter, 'the cloned recolored torch keeps pixel-sharp magnification');
assert.equal(belt.children[0].material.alphaTest, .08, 'stowed sprite uses the identical alpha cutoff as the carried torch');
assert.equal(belt.children.length, 1, 'no extra decorative flame; real particles are children of the PNG plane');
assert.equal(fireStarts, 1, 'one regular layer-effects fire is attached on stow');
assert.equal(torch.debug.belt.fireEmitters, 1, 'Pixel Probe reports the actual reused particle emitter');
assert.equal(world.AdventuringTorchBelt.debug.pivot, 'grip-emitter midpoint', 'mobile debug names the geometry pivot');
assert(Math.abs(torch.debug.belt.gripSourcePoint.x - (.5 + primaryGrip.x / .5)) < 1e-8,
  'stowed grip follows Harlyao-authored horizontal hand socket rather than the generic PNG edge');
assert(Math.abs(torch.debug.belt.gripSourcePoint.y - (.5 + primaryGrip.z / realTorchHeight)) < 1e-8,
  'stowed grip follows Harlyao-authored longitudinal hand socket');
assert.equal(belt.children[0].rotation.z, Math.PI, 'authored -Y torch tip is upright on the belt');
assert.equal(belt.children[0].scale.x, .68, 'belt torch reads the authored idle scale, not its raw size');
assert(Math.abs(belt.children[0].geometry.width * belt.children[0].scale.x - .5 * .68) < 1e-8, 'belt width matches the held tool width multiplied by Neutral scale');
assert(Math.abs(belt.children[0].geometry.height * belt.children[0].scale.y - realTorchHeight * .68) < 1e-8, 'belt height follows the real torch PNG aspect and Neutral scale');
assertEmitterMidpoint(belt.children[0], .5, realTorchHeight, .68);
assert.equal(torch.debug.belt.idleScale, .68, 'Pixel Probe exposes the actual belt multiplier');
assert(Math.abs(torch.debug.belt.visibleDimensions.height - realTorchHeight * .68) < 1e-8, 'mobile debug reports the full sized visible art');
assert.equal(torch.debug.onBelt, true, 'only a lit, stowed torch is reported on the belt');
world.WeaponToolStances.poses.torchHold.scale = .81; sync({timestamp:now});
assert.equal(belt.children[0].scale.x, .81, 'editing Neutral scale changes the stowed sprite without rebuilding it');
assertEmitterMidpoint(belt.children[0], .5, realTorchHeight, .81);
sourcePlane.geometry.parameters.width = .44; sourcePlane.geometry.parameters.height = .99; // Live species/tool geometry can update after the PNG has already loaded.
sync({timestamp:now});
assert(Math.abs(belt.children[0].geometry.width * belt.children[0].scale.x - .44 * .81) < 1e-8, 'live held plane width changes without mesh rebuild');
assert(Math.abs(belt.children[0].geometry.height * belt.children[0].scale.y - .99 * .81) < 1e-8, 'live held plane aspect changes without mesh rebuild');
assertEmitterMidpoint(belt.children[0], .44, .99, .81);
sourcePlane.geometry.parameters.width = .5; sourcePlane.geometry.parameters.height = realTorchHeight; // Restore the authored shape for the burn/respawn checks.
world.WeaponToolStances.poses.torchHold.scale = .68; sync({timestamp:now});
assert.equal(torch.debug.belt.fireVisible, true, 'real torch emitter remains active after stow');
assert.equal(world.AdventuringTorchBelt.debug.placement, 'anatomical posterior, behind portrait');
assert.equal(belt.position.x, 0, 'anatomical posterior uses the central anchor, not the hip');
assert.equal(belt.position.y, .5, 'posterior tracks the composer');
assert.equal(belt.position.z, -.04, 'stowed torch sits behind the portrait plane');
assert(Math.abs(belt.rotation.z + Math.PI / 4) < 1e-8, 'torch is angled 45 degrees about its midpoint');
assert.equal(torch.debug.belt.stowAngleDeg, -45, 'mobile debug retains body-space authored tilt');
const previousWorld = belt.matrixWorld.elements.slice(); // Portrait independent yaw changes the carried torch without altering the body anchor.
avatar.rotation.y += .25;
belt.updateWorldMatrix(true,true);
assert(belt.matrixWorld.elements.some((value,i)=>Math.abs(value-previousWorld[i])>1e-6),
  'stowed torch inherits independent portrait facing without fresh posterY or emission updates');
assert.equal(torch.debug.belt.posteriorPosition.y, .5, 'mobile debug reports the anatomical basis before reparenting');
const displayCount = player.children.length; // Repeated frames must not allocate or duplicate meshes.
for (let frame = 1; frame < 150; frame++) sync({timestamp:1000 + frame * 17});
assert.equal(player.children.length, displayCount, 'the belt artwork is cached, not respawned');
now = 30000;
sync({timestamp:now});
assert.equal(torch.isLit(), false, 'exact expiry operates even when stowed');
assert.equal(belt.visible, false, 'a burned-out torch and its belt sprite disappear together');
assert.equal(torch.debug.belt.fireVisible, false, 'burnout retires the real fire emitter');
assert.equal(fireDisposals, 1, 'burnout disposes pooled fire sprites and their states');
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
assert.equal(belt.parent, avatar, 'player rebuild attaches the cached torch to the new live portrait');
assert.equal(formerPlayer.children.includes(belt), false, 'old character scene no longer owns the belt mesh');
assert.equal(torch.debug.belt.fireVisible, true, 'respawn recreates the shared torch fire without resetting burn expiry');
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
assert.equal(world.AdventuringTorchBelt.debug.placement, 'authored beltStow override');
const oldAvatar = avatar; // A portrait can be replaced independently of the body while the torch remains stowed.
avatar = new Group(); player.add(avatar);
now = 32050;
sync({timestamp:now});
assert.equal(belt.parent, avatar, 'portrait-only rebuild reparents the torch immediately, not after the 100ms poll');
assert.equal(oldAvatar.children.includes(belt), false, 'the old portrait no longer owns an active torch');
assert.equal(torch.debug.belt.attachedToPlayer, true, 'attachment debug follows the current portrait beneath the body');
assert.equal(fireStarts, 2, 'a portrait-only replacement reuses the existing fire state without rebuilding emitters');
assert(fireTicks > 100, 'real shared fire updates throughout stowed rendering without spawning duplicate sources');

const manifest = fs.readFileSync('docs/js/bootstrap/classic-groups/render.js', 'utf8');
assert.match(manifest, /js\/adventuring-torch-belt\.js/, 'gameplay parser loads this presenter before game.js');
console.log('torch stow: independent recolored PNG, shared torch fire, posterior midpoint, 45 degrees, 30s expiry, draw/respawn and debug PASS');
