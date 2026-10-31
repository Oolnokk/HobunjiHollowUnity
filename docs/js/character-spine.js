// Character spine: a static, data-driven hunchback for portrait avatars (old
// NPCs, skeletons, Maskbound). One 0-1 `hunch` value is the whole input; this
// module turns it into the numbers each rig layer needs, so every layer bends
// the same amount without any of them knowing about the others:
//
//   spine bone     a bone between the portrait's torso and neck bones
//                  (png-plane-avatar.js). Vertices from the waist up are
//                  weighted to it (`weightAt`), so the PNG itself stoops: the
//                  torso compresses and the shoulders, neck and head ride down.
//   shoulderDrop   how far that bone lowers the upper body (fraction of model
//                  height). Shoulder and neck anchors keep their 2D portrait
//                  coordinates, so they are carried through the same
//                  deformation (`deformDrop`) rather than offset by hand.
//   orbitDrop      the weapon/attack orbit centre moves precisely with the
//                  shoulders: it IS the shoulder drop
//                  (HobunjiSpeciesPoseScale.transformPosePoint `orbitDropY`).
//   neckDrop       extra head drop on top of the spine (the head bone), so
//                  spine + head equal HobunjiCharacterRigScale's age hunch and
//                  an NPC's authored aging.hunch keeps its head position.
//   stanceScale    multiplier on idle foot X (ProceduralLegAnimation), a wider
//                  base to carry the forward-heavy torso.
//   strideScale    multiplier on stride length (ProceduralLegAnimation).
//
// Nothing here animates: the hunch is fixed per character. Sources, in order:
//   * an explicit `spine` (number or { hunch }) on options/profile/appearance/
//     npcRecord — enemy-loadouts.json rules carry `spine: { hunch }`;
//   * otherwise the NPC database's appearance.aging.hunch (via
//     HobunjiCharacterRigScale.ageFor).
// All distances are fractions of the avatar's own unscaled model height, the
// same unit as headOffsetY, so they ride the whole-rig scale like it does.
(() => {
  'use strict';

  const FALLBACK_NECK_DROP = 0.25; // HobunjiCharacterRigScale.maxAgeHunchFraction when that module is absent (tools/tests).
  const SHOULDER_DROP_RATIO = 0.8; // The spine lowers the shoulders by this share of the total head drop; the head bone supplies the rest.
  const WAIST_BELOW_NECK = 0.42; // The spine bone's weight starts this far (fraction of model height) below the neck pivot...
  const FULL_BELOW_NECK = 0.21; // ...and is complete by here (halfway up the torso), so the bend is squeezed into the lower back and everything above, shoulders and neck included, rides the spine rigidly.
  const BEND_FRACTION = 0.2; // The spine joint, where the new bend sits, is this far up the waist-to-neck span: low in the back, so the torso bone is short and the spine bone long.
  const STANCE_WIDEN = 0.5; // Fully hunched: feet 50% farther from the centreline.
  const STRIDE_WIDEN = 0.3; // Fully hunched: strides 30% longer, a lurching reach rather than a shuffle.

  const clamp01 = value => Math.max(0, Math.min(1, value));
  const asNumber = value => (value == null || value === '' ? NaN : Number(value));

  function explicitSpine(source) {
    if (typeof source === 'number') return source;
    if (!source || typeof source !== 'object') return NaN;
    const candidates = [
      source.spine,
      source.profile?.spine,
      source.appearance?.spine,
      source.profile?.appearance?.spine,
      source.npcRecord?.spine,
      source.npcRecord?.appearance?.spine,
      source.avatarRoot?.userData?.hobunjiSpine,
    ];
    for (const candidate of candidates) {
      const n = asNumber(candidate && typeof candidate === 'object' ? candidate.hunch : candidate);
      if (Number.isFinite(n)) return n;
    }
    return NaN;
  }

  // 0-1 hunch for whatever the caller has (options bag, profile, roster, number).
  function hunchFor(source) {
    const explicit = explicitSpine(source);
    if (Number.isFinite(explicit)) return clamp01(explicit);
    const rigScale = window.HobunjiCharacterRigScale;
    if (source && typeof source === 'object' && typeof rigScale?.ageFor === 'function') return clamp01(rigScale.ageFor(source));
    return 0;
  }

  function neckDropMax() {
    const max = Number(window.HobunjiCharacterRigScale?.maxAgeHunchFraction);
    return Number.isFinite(max) && max > 0 ? max : FALLBACK_NECK_DROP;
  }

  // Every derived number for a hunch. Drops are positive fractions of model height.
  function profileFor(hunch) {
    const h = clamp01(Number(hunch) || 0);
    const totalDrop = h * neckDropMax(); // Where the head ends up: the NPC age-hunch amount.
    const shoulderDrop = totalDrop * SHOULDER_DROP_RATIO;
    return {
      hunch: h,
      neckDrop: totalDrop - shoulderDrop, // Extra head drop applied at the head bone, on top of the spine bone's.
      totalNeckDrop: totalDrop,
      shoulderDrop,
      orbitDrop: shoulderDrop, // The orbit moves precisely with the shoulders.
      stanceScale: 1 + h * STANCE_WIDEN,
      strideScale: 1 + h * STRIDE_WIDEN,
    };
  }

  const smoothstep01 = t => { const x = clamp01(t); return x * x * (3 - 2 * x); };

  // Bind-pose bone layout for a skinned portrait, in the local frames of the chain torso -> spine -> neck. The torso bone used to span the
  // whole waist-to-neck stretch as a zero-length bone at the plane origin; it now covers only the low back (up to the bend, BEND_FRACTION of
  // the span) and the spine bone starts at that bend and takes the freed length up to the neck pivot. The neck keeps its plane position.
  // Skin weights are defined in plane coordinates, so the pose is identical until a hunch moves the spine bone.
  function layoutFor(neckX, neckY, modelHeight) {
    const waistY = neckY - WAIST_BELOW_NECK * modelHeight, jointY = waistY + BEND_FRACTION * (neckY - waistY);
    return {
      torso: { x: neckX, y: waistY, z: 0 }, // Plane-local origin of the torso bone (the waist).
      spine: { x: 0, y: jointY - waistY, z: 0 }, // Relative to the torso: the bend, low in the span.
      neck: { x: 0, y: neckY - jointY, z: 0 }, // Relative to the spine: the rest of the span, ending exactly at the neck pivot.
    };
  }

  // The spine bone's skin weight at plane-local height y (0 below the waist, 1 from just under the shoulders up).
  // buildSkinnedPlaneGeometry weights vertices with it and every CPU skinning resolver reuses it, so they all agree.
  const weightAt = (y, neckY, modelHeight) => {
    const lo = neckY - WAIST_BELOW_NECK * modelHeight, hi = neckY - FULL_BELOW_NECK * modelHeight;
    return hi > lo ? smoothstep01((y - lo) / (hi - lo)) : 0;
  };

  // Total follow of a rest-pose point at plane-local height y: the spine bone's share plus whatever the head/neck bones
  // (which inherit the spine) carry on top, i.e. spine + turn - spine*turn, using the same broad head-turn falloff as the skin.
  function followAt(y, neckY, modelHeight, blendHeight) {
    const spineWeight = weightAt(y, neckY, modelHeight);
    const blend = Math.max(modelHeight * 0.012, Number(blendHeight) || modelHeight * 0.3);
    const turn = smoothstep01((y - (neckY - blend * 0.55)) / blend);
    return spineWeight + turn * (1 - spineWeight);
  }

  // Lowers the spine bone of a neck rig (or of each { front, back } pair) by the profile's shoulder drop, and remembers the
  // geometry numbers a later point-deformation needs on the profile. `modelHeight` is the unscaled plane height.
  function applyToRig(rig, profile, modelHeight) {
    const joints = rig?.spineJoint;
    if (!joints || !(modelHeight > 0)) return false;
    const drop = (profile?.shoulderDrop || 0) * modelHeight;
    for (const joint of [joints.position ? joints : joints.front, joints.back]) {
      if (!joint?.position) continue;
      joint.userData ||= {};
      if (!Number.isFinite(joint.userData.hobunjiSpineRestY)) joint.userData.hobunjiSpineRestY = joint.position.y; // The bind-pose offset from the torso bone (half the torso).
      joint.position.y = joint.userData.hobunjiSpineRestY - drop; // A translation down: the weight ramp between waist and shoulders turns it into a stoop.
      joint.updateMatrix?.();
    }
    if (profile) Object.assign(profile, { dropLocal: drop, neckY: Number(rig.neckLocal?.y) || 0, modelHeight, blendHeight: rig.blendHeight || null });
    return true;
  }

  // "Show bones" overlay for the portrait skin: the real bind-pose bones, torso (waist -> spine joint, green), spine (spine joint -> neck,
  // orange) and the neck joint (violet), drawn as children of the skinned plane so they sit in the bones' own frame and show the stoop as
  // it is. The leg solver owns the toggle (ProceduralLegAnimation.showBones): it calls sync(visible) every frame, so the guides appear
  // with the leg guides, upright or not.
  function makeBoneGuides(THREE, rig) {
    const plane = rig?.skinnedPlane;
    const spineBone = rig?.spineJoint?.position ? rig.spineJoint : rig?.spineJoint?.front;
    const torsoBone = rig?.torsoBone, neckBone = rig?.neckJoint;
    if (!plane?.isObject3D || !spineBone || !torsoBone?.position || !neckBone?.position) return null;
    plane.geometry?.computeBoundingBox?.();
    const box = plane.geometry?.boundingBox;
    const H = box ? box.max.y - box.min.y : 0.9;
    const group = new THREE.Group();
    group.name = 'spine_bone_guides';
    group.visible = false;
    group.frustumCulled = false;
    const materials = [], geometries = [];
    const guideMaterial = (color, opacity) => {
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
      materials.push(material);
      return material;
    };
    const torsoColor = 0x6fd17f, spineColor = 0xff9f1a, neckColor = 0xc77dff;
    const cylinderGeometry = new THREE.CylinderGeometry(0.012 * H / 0.9, 0.015 * H / 0.9, 1, 8);
    const jointGeometry = new THREE.SphereGeometry(0.021 * H / 0.9, 10, 8);
    geometries.push(cylinderGeometry, jointGeometry);
    const bone = color => { const mesh = new THREE.Mesh(cylinderGeometry, guideMaterial(color, 0.62)); mesh.renderOrder = 42; mesh.frustumCulled = false; group.add(mesh); return mesh; };
    const joint = color => { const mesh = new THREE.Mesh(jointGeometry, guideMaterial(color, 0.85)); mesh.renderOrder = 43; mesh.frustumCulled = false; group.add(mesh); return mesh; };
    const torsoGuide = bone(torsoColor), spineGuide = bone(spineColor);
    const waistJoint = joint(torsoColor), spineJoint = joint(spineColor), neckJoint = joint(neckColor);
    const waist = new THREE.Vector3(), mid = new THREE.Vector3(), neck = new THREE.Vector3();
    const span = (mesh, from, to) => {
      const dx = to.x - from.x, dy = to.y - from.y;
      mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, 0.01);
      mesh.scale.set(1, Math.max(1e-4, Math.hypot(dx, dy)), 1);
      mesh.rotation.set(0, 0, -Math.atan2(dx, dy));
    };
    plane.add(group);
    let visible = false;
    return {
      group,
      sync(show) {
        if (show !== visible) { visible = !!show; group.visible = visible; }
        if (!visible) return;
        waist.copy(torsoBone.position); // The torso bone is a child of the plane, which is the frame the guides live in.
        mid.copy(waist).add(spineBone.position); // Bone origins chain by their local offsets (the torso and spine carry no rotation or scale).
        neck.copy(mid).add(neckBone.position);
        waist.z = mid.z = neck.z = 0.01;
        waistJoint.position.copy(waist); spineJoint.position.copy(mid); neckJoint.position.copy(neck);
        span(torsoGuide, waist, mid);
        span(spineGuide, mid, neck);
      },
      dispose() {
        group.parent?.remove(group);
        for (const geometry of geometries) geometry.dispose?.();
        for (const material of materials) material.dispose?.();
      },
    };
  }

  // How far a rest-pose point at plane-local height y is carried down by the spine, in plane-local units (0 for an upright character).
  const deformDrop = (profile, y) => profile?.dropLocal > 0
    ? profile.dropLocal * followAt(y, profile.neckY, profile.modelHeight, profile.blendHeight)
    : 0;

  const resolve = source => profileFor(hunchFor(source));

  // Stores the profile on an avatar root for the layers that read it live (shoulder aim); null when upright.
  function bind(root, source) {
    const profile = resolve(source);
    if (!root?.userData) return profile;
    if (profile.hunch > 0) root.userData.hobunjiSpine = profile;
    else delete root.userData.hobunjiSpine;
    return profile;
  }

  function fromRoot(node) {
    for (let current = node; current; current = current.parent) {
      const spine = current.userData?.hobunjiSpine;
      if (spine) return spine;
    }
    return null;
  }

  // World-space Y the orbit centre sits below its unhunched height, for a body of the given unscaled model height and rig Y scale.
  const orbitDropWorld = (spine, modelHeight, rigScaleY = 1) =>
    spine?.orbitDrop > 0 ? spine.orbitDrop * (Number(modelHeight) || 0) * (Number(rigScaleY) > 0 ? Number(rigScaleY) : 1) : 0;

  window.HobunjiCharacterSpine = Object.freeze({
    shoulderDropRatio: SHOULDER_DROP_RATIO,
    weightAt,
    followAt,
    applyToRig,
    deformDrop,
    layoutFor,
    makeBoneGuides,
    stanceWiden: STANCE_WIDEN,
    strideWiden: STRIDE_WIDEN,
    hunchFor,
    profileFor,
    resolve,
    bind,
    fromRoot,
    orbitDropWorld,
  });
})();
