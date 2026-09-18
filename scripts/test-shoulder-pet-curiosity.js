#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm'); // Executes the real attachment config so grip scaling is checked numerically, not only by regex.

const source = fs.readFileSync('docs/game.js', 'utf8'); // Guards the attached-pet look-around path embedded in the main game closure.
const rigSource = fs.readFileSync('docs/config/attachment-rig-profiles.js', 'utf8'); // Guards the instantaneous horizontal mirror bridge and refreshed shoulder anchors.
const probeSource = fs.readFileSync('docs/js/pixel-probe.js', 'utf8'); // Guards the mobile-visible size/curiosity diagnostic added for shoulder pets.

const storage = { getItem() { return null; }, setItem() {}, removeItem() {} }; // Minimal browser storage stub required by the attachment master bootstrap.
const rigSandbox = {
  localStorage: storage,
  window: {
    localStorage: storage,
    SCRATCHBONES_CONFIG: {
      game: {
        appearanceEditor: { species: {} },
        assets: {
          pngPlaneAvatar: {
            behindView: { headUrls: {} },
            portraitScaleBySpecies: {},
            portraitVerticalPlacement: {},
            proceduralFeet: { footScale: { default: 1 } },
          },
        },
      },
    },
  },
};
vm.runInNewContext(rigSource, rigSandbox, { filename: 'attachment-rig-profiles.js' });

class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  copy(other) { return this.set(other.x, other.y, other.z); }
  add(other) { this.x += other.x; this.y += other.y; this.z += other.z; return this; }
  sub(other) { this.x -= other.x; this.y -= other.y; this.z -= other.z; return this; }
  distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
}
const root = {
  position: new Vec3(5, 7, 11),
  scale: new Vec3(2, 3, 4),
  userData: {},
  children: [],
  updateMatrixWorld() {},
  localToWorld(v) {
    return v.set(
      this.position.x + this.scale.x * v.x,
      this.position.y + this.scale.y * v.y,
      this.position.z + this.scale.z * v.z,
    );
  },
  worldToLocal(v) {
    return v.set(
      (v.x - this.position.x) / this.scale.x,
      (v.y - this.position.y) / this.scale.y,
      (v.z - this.position.z) / this.scale.z,
    );
  },
  traverse(callback) {
    callback(this);
    for (const child of this.children) callback(child);
  },
};
const plane = {
  position: new Vec3(0.2, -0.1, 0.4),
  scale: new Vec3(1.5, 0.8, 1),
  userData: { hobunjiPlaneFace: 'front' },
  parent: root,
  matrixAutoUpdate: true,
  updateMatrix() {},
  updateMatrixWorld() {},
  localToWorld(v) {
    v.set(
      this.position.x + this.scale.x * v.x,
      this.position.y + this.scale.y * v.y,
      this.position.z + this.scale.z * v.z,
    );
    return root.localToWorld(v);
  },
  worldToLocal(v) {
    root.worldToLocal(v);
    return v.set(
      (v.x - this.position.x) / this.scale.x,
      (v.y - this.position.y) / this.scale.y,
      (v.z - this.position.z) / this.scale.z,
    );
  },
};
root.children.push(plane);
const authoredGripLocal = new Vec3(0.6, 0.25, -0.2); // Deliberately off-center so a center-origin mirror would visibly displace it.
const shoulderPerchWorld = plane.localToWorld(authoredGripLocal.clone());
root.userData.hobunjiShoulderPetAttachment = {
  authoredPerchWorldPosition: [shoulderPerchWorld.x, shoulderPerchWorld.y, shoulderPerchWorld.z],
  alignedGripWorldPosition: [shoulderPerchWorld.x, shoulderPerchWorld.y, shoulderPerchWorld.z],
  authoritativeRootTransform: true,
};
const fakePet = {
  stableRole: 'shoulderPet',
  __hobunjiShoulderObservationFlipped: true,
  avatarRef: { group: root, frontPlane: plane },
};
rigSandbox.window.__climbDebug = { companionObjects: new Set([fakePet]) };
rigSandbox.window.ShoulderPetObservationFlip.scanNow();
const mirroredPivotWorld = plane.localToWorld(authoredGripLocal.clone());
assert(plane.scale.x < 0, 'observation scan must actually mirror the shoulder-pet plane');
assert.notEqual(plane.position.x, 0.2, 'off-center grip must translate the plane instead of mirroring around its geometric center');
assert(mirroredPivotWorld.distanceTo(shoulderPerchWorld) < 1e-12, 'mirroring must leave the authored grip exactly on the shoulder-perch world point');
fakePet.__hobunjiShoulderObservationFlipped = false;
rigSandbox.window.ShoulderPetObservationFlip.scanNow();
const restoredPivotWorld = plane.localToWorld(authoredGripLocal.clone());
assert(plane.scale.x > 0, 'restoring observation parity must restore the positive plane scale');
assert(Math.abs(plane.position.x - 0.2) < 1e-12, 'restoring observation parity must restore the canonical plane position without drift');
assert(restoredPivotWorld.distanceTo(shoulderPerchWorld) < 1e-12, 'unflipping must keep the same grip/perch pivot fixed');

assert.match(source,
  /function _tickShoulderPetCuriosity\(c, dt\)[\s\S]{0,1800}state\.phase = 'look'[\s\S]{0,700}targetLeanDeg/,
  'shoulder pets own a randomized look phase instead of turning every frame');
assert.match(source,
  /function _applyShoulderPetCuriosity\(c, dt\)[\s\S]{0,1200}frontPlane\.rotation\.z = state\.baseFrontRoll \+ leanRadians[\s\S]{0,260}backPlane\.rotation\.z = state\.baseBackRoll - leanRadians/,
  'curiosity leans within the visible pet planes without perspective foreshortening');
