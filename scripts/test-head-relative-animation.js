'use strict';
const assert = require('node:assert/strict'); // Checks production head-anchor and pose sampling behavior.
const fs = require('node:fs'); // Loads the shared production module in an isolated browser realm.
const vm = require('node:vm'); // Keeps globals out of other regression tests.
const context = { window: {} }; // Minimal browser realm for the dependency-free pose module.
vm.runInNewContext(fs.readFileSync('docs/js/combat/shared-attack-pose.js', 'utf8'), context);
const api = context.window.SharedAttackPose; // Production pose API under test.
const point = { set(x,y,z) { this.x=x; this.y=y; this.z=z; return this; } }; // Caller-owned scratch: the helper must never replace it.
const root = { updateWorldMatrix() {}, worldToLocal(p) { p.x-=10; p.y-=20; p.z-=30; return p; } }; // Actor's translated root.
const neckJoint = { updateWorldMatrix() {}, localToWorld(p) { p.x+=10; p.y+=21; p.z+=30; return p; } }; // Visible neck after hierarchy/world transforms.
const avatar = { userData: { neckRig: { available:true, headCentroidLocal:{x:0.1,y:0.3,z:0}, neckLocal:{x:0,y:0.1,z:0}, neckJoint } } }; // Nonzero head centroid ensures the neck itself is not mistaken for the head.
assert.equal(api.headAnchor(point,avatar,root),true);
assert(Math.abs(point.x-0.1)<1e-9 && Math.abs(point.y-1.2)<1e-9 && point.z===0);
neckJoint.localToWorld = p => { const x=p.x; p.x=10-p.z; p.y+=21; p.z=30+x; return p; }; // A turned head must carry the centroid with it.
api.headAnchor(point,avatar,root);
assert(Math.abs(point.x)<1e-9 && Math.abs(point.z-0.1)<1e-9);
avatar.userData.neckRig.headScaleJoint = { updateWorldMatrix() {}, localToWorld(p) { p.x = 10 + p.x * 2; p.y = 21 + p.y * 1.5 - 0.1; p.z += 30; return p; } }; // Separate child-head scale and age/head offsets must move the anchor too.
api.headAnchor(point,avatar,root);
assert(Math.abs(point.x-0.2)<1e-9 && Math.abs(point.y-1.2)<1e-9);
context.window.PNGPlaneAvatar = { resolveSkinnedPixelWorldPosition(node, pixel, out) { assert.equal(node,avatar); assert.equal(pixel,avatar.userData.neckRig.headCentroidPx); return out.set(10.3,21.4,30.2); } }; // The canonical CPU shader-parity resolver owns mirrored/weighted head placement.
avatar.userData.neckRig.headCentroidPx = {x:20,y:10};
api.headAnchor(point,avatar,root);
assert(Math.abs(point.x-0.3)<1e-9 && Math.abs(point.y-1.4)<1e-9 && Math.abs(point.z-0.2)<1e-9);
assert.equal(api.headAnchor(point,null),false);
const fallback = { userData:{portraitModelHeight:2}, updateWorldMatrix(){}, localToWorld:p=>p }; // Missing sprite/rig falls back safely to the model's head region.
api.headAnchor(point,fallback);
assert.equal(point.y,0.6);
const sample = api.createSample(); // Reused result verifies reference-frame state never leaks into the next swing.
api.samplePose(sample,{neutral:{headRelative:true}},api.STYLE_NEUTRAL_POSE.ranged,0,0.2,0.4,0.6);
assert.equal(sample.headRelative,true);
api.samplePose(sample,{},api.STYLE_NEUTRAL_POSE.ranged,0,0.2,0.4,0.6);
assert.equal(sample.headRelative,false);
const game = fs.readFileSync('docs/game.js', 'utf8'); // Player ranged/drink poses live in the game closure, so their wiring is checked from source.
assert.equal((game.match(/placePlayerToolAtMouth\(/g) || []).length, 3, 'both ranged branches and the helper itself route head-anchored placement through the mouth frame');
assert.match(game, /SharedAttackPose\.placeAtMouth\(heldItemHolder, _headFrame/, 'the held drink bottle mates its opening with the mouth');
assert.doesNotMatch(game, /headAnchor\(_headPoseAnchor/, 'no head-centroid offset path may remain in the player poses');
assert.doesNotMatch(game, /_qRangedAimPitch\.invert\(\)/, 'camera pitch must not drive a head-anchored tool; the head does');

const composerSource = fs.readFileSync('docs/js/player-body-transform-composer.js', 'utf8'); // Head attachments must follow the drawn (aimed + clamped) head, not the gameplay-time neck.
assert.match(composerSource, /applyPlayerHeadAim\(undo, renderDebug\); applyPlayerNeckYawLimit\(renderDebug, camera\); for \(const hook of postHeadAimHooks\)/, 'composer runs post-head-aim hooks right after the head aim and neck limit');
assert.match(composerSource, /addPostHeadAimHook,/, 'composer exports the hook registration');
assert.match(game, /addPostHeadAimHook\?\.\(\(undo[^)]*\) =>[\s\S]*placeAtMouth\(toolHolder, _headFrame, _toolAttachJob\.pose[\s\S]*placeAtMouth\(heldItemHolder, _headFrame, _heldAttachJob\.pose[\s\S]*undo\.push\(_restoreHeadAttachments\)/, 'game re-seats the head-anchored tool and held bottle on the drawn head and restores gameplay transforms after the draw');
// Mouth/aperture attach math, with a small THREE-compatible vector/quaternion/euler stand-in.
let fakeNow = 1000; // Controllable clock for the deadzone's stale-gap reset.
const mathContext = { window: {}, Math, performance: { now: () => fakeNow } };
vm.createContext(mathContext);
class V3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} copy(v){return this.set(v.x,v.y,v.z);} add(v){return this.set(this.x+v.x,this.y+v.y,this.z+v.z);} sub(v){return this.set(this.x-v.x,this.y-v.y,this.z-v.z);} multiplyScalar(k){return this.set(this.x*k,this.y*k,this.z*k);} setScalar(k){return this.set(k,k,k);}
  applyQuaternion(q){const {x,y,z}=this,qx=q.x,qy=q.y,qz=q.z,qw=q.w;const ix=qw*x+qy*z-qz*y,iy=qw*y+qz*x-qx*z,iz=qw*z+qx*y-qy*x,iw=-qx*x-qy*y-qz*z;return this.set(ix*qw+iw*-qx+iy*-qz-iz*-qy,iy*qw+iw*-qy+iz*-qx-ix*-qz,iz*qw+iw*-qz+ix*-qy-iy*-qx);} }
class Q4 { constructor(x=0,y=0,z=0,w=1){this.x=x;this.y=y;this.z=z;this.w=w;} copy(q){this.x=q.x;this.y=q.y;this.z=q.z;this.w=q.w;return this;} invert(){this.x=-this.x;this.y=-this.y;this.z=-this.z;return this;}
  multiply(b){const a=this;const x=a.x*b.w+a.w*b.x+a.y*b.z-a.z*b.y,y=a.y*b.w+a.w*b.y+a.z*b.x-a.x*b.z,z=a.z*b.w+a.w*b.z+a.x*b.y-a.y*b.x,w=a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z;this.x=x;this.y=y;this.z=z;this.w=w;return this;}
  premultiply(b){const t=new Q4().copy(b).multiply(this);return this.copy(t);}
  angleTo(q){return 2*Math.acos(Math.min(1,Math.abs(this.x*q.x+this.y*q.y+this.z*q.z+this.w*q.w)));}
  slerp(q,t){let d=this.x*q.x+this.y*q.y+this.z*q.z+this.w*q.w;const s=d<0?-1:1;d=Math.abs(d);if(d>0.99999){return this;}const th=Math.acos(d),sn=Math.sin(th),a=Math.sin((1-t)*th)/sn,b=Math.sin(t*th)/sn*s;this.x=a*this.x+b*q.x;this.y=a*this.y+b*q.y;this.z=a*this.z+b*q.z;this.w=a*this.w+b*q.w;return this;}
  rotateTowards(q,step){const a=this.angleTo(q);if(a===0)return this;return this.slerp(q,Math.min(1,step/a));}
  set(x,y,z,w){this.x=x;this.y=y;this.z=z;this.w=w;return this;}
  setFromEuler(e){const c1=Math.cos(e.x/2),c2=Math.cos(e.y/2),c3=Math.cos(e.z/2),s1=Math.sin(e.x/2),s2=Math.sin(e.y/2),s3=Math.sin(e.z/2);this.x=s1*c2*c3+c1*s2*s3;this.y=c1*s2*c3-s1*c2*s3;this.z=c1*c2*s3-s1*s2*c3;this.w=c1*c2*c3+s1*s2*s3;return this;} }
class Eu { constructor(){this.x=0;this.y=0;this.z=0;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  setFromQuaternion(q){const {x,y,z,w}=q;const m13=2*(x*z+y*w),m23=2*(y*z-x*w),m33=1-2*(x*x+y*y),m21=2*(x*y+z*w),m22=1-2*(x*x+z*z);this.x=Math.asin(-Math.max(-1,Math.min(1,m23)));if(Math.abs(m23)<0.9999999){this.y=Math.atan2(m13,m33);this.z=Math.atan2(m21,m22);}else{this.y=Math.atan2(-(2*(x*z-y*w)),1-2*(y*y+z*z));this.z=0;}return this;} }
mathContext.window.SharedAttackPose = undefined;
vm.runInContext(fs.readFileSync('docs/js/combat/shared-attack-pose.js', 'utf8'), mathContext);
const attach = mathContext.window.SharedAttackPose;
const THREE = { Vector3: V3, Quaternion: Q4, Euler: Eu };
const frame = attach.createHeadFrame(THREE);
frame.position.set(1, 2, 3); frame.quaternion.copy(new Q4().setFromEuler({ x: 0.3, y: -0.8, z: 0.1 })); frame.scale = 1.25; // A turned, pitched, larger-than-baseline head.
const holder = { position: new V3(), quaternion: new Q4(), scale: new V3(1, 1, 1) };
const aperture = { x: -0.02, y: 0.01, z: 0.84 }; // Holder-space opening.
const posePose = { x: 0, y: 0, z: 0, pitch: 25, yaw: -40, roll: 10 };
attach.placeAtMouth(holder, frame, posePose, 1.3, aperture);
const apertureWorld = new V3(aperture.x, aperture.y, aperture.z).multiplyScalar(holder.scale.x).applyQuaternion(holder.quaternion).add(holder.position);
for (const [axis, expected] of [['x', 1], ['y', 2], ['z', 3]]) assert.ok(Math.abs(apertureWorld[axis] - expected) < 1e-9, `with a zero offset the aperture sits exactly on the mouth (${axis})`);
assert.ok(Math.abs(holder.scale.x - 1.3 * 1.25) < 1e-9, 'tool scale is the authored scale times the head scale');
const offsetPose = { x: 0.2, y: -0.1, z: 0.5, pitch: -170, yaw: 33, roll: 5 };
attach.placeAtMouth(holder, frame, offsetPose, 1.3, aperture);
const solved = attach.poseFromHolderWorld({}, frame, holder.position, holder.quaternion, holder.scale.x, aperture);
for (const key of ['x', 'y', 'z']) assert.ok(Math.abs(solved[key] - offsetPose[key]) < 1e-6, `editor drag inverse recovers ${key}: ${solved[key]} vs ${offsetPose[key]}`);
const replay = { position: new V3(), quaternion: new Q4(), scale: new V3(1, 1, 1) }; // Euler angles are ambiguous by a half turn, so the recovered pose must reproduce the same holder, not the same numbers.
attach.placeAtMouth(replay, frame, solved, 1.3, aperture);
for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(replay.position[axis] - holder.position[axis]) < 1e-6, `recovered pose reproduces the holder position (${axis})`);
assert.ok(Math.abs(Math.abs(replay.quaternion.x * holder.quaternion.x + replay.quaternion.y * holder.quaternion.y + replay.quaternion.z * holder.quaternion.z + replay.quaternion.w * holder.quaternion.w) - 1) < 1e-9, 'recovered pose reproduces the holder rotation');
// A parented holder (bodies carry their own rotation/scale) lands in the same world place.
const scaledRoot = { updateWorldMatrix() {}, worldToLocal(v) { return v.sub(new V3(5, 0, 0)).multiplyScalar(0.5); }, getWorldQuaternion(q) { return q.copy(new Q4()); }, getWorldScale(v) { return v.set(2, 2, 2); } };
const parented = { position: new V3(), quaternion: new Q4(), scale: new V3(1, 1, 1) };
attach.placeAtMouth(parented, frame, offsetPose, 1.3, aperture, scaledRoot);
assert.ok(Math.abs(parented.scale.x * 2 - holder.scale.x) < 1e-9, 'a scaled parent receives the compensating local scale');
// Edge-on deadzone: a flat tool sprite (normal = holder y, haft = holder z) is rolled about its OWN haft, by the least rotation, until the
// camera sees it at least 10 degrees away from edge-on. Nothing else moves, and a haft along the camera ray (unfixable) is left alone.
{
  const aligned = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }; // Haft = +z, sprite normal = +y at the head's rest rotation.
  const mouth = new V3(0, 1, 0);
  const frameFor = (cameraDirection, headEuler = { x: 0, y: 0, z: 0 }) => { // Camera placed so the ray through the mouth runs along `cameraDirection`.
    const f = attach.createHeadFrame(THREE); f.position.copy(mouth); f.quaternion.setFromEuler(headEuler);
    const length = Math.hypot(cameraDirection.x, cameraDirection.y, cameraDirection.z);
    f.cameraPosition = new V3(mouth.x - 5 * cameraDirection.x / length, mouth.y - 5 * cameraDirection.y / length, mouth.z - 5 * cameraDirection.z / length);
    return f;
  };
  const newHolder = () => ({ position: new V3(), quaternion: new Q4(), scale: new V3(1, 1, 1), userData: {} });
  const place = (holder, frame, pose = aligned, aperture = null) => { fakeNow += 16; attach.placeAtMouth(holder, frame, pose, 1, aperture); return new Q4().copy(holder.quaternion); };
  const normalDotRay = (holder, cameraDirection) => { const n = new V3(0, 1, 0).applyQuaternion(holder.quaternion), l = Math.hypot(cameraDirection.x, cameraDirection.y, cameraDirection.z); return (n.x * cameraDirection.x + n.y * cameraDirection.y + n.z * cameraDirection.z) / l; };
  const hasHaft = (holder, expected) => { const h = new V3(0, 0, 1).applyQuaternion(holder.quaternion); return Math.hypot(h.x - expected.x, h.y - expected.y, h.z - expected.z) < 1e-9; };
  const degBetween = (a, b) => a.angleTo(b) * 180 / Math.PI;
  const limit = Math.sin(10 * Math.PI / 180);
  assert.equal(attach.toolEdgeOnDeadzoneDeg(), 10, 'default edge-on deadzone is 10 degrees');
  { // Exactly edge-on from the side: needs a 10 degree roll to reach the 10 degree limit.
    const ray = { x: -1, y: 0, z: 0 }, holder = newHolder(), exact = (() => { attach.setToolEdgeOnDeadzone(0); const q = place(newHolder(), frameFor(ray)); attach.setToolEdgeOnDeadzone(10); return q; })();
    const q = place(holder, frameFor(ray));
    assert.ok(Math.abs(Math.abs(normalDotRay(holder, ray)) - limit) < 1e-9, 'the sprite is rolled to just outside the edge-on zone');
    assert.ok(hasHaft(holder, { x: 0, y: 0, z: 1 }), 'the haft direction is untouched');
    const relative = new Q4().copy(exact).invert().multiply(q);
    assert.ok(Math.abs(relative.x) < 1e-9 && Math.abs(relative.y) < 1e-9, 'the correction is a pure roll about the tool\'s own z');
    assert.ok(Math.abs(degBetween(exact, q) - 10) < 1e-6, 'it is the least roll that does the job: exactly the deadzone from a perfectly edge-on sprite');
    place(holder, frameFor(ray));
    assert.ok(degBetween(holder.quaternion, q) < 1e-6, 'repeat render passes are idempotent');
  }
  { // Already clearly facing the camera: untouched.
    const ray = { x: 0, y: -1, z: 0 }, holder = newHolder(); attach.setToolEdgeOnDeadzone(0); const exact = place(newHolder(), frameFor(ray)); attach.setToolEdgeOnDeadzone(10);
    assert.ok(degBetween(place(holder, frameFor(ray)), exact) < 1e-9, 'outside the zone nothing moves');
  }
  { // Partway into the zone: only just enough roll.
    const ray = { x: -Math.sqrt(1 - 0.01), y: 0.1, z: 0 }, holder = newHolder(); place(holder, frameFor(ray));
    assert.ok(Math.abs(normalDotRay(holder, ray) - limit) < 1e-9, 'a sprite 5.7 degrees off edge-on is rolled just out to 10');
  }
  { // Haft along the camera ray: no roll helps, so the tool is left alone (the stated exception).
    const ray = { x: 0, y: 0, z: -1 }, holder = newHolder(); attach.setToolEdgeOnDeadzone(0); const exact = place(newHolder(), frameFor(ray)); attach.setToolEdgeOnDeadzone(10);
    assert.ok(degBetween(place(holder, frameFor(ray)), exact) < 1e-12, 'haft parallel to the ray is left untouched');
  }
  { // Hysteresis: the sprite stays on the face it was showing instead of popping across edge-on.
    const holder = newHolder(), ray = a => ({ x: -Math.sqrt(1 - a * a), y: a, z: 0 });
    place(holder, frameFor(ray(0.4)));
    place(holder, frameFor(ray(0.05)));
    assert.ok(normalDotRay(holder, ray(0.05)) > 0, 'a face that was showing keeps showing as it enters the zone');
    place(holder, frameFor(ray(-0.05)));
    assert.ok(Math.abs(normalDotRay(holder, ray(-0.05)) - limit) < 1e-9, 'crossing edge-on still lands on the same face');
    attach.setToolEdgeOnDeadzone(0); const exactFar = place(newHolder(), frameFor(ray(-0.4))); attach.setToolEdgeOnDeadzone(10);
    assert.ok(degBetween(place(holder, frameFor(ray(-0.4))), exactFar) < 1e-9, 'once clearly past the zone on the other side it follows the head exactly');
  }
  { // The aperture stays on the mouth through the correction.
    const holder = newHolder(), ray = { x: -1, y: 0, z: 0 }, aperture = { x: 0, y: 0, z: 0.8 };
    place(holder, frameFor(ray), aligned, aperture);
    const world = new V3(aperture.x, aperture.y, aperture.z).multiplyScalar(holder.scale.x).applyQuaternion(holder.quaternion).add(holder.position);
    for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(world[axis] - mouth[axis]) < 1e-9, `aperture still on the mouth (${axis})`);
  }
  { // No camera, no deadzone: nothing to judge against.
    const holder = newHolder(), frame = frameFor({ x: -1, y: 0, z: 0 }); frame.cameraPosition = null;
    attach.setCameraProvider(null);
    attach.setToolEdgeOnDeadzone(0); const exact = place(newHolder(), frame); attach.setToolEdgeOnDeadzone(10);
    assert.ok(degBetween(place(holder, frame), exact) < 1e-9, 'without a camera the pose is exact');
  }
}
// Hand-aligned scaling pivots on the main-hand grip: the grip's position must not depend on the holder's scale.
{
  const grip = { x: 0.1, y: -0.05, z: 0.5 };
  const turned = new Q4().setFromEuler({ x: 0.4, y: 1.1, z: -0.3 });
  const gripWorld = h => new V3(grip.x, grip.y, grip.z).multiplyScalar(h.scale.x).applyQuaternion(h.quaternion).add(h.position);
  const atOne = { position: new V3(1, 2, 3), quaternion: new Q4().copy(turned), scale: new V3(1, 1, 1) };
  const scaled = { position: new V3(1, 2, 3), quaternion: new Q4().copy(turned), scale: new V3(1.77, 1.77, 1.77) };
  attach.anchorScaleAtPoint(scaled, grip, 1.77);
  for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(gripWorld(scaled)[axis] - gripWorld(atOne)[axis]) < 1e-9, `grip stays put when the weapon scales (${axis})`);
  const unchanged = { position: new V3(1, 2, 3), quaternion: new Q4().copy(turned), scale: new V3(1, 1, 1) };
  attach.anchorScaleAtPoint(unchanged, grip, 1);
  assert.deepEqual([unchanged.position.x, unchanged.position.y, unchanged.position.z], [1, 2, 3], 'scale 1 leaves the holder untouched');
}
assert.equal(attach.createHeadFrame !== undefined && typeof attach.mouthPixel, 'function', 'mouth pixel resolver is exported for tools');
mathContext.window.HobunjiPortraitMouthPoints = undefined;
assert.deepEqual({ ...attach.mouthPixel({ userData: { neckRig: { available: true, headCentroidPx: { x: 7, y: 9 } }, speciesId: 'mao-ao', gender: 'male' } }) }, { x: 7, y: 9 }, 'with no authored mouth the head centroid is used');
console.log('head-relative animation anchors and reused samples PASS');

// The committed mouth table: every point is a valid fraction pair, resolves through pixelFor at any render size, and a species
// with no entry (Nuhongan) falls back to its head centroid.
{
  const mouthContext = { window: { localStorage: undefined } };
  vm.createContext(mouthContext);
  vm.runInContext(fs.readFileSync('docs/config/portrait-mouth-points.js', 'utf8'), mouthContext);
  const mouths = mouthContext.window.HobunjiPortraitMouthPoints;
  const table = mouths.table();
  assert.ok(Object.keys(table).length >= 12, 'the authored table ships with the config');
  for (const [key, point] of Object.entries(table)) assert.ok(point.u > 0 && point.u < 1 && point.v > 0 && point.v < 1, `${key} is a fraction of the portrait`);
  const rig = { headCentroidPx: { x: 7, y: 9 } };
  assert.deepEqual({ ...mouths.pixelFor('mao-ao', 'male', rig, { width: 512, height: 512 }) }, { x: 0.6145 * 512, y: 0.4676 * 512 }, 'authored mouth scales with the source canvas');
  assert.deepEqual({ ...mouths.pixelFor('nuhongan', 'male', rig, { width: 512, height: 512 }) }, { x: 7, y: 9 }, 'species with no mouth keep the head centroid');
}
