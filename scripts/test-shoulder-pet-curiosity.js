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

assert.equal(rigSandbox.window.ShoulderPetObservationFlip.applyAtPinnedPerch(fakePet, shoulderPerchWorld), true, 'final shoulder pin restores the canonical unmirrored shoulder cards');
assert.equal(plane.scale.x, 1.5, 'canonical shoulder placement keeps positive X scale');
plane.scale.x = -1.5; // Simulates a stale mirrored shoulder card left behind by an older hot-reloaded build.
assert.equal(rigSandbox.window.ShoulderPetObservationFlip.applyAtPinnedPerch(fakePet, shoulderPerchWorld, true), true, 'legacy extra arguments cannot request a new sprite mirror');
assert.equal(plane.scale.x, 1.5, 'canonical restore removes stale X mirroring instead of applying it');
assert(Math.abs(plane.position.x - 0.2) < 1e-12 && Math.abs(plane.position.z - 0.4) < 1e-12, 'canonical restore returns the original plane position without pivot-translation tricks');

const applyCuriositySource = source.slice(source.indexOf('function _applyShoulderPetCuriosity'), source.indexOf('function _isPlayerGenuinelyIdle')); // Used below to forbid perspective-changing Y rotation in this one pose function.
assert.doesNotMatch(applyCuriositySource, /frontPlane\.rotation\.y|backPlane\.rotation\.y/,
  'curiosity never yaws a flat animal plane and therefore cannot imitate a size-class change');
assert.doesNotMatch(source, /SHOULDER_PET_REVERSE_SPEED_DEG|currentFacingYawDeg|targetFacingYawDeg|behaviorYawOffset/,
  'main keeps the rejected interpolated 180-degree shoulder-pet reverse/yaw experiment out');
assert.match(source,
  /const shoulderFacingTurnDeg = facingTowardPlayerCenter \? 180 : 0;[\s\S]{0,420}worldQuaternion\.multiply\(SHOULDER_PET_HALF_TURN_QUATERNION\)/,
  'shoulder curiosity swaps between the two local facing transforms with one exact 180-degree Y turn');
assert.doesNotMatch(source, /authoredRotationOffset\.invert\(\)|desiredVisualFacingSign|observationMirrored/,
  'shoulder facing never uses quaternion inversion or sprite-mirror parity');
assert.match(probeSource, /Shoulder local facing transform: facing=/,
  'Pixel Probe exposes the 0/180-degree local facing transform');
assert.match(source,
  /const shoulderPetBypassesPlaneDeadzone = c\.stableRole === 'shoulderPet';[\s\S]{0,900}c\.pngRot = c\.groupRot;/,
  'shoulder pets bypass the generic center-pivot creature PNG deadzone before the authored perch/grip solve');
assert.match(probeSource, /Shoulder plane deadzone:/,
  'Pixel Probe reports whether the shoulder-pet deadzone bypass is active');
assert.match(source, /const SHOULDER_PET_POSE_HOLD_MIN_S = 1\.5;[\s\S]{0,120}const SHOULDER_PET_POSE_HOLD_MAX_S = 3\.0;/,
  'both local facing poses use the same short sustained hold range');
assert.match(source, /const SHOULDER_PET_INWARD_CHANCE = 0\.5;/,
  'shoulder pose selection is an unbiased 50/50 roll');
assert.doesNotMatch(source, /SHOULDER_PET_IDLE_INWARD_CHANCE|SHOULDER_PET_MOVING_INWARD_CHANCE|SHOULDER_PET_MOVING_SPEED_SQ/,
  'shoulder pose selection has no idle/moving bias machinery');