const applyCuriositySource = source.slice(source.indexOf('function _applyShoulderPetCuriosity'), source.indexOf('function _isPlayerGenuinelyIdle')); // Used below to forbid perspective-changing Y rotation in this one pose function.
assert.doesNotMatch(applyCuriositySource, /frontPlane\.rotation\.y|backPlane\.rotation\.y/,
  'curiosity never yaws a flat animal plane and therefore cannot imitate a size-class change');
assert.doesNotMatch(source, /SHOULDER_PET_REVERSE_SPEED_DEG|currentFacingYawDeg|targetFacingYawDeg|behaviorYawOffset/,
  'main keeps the rejected interpolated 180-degree shoulder-pet reverse/yaw experiment out');
assert.match(rigSource,
  /if \(phase === 'wait' && nextPhase === 'look'\)[\s\S]{0,520}applyShoulderPetObservationMirror\(pet, flipped\)[\s\S]{0,900}phase = nextPhase/,
  'each observation toggles the horizontal mirror synchronously before the look phase begins');
assert.match(rigSource,
  /const mirrorShoulderObservationPlaneAroundWorldPivot = [\s\S]{0,4000}const sign = flipped \? -1 : 1;[\s\S]{0,500}plane\.scale\.x = baseScaleX \* sign/,
  'the observation change is still an instantaneous X-scale mirror rather than a rotation or lerp');
assert.match(rigSource,
  /const desiredWorld = plane\.position\.clone\(\)\.set\(worldPivot\.x, worldPivot\.y, worldPivot\.z\);[\s\S]{0,900}plane\.position\.add\(desiredParent\.sub\(currentParent\)\)/,
  'the mirrored face is translated after the scale sign change so the solved grip/perch world point, not the plane center, remains the flip origin');
assert.match(rigSource,
  /hobunjiShoulderPetAttachment[\s\S]{0,500}authoredPerchWorldPosition[\s\S]{0,500}alignedGripWorldPosition/,
  'shoulder-pet observation flips consume game.js\'s authoritative shoulderPerch/alignedGrip world solve instead of reconstructing raw rig coordinates');
assert.match(rigSource,
  /shoulderObservationMeshes[\s\S]{0,1000}hobunjiPlaneFace[\s\S]{0,500}hobunjiShoulderSplitOverlay/,
  'the grip-pivot mirror applies to live rigged face meshes and split-frame overlays rather than stale center-pivot cards');
assert.match(rigSource,
  /avatar\.syncMirroredPlaneScale = function[\s\S]{0,450}applyMirror\(\)/,
  'later canonical plane-scale refreshes reapply the current grip-pivot mirror parity');
assert.match(rigSource,
  /pivotMode:[\s\S]{0,220}pivotError:[\s\S]{0,2800}gripError=/,
  'the mobile-readable shoulder-pet flip diagnostic reports the pivot mode and residual grip error');
assert.match(rigSource,
  /pet\.stableRole !== 'shoulderPet'[\s\S]{0,220}applyShoulderPetObservationMirror\(pet, false\)/,
  'leaving shoulder-pet mode restores ordinary unmirrored animal rendering');
assert.match(source,
  /_applyShoulderPetCuriosity\(c, dt\);[\s\S]{0,180}if \(perch && grip\)/,
  'the curiosity pose is applied inside the shoulder-pet branch before attachment pinning');
assert.match(source,
  /_updateCompanionHeadRotation\(c, _companionHeadRestDeg\(c\) \+ state\.currentPitchDeg, dt\)/,
  'shoulder-pet glances add a small pitch when the authored head rig is available');
assert.match(source,
  /const SHOULDER_PET_CURIOUS_HEAD_TURN_MIN_DEG = 14/,
  'shoulder-pet glances give the head its own visible turn instead of only rotating the body planes');
assert.match(source,
  /const SHOULDER_PET_CURIOUS_BODY_LEAN_MAX_DEG = 7/,
  'the whole-body curiosity lean stays subtle and scale-stable');
assert.match(source,
  /state\.targetYawDeg = side \* \(SHOULDER_PET_CURIOUS_HEAD_TURN_MIN_DEG/,
  'curiosity applies the separate head turn in the same direction as its body glance');
assert.match(source,
  /const SHOULDER_PET_CURIOUS_WAIT_MIN_S = 3\.4/,
  'shoulder-pet glances have a cooldown so the 250ms instrumentation scan always installs before the first observation');
assert.match(rigSource,
  /\['drenkirra'[\s\S]{0,180}\[0\.01,-0\.11914729549653388,-0\.001096892109713506\]/,
  'Drenkirra uses the supplied shoulderGrip');
assert.match(rigSource,
  /\['uumkaoii'[\s\S]{0,180}\[0\.01,-0\.3636087789187775,-0\.18395679109723\]/,
  'Uumkaoii uses the supplied shoulderGrip');
assert.match(rigSource,
  /\['kenkari::female'[\s\S]{0,100}\[-0\.12331214301269552,0\.2212216457140902,0\]/,
  'Kenkari female uses the supplied shoulderPerch');
assert.match(rigSource,
  /characterTransformAliases = Object\.freeze\(\{ rakakoan: 'kenkari'[\s\S]{0,60}\}\)[\s\S]{0,15000}characters\[aliasKey\] = characters\[sourceKey\]/,
  'Rakakoan still shares Kenkari transform objects instead of owning independent perch transforms');
assert.match(probeSource,
  /Size class:[\s\S]{0,260}expected group scale=[\s\S]{0,500}Curiosity: phase=/,
  'the mobile pixel probe distinguishes a real genotype-scale overwrite from a curiosity pose');

console.log('Shoulder-pet curiosity regression checks passed.');
