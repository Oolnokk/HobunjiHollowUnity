#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm'); // Executes the real attachment config so grip scaling is checked numerically, not only by regex.

const source = fs.readFileSync('docs/game.js', 'utf8'); // Guards the attached-pet look-around path embedded in the main game closure.
const rigSource = fs.readFileSync('docs/config/attachment-rig-profiles.js', 'utf8'); // Guards the instantaneous horizontal mirror bridge and refreshed shoulder anchors.
const probeSource = fs.readFileSync('docs/js/pixel-probe.js', 'utf8'); // Guards the mobile-visible size/curiosity diagnostic added for shoulder pets.

const storage = { getItem() { return null; }, setItem() {}, removeItem() {} }; // Minimal browser storage stub required by the attachment master bootstrap.
const portraitMirrorState = { active: false }; // Lets the fixture exercise mirrored rest parity without loading the portrait module.
const rigSandbox = {
  localStorage: storage,
  window: {
    localStorage: storage,
    HobunjiPortraitOutlineParity: { isShoulderPetPortraitMirrorActive: () => portraitMirrorState.active },
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
  multiply(other) { this.x *= other.x; this.y *= other.y; this.z *= other.z; return this; }
  divide(other) { this.x /= other.x; this.y /= other.y; this.z /= other.z; return this; }
  distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
  applyQuaternion(q) {
    const x = this.x, y = this.y, z = this.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return this;
  }
}
const inverseQuaternion = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w }); // Unit-quaternion inverse used by the fixture's plane.worldToLocal.
const root = {
  position: new Vec3(5, 7, 11),
  scale: new Vec3(2, 3, 4),
  userData: {},
  children: [],
  updateMatrixWorld() {},
  localToWorld(v) {
    return v.multiply(this.scale).add(this.position);
  },
  worldToLocal(v) {
    return v.sub(this.position).divide(this.scale);
  },
  traverse(callback) {
    callback(this);
    for (const child of this.children) callback(child);
  },
};
const halfYaw = Math.PI / 4; // 90° Y rotation makes the face-local X axis map onto the animal group's Z axis like the real side-view card.
const plane = {
  position: new Vec3(0.2, -0.1, 0.4),
  scale: new Vec3(1.5, 0.8, 1),
  quaternion: { x: 0, y: Math.sin(halfYaw), z: 0, w: Math.cos(halfYaw) },
  userData: { hobunjiPlaneFace: 'front' },
  parent: root,
  matrixAutoUpdate: true,
  updateMatrix() {},
  updateMatrixWorld() {},
  localToWorld(v) {
    v.multiply(this.scale).applyQuaternion(this.quaternion).add(this.position);
    return root.localToWorld(v);
  },
  worldToLocal(v) {
    root.worldToLocal(v);
    return v.sub(this.position).applyQuaternion(inverseQuaternion(this.quaternion)).divide(this.scale);
  },
};
root.children.push(plane);
const authoredGripLocal = new Vec3(0.6, 0.25, -0.2); // Deliberately off-center so center-origin mirroring would displace the visible grip.
const shoulderPerchWorld = plane.localToWorld(authoredGripLocal.clone());
const fakePet = {
  stableRole: 'shoulderPet',
  __hobunjiShoulderObservationFlipped: false,
  __hobunjiShoulderObservationTrackingActive: true,
  avatarRef: { group: root, frontPlane: plane },
};
rigSandbox.window.__climbDebug = { companionObjects: new Set([fakePet]) };

assert.equal(rigSandbox.window.ShoulderPetObservationFlip.applyAtPinnedPerch(fakePet, shoulderPerchWorld), true, 'final shoulder pin prepares the canonical grip pivot before the first observation flip');
assert.equal(plane.scale.x, 1.5, 'canonical shoulder placement remains unmirrored before observation parity changes');
assert(Math.abs(plane.position.x - 0.2) < 1e-12 && Math.abs(plane.position.z - 0.4) < 1e-12, 'canonical preparation does not move the plane');