assert.match(source,
  /if \(state\.timer <= 0\) \{[\s\S]{0,180}const facingInward = rnd\(\) < SHOULDER_PET_INWARD_CHANCE;[\s\S]{0,520}state\.timer = SHOULDER_PET_POSE_HOLD_MIN_S/,
  'a single 50/50 pose roll occurs only when the sustained hold expires');
const sustainedTickSource = source.slice(source.indexOf('function _tickShoulderPetCuriosity'), source.indexOf('function _applyShoulderPetCuriosity'));
assert.doesNotMatch(sustainedTickSource, /phase === 'wait'|phase === 'look'|phase === 'settle'|SHOULDER_PET_CURIOUS_LOOK_|SHOULDER_PET_CURIOUS_WAIT_/,
  'the old momentary wait/look/settle cycle is completely removed');
assert.match(source,
  /c\.__hobunjiShoulderFacingInward = facingInward;[\s\S]{0,900}ShoulderPetObservationFlip\?\.recordPose\?\./,
  'gameplay owns the persistent facing state directly and only records debug data at pose-roll boundaries');
assert.doesNotMatch(rigSource, /Object\.defineProperty\(state, 'phase'|scanShoulderPetsForObservationFlip|setInterval\(scanShoulderPetsForObservationFlip/,
  'shoulder facing has no property hook and no 250ms polling scan');
assert.match(rigSource, /recordPose: recordShoulderPetPose/,
  'the debug helper is event-driven by infrequent sustained-pose selections');
assert.doesNotMatch(rigSource, /solveShoulderObservationPlaneAtPivot|nextScaleX|localTranslation\.applyQuaternion/,
  'the shoulder runtime contains no sprite-mirroring or pivot-translation solver');
assert.match(rigSource,
  /const restoredCount = meshes\.reduce\([\s\S]{0,260}restoreShoulderObservationPlane\(plane\)/,
  'the compatibility hook only restores canonical unmirrored plane transforms');
assert.match(rigSource, /mode: 'canonical-no-sprite-mirror'/,
  'debug state explicitly reports that shoulder sprites are never mirrored');
assert.match(source,
  /hobunjiShoulderSpriteCanonicalized === true[\s\S]{0,420}applyAtPinnedPerch\?\.\(c, finalTransform\.perchWorldPosition\)[\s\S]{0,300}hobunjiShoulderSpriteCanonicalized = true/,
  'canonical sprite restoration is a one-time avatar cleanup rather than a per-frame hierarchy traversal');
assert.match(source,
  /_applyShoulderPetCuriosity\(c, master, dt\);[\s\S]{0,180}if \(perch && grip\)/,
  'the sustained pose update remains inside the shoulder-pet branch before attachment pinning');
assert.match(source,
  /_updateCompanionHeadRotation\(c, _companionHeadRestDeg\(c\) \+ state\.currentPitchDeg, dt\)/,
  'sustained holds preserve the subtle authored head variation');
assert.match(source,
  /const SHOULDER_PET_CURIOUS_HEAD_TURN_MIN_DEG = 14/,
  'shoulder poses retain their independent head turn rather than rotating the body planes');
assert.match(source,
  /const SHOULDER_PET_CURIOUS_BODY_LEAN_MAX_DEG = 7/,
  'the whole-body lean stays subtle and scale-stable');
assert.match(source, /const SHOULDER_PET_AWAY_HEAD_YAW_SIGN = 1;/,
  'shoulder head yaw uses one fixed pet-local-left sign in both body poses');
assert.match(source,
  /state\.targetYawDeg = SHOULDER_PET_AWAY_HEAD_YAW_SIGN \* \(SHOULDER_PET_CURIOUS_HEAD_TURN_MIN_DEG/,
  'each sustained hold turns the head only in the fixed away-from-character direction');
assert.doesNotMatch(source,
  /state\.targetYawDeg = (?:side|leanSide) \*/,
  'body-lean randomness can never choose the shoulder pet head-yaw direction');
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
  /Size class:[\s\S]{0,260}expected group scale=[\s\S]{0,650}Shoulder pose:[\s\S]{0,180}inwardChance=/,
  'the mobile pixel probe reports sustained pose, hold time, and unbiased inward chance alongside genotype scale');

console.log('Shoulder-pet curiosity regression checks passed.');
