// Character spine: a static, data-driven hunchback for portrait avatars (old
// NPCs, skeletons, Maskbound). One 0-1 `hunch` value (plus an optional lateral
// `sway`) is the whole input; this module turns it into a curve every rig layer
// reads, so they all bend the same amount without knowing about each other:
//
//   spline         7 nodes (SPLINE_NODES) from the character's posterior (node 0,
//                  pinned to the local root: x = 0, z = 0) to the neck (node 6),
//                  and nothing else: no torso bone, no spine bone. The portrait
//                  skin (png-plane-avatar.js) is weighted to the nodes by height,
//                  so the PNG follows the curve. A hunch curls the spline with an
//                  ease-out profile (the curvature sits low in the back) and
//                  preserves each segment's length, so the nodes sweep down AND
//                  forward (+z, `DEPTH_SCALE`d for the flat cards), and sideways
//                  with a sway, naturally off the local root's x = 0, z = 0.
//   shoulders,     the shoulder anchors and the attack-orbit centre keep their 2D
//   orbit          portrait coordinates and ride the same curve (`deformAt`):
//                  the orbit centre moves precisely with the shoulders.
//   neckDrop       extra head drop on top of the spline (the head bone), so the
//                  spline's vertical drop + head = HobunjiCharacterRigScale's age
//                  hunch and an NPC's authored aging.hunch keeps its head position.
//   stanceScale    multiplier on idle foot X (ProceduralLegAnimation), a wider
//                  base to carry the forward-heavy torso.
//   strideScale    multiplier on stride length (ProceduralLegAnimation).
//
// Nothing here animates: the hunch is fixed per character. Sources, in order:
//   * an explicit `spine` (number or { hunch, sway }) on options/profile/
//     appearance/npcRecord — enemy-loadouts.json rules carry `spine`;
//   * otherwise the NPC database's appearance.aging.hunch (via
//     HobunjiCharacterRigScale.ageFor).
// All distances are in the avatar's own unscaled plane units (the unit of
// headOffsetY's model height), so they ride the whole-rig scale like it does.
(() => {
  'use strict';

  const FALLBACK_NECK_DROP = 0.25; // HobunjiCharacterRigScale.maxAgeHunchFraction when that module is absent (tools/tests).
  const SHOULDER_DROP_RATIO = 0.8; // The spline's vertical drop at the neck node is this share of the total head drop; the head bone supplies the rest.
  const WAIST_BELOW_NECK = 0.42; // Fallback only: with no authored posterior the spline starts this far (fraction of model height) below the neck pivot.
  const SPLINE_NODES = 7; // Posterior (0) ... neck (6).
  const SEGMENTS = SPLINE_NODES - 1;
  const MAX_PITCH = 85 * Math.PI / 180; // The curl never exceeds this at the neck node.
  const DEPTH_SCALE = 0.5; // The portrait is a flat card: how much of the curve's forward (+z) travel the skin, anchors and orbit really make.
  const ORBIT_BELOW_NECK = 0.08; // The attack orbit centre is the shoulder line: this far (fraction of model height) below the neck pivot.
  const STANCE_WIDEN = 0.5; // Fully hunched: feet 50% farther from the centreline.
  const STRIDE_WIDEN = 0.3; // Fully hunched: strides 30% longer, a lurching reach rather than a shuffle.

  const clamp01 = value => Math.max(0, Math.min(1, value));
  const asNumber = value => (value == null || value === '' ? NaN : Number(value));
  const smoothstep01 = t => { const x = clamp01(t); return x * x * (3 - 2 * x); };

  function explicitSpine(source) {
    if (typeof source === 'number') return { hunch: source, sway: NaN };
    if (!source || typeof source !== 'object') return { hunch: NaN, sway: NaN };
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
      const object = candidate && typeof candidate === 'object';
      const hunch = asNumber(object ? candidate.hunch : candidate);
      if (Number.isFinite(hunch)) return { hunch, sway: object ? asNumber(candidate.sway) : NaN };
    }
    return { hunch: NaN, sway: NaN };
  }

  // 0-1 hunch for whatever the caller has (options bag, profile, roster, number).
  function hunchFor(source) {
    const explicit = explicitSpine(source).hunch;
    if (Number.isFinite(explicit)) return clamp01(explicit);
    const rigScale = window.HobunjiCharacterRigScale;
    if (source && typeof source === 'object' && typeof rigScale?.ageFor === 'function') return clamp01(rigScale.ageFor(source));
    return 0;
  }

  // -1..1 lateral sway (+x), 0 unless a spine explicitly authors one.
  function swayFor(source) {
    const sway = explicitSpine(source).sway;
    return Number.isFinite(sway) ? Math.max(-1, Math.min(1, sway)) : 0;
  }

  function neckDropMax() {
    const max = Number(window.HobunjiCharacterRigScale?.maxAgeHunchFraction);
    return Number.isFinite(max) && max > 0 ? max : FALLBACK_NECK_DROP;
  }

  // Every derived number for a hunch. Drops are positive fractions of model height.
  function profileFor(hunch, sway = 0) {
    const h = clamp01(Number(hunch) || 0);
    const totalDrop = h * neckDropMax(); // Where the head ends up: the NPC age-hunch amount.
    const shoulderDrop = totalDrop * SHOULDER_DROP_RATIO; // The vertical drop of the spline's neck node.
    return {
      hunch: h,
      sway: Math.max(-1, Math.min(1, Number(sway) || 0)),
      neckDrop: totalDrop - shoulderDrop, // Extra head drop applied at the head bone, on top of the spline's.
      totalNeckDrop: totalDrop,
      shoulderDrop,
      stanceScale: 1 + h * STANCE_WIDEN,
      strideScale: 1 + h * STRIDE_WIDEN,
    };
  }

  // The character's posterior (hip) anchor in the skinned plane's own frame, resolved exactly as the procedural legs resolve their hip: the
  // shared attachment-rig resolver (authored percent-of-height-from-floor, else the hand-anchor fallback), looked up by the exact species key.
  // That is a floor-relative height; the plane sits modelHeight/2 above the floor, shifted by the portrait's vertical placement
  // (png-plane-avatar.js: floorY = modelHeight/2 + assemblyY + planeY). Null when the resolver is unavailable.
  function posteriorLocalY({ speciesId, gender, modelHeight, placementRatio = 0.5, handAttachY }) {
    const key = id => String(id || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const g = String(gender || '').toLowerCase() === 'female' ? 'female' : 'male';
    const rule = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[`${key(speciesId)}::${g}`]?.posteriorRule || null;
    const floorY = window.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(rule, modelHeight, handAttachY);
    if (!Number.isFinite(floorY) || !(modelHeight > 0)) return null;
    return floorY - modelHeight / 2 - (Number(placementRatio) - 0.5) * modelHeight;
  }

  // Where the spline starts (the posterior); falls back to a fixed stretch below the neck when the posterior is unknown or implausible.
  const waistFor = (neckY, modelHeight, posteriorY) =>
    Number.isFinite(posteriorY) && posteriorY < neckY - 0.1 * modelHeight ? posteriorY : neckY - WAIST_BELOW_NECK * modelHeight;

  // Rest-pose layout of the spline: SPLINE_NODES points evenly spaced from the posterior (pinned to the local root, x = 0, z = 0) to the neck
  // pivot. `nodes` are plane-local; `offsets[k]` is node k relative to node k - 1, which is how the node bones chain (the first offset entry
  // is unused). The head-turn bone sits on the last node, at offset 0.
  function layoutFor(neckX, neckY, modelHeight, posteriorY) {
    const waistY = waistFor(neckY, modelHeight, posteriorY);
    const nodes = [], offsets = [];
    for (let k = 0; k < SPLINE_NODES; k++) {
      const t = k / SEGMENTS;
      nodes.push({ x: neckX * t, y: waistY + (neckY - waistY) * t, z: 0 });
      offsets.push(k === 0 ? { x: 0, y: 0, z: 0 } : { x: nodes[k].x - nodes[k - 1].x, y: nodes[k].y - nodes[k - 1].y, z: 0 });
    }
    return { nodes, offsets, neck: { x: 0, y: 0, z: 0 } };
  }

  // Skin weights of a rest-pose point at plane-local height y: the two neighbouring spline nodes (a, a + 1) and the share of the upper one
  // (smoothstepped, so the displacement is C1 along the curve rather than kinked at each node). Everything below the posterior rides node 0
  // and everything above the neck rides the last node. Writes into `out` to stay allocation-free for per-vertex and per-frame callers.
  function nodeWeightsAt(y, neckY, modelHeight, posteriorY, out = {}) {
    const lo = waistFor(neckY, modelHeight, posteriorY);
    const s = clamp01((y - lo) / (neckY - lo)) * SEGMENTS;
    const a = Math.min(SEGMENTS - 1, Math.floor(s));
    out.a = a; out.b = a + 1; out.wb = smoothstep01(s - a);
    return out;
  }

  // Curls the rest spline by the profile and returns each node's displacement from its rest position (plane-local, node 0 pinned at {0,0,0}).
  // The cumulative pitch eases out along the spline (concave, so the curvature sits low in the back), segment lengths are preserved, and the
  // total curl is solved so the neck node drops by exactly profile.shoulderDrop * modelHeight (capped at MAX_PITCH). The pitch swings the
  // upper body down and forward (+z); sway rolls it sideways (+x). Forward travel is scaled by DEPTH_SCALE for the flat portrait cards.
  function solveCurve(profile, layout, modelHeight) {
    const rest = layout.nodes, lengths = [];
    for (let k = 1; k < SPLINE_NODES; k++) lengths.push(Math.hypot(rest[k].x - rest[k - 1].x, rest[k].y - rest[k - 1].y));
    const total = lengths.reduce((sum, length) => sum + length, 0) || 1;
    const rx = (rest[SEGMENTS].x - rest[0].x) / total, ry = (rest[SEGMENTS].y - rest[0].y) / total;
    const sway = Number(profile.sway) || 0;
    const target = (profile.shoulderDrop || 0) * modelHeight;
    const build = (pitch, displacement) => {
      let x = rest[0].x, y = rest[0].y, z = 0;
      for (let k = 1; k < SPLINE_NODES; k++) {
        const t = (k - 0.5) / SEGMENTS;
        const phi = pitch * (1 - (1 - t) * (1 - t)); // Cumulative pitch at the segment's middle: ease-out.
        const psi = -sway * phi; // Roll about the facing axis: the same shape, sideways (a positive sway leans toward +x).
        const dx = rx, dy = ry * Math.cos(phi), dz = ry * Math.sin(phi);
        x += lengths[k - 1] * (dx * Math.cos(psi) - dy * Math.sin(psi));
        y += lengths[k - 1] * (dx * Math.sin(psi) + dy * Math.cos(psi));
        z += lengths[k - 1] * dz;
        if (displacement) displacement[k] = { x: x - rest[k].x, y: y - rest[k].y, z: z * DEPTH_SCALE };
      }
      return rest[SEGMENTS].y - y; // Vertical drop of the neck node.
    };
    let pitch = 0;
    if (target > 0) {
      if (build(MAX_PITCH) <= target) pitch = MAX_PITCH; // More than the curl can give: capped.
      else {
        let low = 0, high = MAX_PITCH;
        for (let i = 0; i < 40; i++) { const mid = (low + high) / 2; if (build(mid) < target) low = mid; else high = mid; }
        pitch = (low + high) / 2;
      }
    }
    const displacement = Array.from({ length: SPLINE_NODES }, () => ({ x: 0, y: 0, z: 0 }));
    if (pitch > 0) build(pitch, displacement); // An upright character is exactly the rest pose, not rest plus float noise.
    return displacement;
  }

  // Applies the profile to a neck rig's spline nodes (or each { front, back } pair, the rear skin being the same card turned around, so its
  // x and z run the other way), and records the curve on the profile for the point deformation below. `modelHeight` is the unscaled plane
  // height. Each node bone remembers its rest offset (userData.hobunjiSplineRest) so reapplying never accumulates.
  function applyToRig(rig, profile, modelHeight) {
    const nodes = rig?.splineNodes;
    if (!nodes || !profile || !(modelHeight > 0)) return false;
    const neckX = Number(rig.neckLocal?.x) || 0, neckY = Number(rig.neckLocal?.y) || 0;
    const posteriorY = Number.isFinite(rig.spinePosteriorY) ? rig.spinePosteriorY : null;
    const layout = layoutFor(neckX, neckY, modelHeight, posteriorY);
    const curve = solveCurve(profile, layout, modelHeight);
    const skins = Array.isArray(nodes) ? [[nodes, 1]] : [[nodes.front, 1], [nodes.back, -1]];
    for (const [bones, sign] of skins) {
      if (!bones) continue;
      for (let k = 1; k < SPLINE_NODES; k++) {
        const bone = bones[k];
        if (!bone?.position) continue;
        bone.userData ||= {};
        const rest = bone.userData.hobunjiSplineRest ||= { x: bone.position.x, y: bone.position.y, z: bone.position.z };
        const step = { x: curve[k].x - curve[k - 1].x, y: curve[k].y - curve[k - 1].y, z: curve[k].z - curve[k - 1].z };
        bone.position.set(rest.x + sign * step.x, rest.y + step.y, rest.z + sign * step.z);
        bone.updateMatrix?.();
      }
    }
    Object.assign(profile, { curve, neckX, neckY, posteriorY, modelHeight, blendHeight: rig.blendHeight || null });
    profile.orbitOffset = deformAt(profile, neckY - ORBIT_BELOW_NECK * modelHeight, {});
    return true;
  }

  // How far a rest-pose point at plane-local height y is carried by the curve: { x, y, z } in plane-local units (all 0 for an upright
  // character). Skin blend: the two neighbouring nodes for the body share, the last node for the head share (the head bones sit on it), using
  // the same broad head-turn falloff as the skin.
  const weightScratch = {};
  function deformAt(profile, y, out = {}) {
    out.x = out.y = out.z = 0;
    const curve = profile?.curve;
    if (!curve) return out;
    const { neckY, modelHeight, posteriorY } = profile;
    const w = nodeWeightsAt(y, neckY, modelHeight, posteriorY, weightScratch);
    const blend = Math.max(modelHeight * 0.012, Number(profile.blendHeight) || modelHeight * 0.3);
    const head = smoothstep01((y - (neckY - blend * 0.55)) / blend);
    const a = curve[w.a], b = curve[w.b], last = curve[SEGMENTS];
    out.x = (1 - head) * (a.x + (b.x - a.x) * w.wb) + head * last.x;
    out.y = (1 - head) * (a.y + (b.y - a.y) * w.wb) + head * last.y;
    out.z = (1 - head) * (a.z + (b.z - a.z) * w.wb) + head * last.z;
    return out;
  }

  // "Show bones" overlay for the portrait skin: the spline itself, drawn as children of the skinned plane so the nodes sit in the bones' own
  // frame and show the curl as it is. Posterior (the root) green, the five middle nodes orange, the neck node violet. The leg solver owns the
  // toggle (ProceduralLegAnimation.showBones): it calls sync(visible) every frame, so the guides appear with the leg guides, upright or not.
  function makeBoneGuides(THREE, rig) {
    const plane = rig?.skinnedPlane;
    const nodes = Array.isArray(rig?.splineNodes) ? rig.splineNodes : rig?.splineNodes?.front;
    if (!plane?.isObject3D || !nodes || nodes.length < SPLINE_NODES) return null;
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
    const rootColor = 0x6fd17f, nodeColor = 0xff9f1a, neckColor = 0xc77dff;
    const cylinderGeometry = new THREE.CylinderGeometry(0.012 * H / 0.9, 0.015 * H / 0.9, 1, 8);
    const jointGeometry = new THREE.SphereGeometry(0.021 * H / 0.9, 10, 8);
    geometries.push(cylinderGeometry, jointGeometry);
    const guideBones = [], guideJoints = [];
    for (let k = 0; k < SPLINE_NODES; k++) {
      const joint = new THREE.Mesh(jointGeometry, guideMaterial(k === 0 ? rootColor : k === SEGMENTS ? neckColor : nodeColor, 0.85));
      joint.renderOrder = 43; joint.frustumCulled = false; group.add(joint); guideJoints.push(joint);
      if (k > 0) {
        const bone = new THREE.Mesh(cylinderGeometry, guideMaterial(nodeColor, 0.62));
        bone.renderOrder = 42; bone.frustumCulled = false; group.add(bone); guideBones.push(bone);
      }
    }
    const points = Array.from({ length: SPLINE_NODES }, () => new THREE.Vector3());
    plane.add(group);
    let visible = false;
    return {
      group,
      sync(show) {
        if (show !== visible) { visible = !!show; group.visible = visible; }
        if (!visible) return;
        points[0].copy(nodes[0].position); // The first node is a child of the plane, the frame the guides live in; the rest chain by local offset (no node carries rotation or scale).
        for (let k = 1; k < SPLINE_NODES; k++) points[k].copy(points[k - 1]).add(nodes[k].position);
        for (let k = 0; k < SPLINE_NODES; k++) {
          guideJoints[k].position.copy(points[k]);
          if (k === 0) continue;
          const from = points[k - 1], to = points[k], bone = guideBones[k - 1];
          const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
          bone.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
          bone.scale.set(1, Math.max(1e-4, length), 1);
          bone.quaternion.setFromUnitVectors(bone.up, new THREE.Vector3(dx, dy, dz).multiplyScalar(1 / Math.max(1e-6, length)));
        }
      },
      dispose() {
        group.parent?.remove(group);
        for (const geometry of geometries) geometry.dispose?.();
        for (const material of materials) material.dispose?.();
      },
    };
  }

  const resolve = source => profileFor(hunchFor(source), swayFor(source));

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

  // World displacement of the attack-orbit centre (the shoulder line, carried by the curve) for a body with the given whole-rig scales:
  // { x: sideways, y: vertical (negative = lower), z: forward }, in the pose frame HobunjiSpeciesPoseScale.transformPosePoint works in
  // (z follows the width scale, like the rest of the rig). Null for an upright character.
  function orbitOffsetWorld(spine, rigScaleX = 1, rigScaleY = 1) {
    const offset = spine?.orbitOffset;
    if (!offset || (!offset.x && !offset.y && !offset.z)) return null;
    const sx = Number(rigScaleX) > 0 ? Number(rigScaleX) : 1, sy = Number(rigScaleY) > 0 ? Number(rigScaleY) : 1;
    return { x: offset.x * sx, y: offset.y * sy, z: offset.z * sx };
  }

  window.HobunjiCharacterSpine = Object.freeze({
    splineNodes: SPLINE_NODES,
    shoulderDropRatio: SHOULDER_DROP_RATIO,
    depthScale: DEPTH_SCALE,
    nodeWeightsAt,
    layoutFor,
    solveCurve,
    applyToRig,
    deformAt,
    posteriorLocalY,
    makeBoneGuides,
    stanceWiden: STANCE_WIDEN,
    strideWiden: STRIDE_WIDEN,
    hunchFor,
    swayFor,
    profileFor,
    resolve,
    bind,
    fromRoot,
    orbitOffsetWorld,
  });
})();