fakePet.__hobunjiShoulderObservationFlipped = true;
assert.equal(rigSandbox.window.ShoulderPetObservationFlip.applyAtPinnedPerch(fakePet, shoulderPerchWorld), true, 'final shoulder pin applies the mirrored observation parity');
const mirroredPivotWorld = plane.localToWorld(authoredGripLocal.clone());
assert(plane.scale.x < 0, 'direct pivot solve mirrors the shoulder-pet plane');
assert(Math.abs(plane.position.z - 0.4) > 1e-12, '90° face rotation turns the required pivot translation onto parent Z, proving the solve uses the mesh rotation rather than a hard-coded axis');
assert(mirroredPivotWorld.distanceTo(shoulderPerchWorld) < 1e-12, 'direct local mirror math leaves the grip exactly on the shoulder-perch world point');

fakePet.__hobunjiShoulderObservationFlipped = false;
rigSandbox.window.ShoulderPetObservationFlip.applyAtPinnedPerch(fakePet, shoulderPerchWorld);
const restoredPivotWorld = plane.localToWorld(authoredGripLocal.clone());
assert(plane.scale.x > 0, 'unflipping restores positive canonical face scale');
assert(Math.abs(plane.position.x - 0.2) < 1e-12 && Math.abs(plane.position.z - 0.4) < 1e-12, 'unflipping restores canonical plane position without accumulated correction drift');
assert(restoredPivotWorld.distanceTo(shoulderPerchWorld) < 1e-12, 'unflipping keeps the same grip/perch pivot fixed');

portraitMirrorState.active = true;
fakePet.__hobunjiShoulderObservationFlipped = false;
rigSandbox.window.ShoulderPetObservationFlip.applyAtPinnedPerch(fakePet, shoulderPerchWorld);
assert(plane.scale.x < 0, 'portrait mirroring reverses the default/resting shoulder-pet facing around the authored grip');
assert(plane.localToWorld(authoredGripLocal.clone()).distanceTo(shoulderPerchWorld) < 1e-12, 'mirrored default orientation keeps the grip exactly pinned');

fakePet.__hobunjiShoulderObservationFlipped = true;
rigSandbox.window.ShoulderPetObservationFlip.applyAtPinnedPerch(fakePet, shoulderPerchWorld);
assert(plane.scale.x > 0, 'observation flip is relative to the mirrored resting orientation instead of applying the same absolute parity');
assert(plane.localToWorld(authoredGripLocal.clone()).distanceTo(shoulderPerchWorld) < 1e-12, 'relative observation flip keeps the mirrored grip/perch pivot fixed');
portraitMirrorState.active = false;

// Change parent scale to mimic live size/breath transforms, then solve a new flip
// from the canonical state before rendering. The direct equation must still hold.
root.scale.set(2.4, 2.7, 3.6);
const movedPerchWorld = plane.localToWorld(authoredGripLocal.clone());
fakePet.__hobunjiShoulderObservationFlipped = true;
rigSandbox.window.ShoulderPetObservationFlip.applyAtPinnedPerch(fakePet, movedPerchWorld);
assert(plane.localToWorld(authoredGripLocal.clone()).distanceTo(movedPerchWorld) < 1e-12, 'direct pivot math remains exact when the parent scale changes before the final shoulder pin');

fakePet.stableRole = 'companion';
rigSandbox.window.ShoulderPetObservationFlip.scanNow();
assert(plane.scale.x > 0, 'leaving shoulder-pet mode restores the canonical face scale');
assert(Math.abs(plane.position.x - 0.2) < 1e-12 && Math.abs(plane.position.z - 0.4) < 1e-12, 'role cleanup restores the canonical plane position');

assert.match(source,
  /function _tickShoulderPetCuriosity\(c, dt\)[\s\S]{0,1800}state\.phase = 'look'[\s\S]{0,700}targetLeanDeg/,
  'shoulder pets own a randomized look phase instead of turning every frame');
assert.match(source,
  /function _applyShoulderPetCuriosity\(c, dt\)[\s\S]{0,1800}frontPlane\.rotation\.z = state\.baseFrontRoll \+ leanRadians[\s\S]{0,320}backPlane\.rotation\.z = state\.baseBackRoll - leanRadians/,
  'curiosity leans within the visible pet planes without perspective foreshortening');
const applyCuriositySource = source.slice(source.indexOf('function _applyShoulderPetCuriosity'), source.indexOf('function _isPlayerGenuinelyIdle')); // Used below to forbid perspective-changing Y rotation in this one pose function.
assert.doesNotMatch(applyCuriositySource, /frontPlane\.rotation\.y|backPlane\.rotation\.y/,
  'curiosity never yaws a flat animal plane and therefore cannot imitate a size-class change');
assert.doesNotMatch(source, /SHOULDER_PET_REVERSE_SPEED_DEG|currentFacingYawDeg|targetFacingYawDeg|behaviorYawOffset/,
  'main keeps the rejected interpolated 180-degree shoulder-pet reverse/yaw experiment out');
assert.match(rigSource,
  /if \(phase === 'wait' && nextPhase === 'look'\)[\s\S]{0,500}pet\.__hobunjiShoulderObservationFlipped = flipped[\s\S]{0,900}phase = nextPhase/,
  'the curiosity transition changes only logical observation parity; it does not mutate the visual plane before the final shoulder pin');
assert.match(rigSource,
  /const localTranslation = plane\.position\.clone\(\)\.set\([\s\S]{0,300}\(state\.baseScaleX - nextScaleX\) \* pivotLocal\.x[\s\S]{0,350}localTranslation\.applyQuaternion\(plane\.quaternion\)[\s\S]{0,220}plane\.position\.add\(localTranslation\)/,
  'the mirror uses the closed-form t\'=t+R(S-S\')p pivot equation in the plane parent space');
assert.doesNotMatch(rigSource,
  /desiredParent\.sub\(currentParent\)|mirroredPivotWorld/,
  'the old flip-first/world-correction math is completely removed');
assert.match(rigSource,
  /const pivotLocal = plane\.worldToLocal\(desiredWorld\.clone\(\)\)[\s\S]{0,700}const nextScaleX = state\.baseScaleX \* sign/,
  'each final pin resolves the current grip into canonical local space before selecting mirror parity');
assert.match(rigSource,
  /applyAtPinnedPerch: applyShoulderPetObservationAtPinnedPerch/,
  'the direct pivot solver is exposed only as the final-pin integration surface');
assert.match(source,
  /function _applyShoulderPetFinalTransform\(c, finalTransform\)[\s\S]{0,5200}applyAtPinnedPerch\?\.\(c, finalTransform\.perchWorldPosition\)[\s\S]{0,400}observationPivotApplied/,
  'game.js applies observation parity inside the same final authoritative shoulder attachment solve before rendering');
const observationScanSource = rigSource.slice(rigSource.indexOf('const scanShoulderPetsForObservationFlip'), rigSource.indexOf('window.ShoulderPetObservationFlip ='));
assert.doesNotMatch(observationScanSource, /applyAtPinnedPerch/,
  'the 250ms instrumentation scan never performs active visual flips');
assert.match(rigSource,
  /mode: 'direct-local-grip-pivot'/,
  'final-pin diagnostics report the direct local grip-pivot solver');
assert.match(rigSource,
  /pivotMode: 'pending-final-shoulder-pin'/,
  'logical flip diagnostics remain pending until the final shoulder pin consumes the new parity');
assert.match(source,
  /_applyShoulderPetCuriosity\(c, dt\);[\s\S]{0,180}if \(perch && grip\)/,
  'the curiosity pose is applied inside the shoulder-pet branch before attachment pinning');
assert.match(source,
  /_updateCompanionHeadRotation\(c, _companionHeadRestDeg\(c\) \+ state\.currentPitchDeg, dt\)/,
  'shoulder-pet glances add a small pitch when the authored head rig is available');
assert.match(source,
  /const shoulderMirrorSign = window\.HobunjiPortraitOutlineParity\?\.isShoulderPetPortraitMirrorActive\?\.\(\) === true \? -1 : 1[\s\S]{0,1600}updateHeadYaw\(state\.currentYawDeg \* shoulderMirrorSign, dt\)/,
  'portrait mirroring reverses horizontal body lean/head-turn motion while leaving vertical curiosity pitch unchanged');
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
  /characterTransformAliases = Object\.freeze\(\{ rakakoan: 'kenkari'[\s\S]{0,60}\}\)[\s\S]{0,17000}characters\[aliasKey\] = characters\[sourceKey\]/,
  'Rakakoan still shares Kenkari transform objects instead of owning independent perch transforms');
assert.match(probeSource,
  /Size class:[\s\S]{0,260}expected group scale=[\s\S]{0,500}Curiosity: phase=/,
  'the mobile pixel probe distinguishes a real genotype-scale overwrite from a curiosity pose');

console.log('Shoulder-pet curiosity regression checks passed.');
