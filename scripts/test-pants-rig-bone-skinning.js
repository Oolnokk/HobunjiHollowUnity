#!/usr/bin/env node
'use strict';

// Pants rig bone maths: the knee is the exact midpoint of hip and ankle, each leg bone (thigh, calf) is aligned
// from its 2D position onto the live 3D bone, and weighted skinning warps the garment accordingly.

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const sandbox = { globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('docs/js/pants-rig-core.js', 'utf8'), sandbox);
const Core = sandbox.HobunjiPantsRig;
assert(Core, 'HobunjiPantsRig was not published');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const nearPoint = (p, q, eps = 1e-9) => near(p.x, q.x, eps) && near(p.y, q.y, eps);
let seed = 12345;
const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; // Deterministic.

// ---- knee at the exact midpoint -------------------------------------------
const samePoint = (p, q) => p.x === q.x && p.y === q.y; // Objects from the vm sandbox have a different prototype, so compare coordinates.
assert(samePoint(Core.kneeAtMidpoint({ x: 0.2, y: 0.4 }, { x: 0.6, y: 0.8 }), { x: (0.2 + 0.6) / 2, y: (0.4 + 0.8) / 2 }), 'knee is (hip + ankle) / 2');
for (let i = 0; i < 200; i++) {
  const hip = { x: random(), y: random() }, ankle = { x: random(), y: random() };
  const knee = Core.kneeAtMidpoint(hip, ankle);
  assert(near(knee.x - hip.x, ankle.x - knee.x, 1e-12) && near(knee.y - hip.y, ankle.y - knee.y, 1e-12), 'thigh and calf must be exactly equal in length and direction');
}
const skewed = { left: { hip: { x: 0.39, y: 0.36 }, knee: { x: 0.285, y: 0.515 }, ankle: { x: 0.17, y: 0.69 } }, right: { hip: { x: 0.61, y: 0.36 } , knee: { x: 0.9, y: 0.1 }, ankle: { x: 0.83, y: 0.69 } } };
const fixed = Core.normalizeLegBones(skewed);
for (const side of ['left', 'right']) {
  assert(samePoint(fixed[side].hip, skewed[side].hip), `${side} hip must not move`);
  assert(samePoint(fixed[side].ankle, skewed[side].ankle), `${side} ankle must not move`);
  assert(nearPoint(fixed[side].knee, { x: (skewed[side].hip.x + skewed[side].ankle.x) / 2, y: (skewed[side].hip.y + skewed[side].ankle.y) / 2 }), `${side} knee must be the exact midpoint`);
}
assert(!samePoint(skewed.right.knee, fixed.right.knee), 'normalizing must replace a wandering knee');
assert.doesNotThrow(() => Core.normalizeLegBones(null), 'missing bones must not throw');

// ---- bone alignment ---------------------------------------------------------
const apply = (t, p) => ({ x: t.a * p.x + t.c * p.y + t.tx, y: t.b * p.x + t.d * p.y + t.ty });
for (let i = 0; i < 300; i++) {
  const a2 = { x: random(), y: random() }, b2 = { x: random(), y: random() };
  const a3 = { x: random() * 2 - 1, y: random() * 2 - 1 }, b3 = { x: random() * 2 - 1, y: random() * 2 - 1 };
  if (Math.hypot(b2.x - a2.x, b2.y - a2.y) < 0.05 || Math.hypot(b3.x - a3.x, b3.y - a3.y) < 0.05) continue;
  const length2 = Math.hypot(b2.x - a2.x, b2.y - a2.y), length3 = Math.hypot(b3.x - a3.x, b3.y - a3.y);
  if (length3 / length2 > 12 || length3 / length2 < 0.08) continue; // Beyond the stretch clamp, which is tested separately.
  const t = Core.alignBoneSegment(a2, b2, a3, b3);
  assert(nearPoint(apply(t, a2), a3, 1e-9), 'the bone start must land exactly on the 3D joint');
  assert(nearPoint(apply(t, b2), b3, 1e-9), 'the bone end must land exactly on the 3D joint');
  // A point beside the 2D bone stays the same distance beside the 3D bone (thickness is preserved).
  const ux = (b2.x - a2.x) / length2, uy = (b2.y - a2.y) / length2;
  const side = { x: a2.x - uy * 0.07, y: a2.y + ux * 0.07 };
  const moved = apply(t, side);
  const ux3 = (b3.x - a3.x) / length3, uy3 = (b3.y - a3.y) / length3;
  const across = (moved.x - a3.x) * -uy3 + (moved.y - a3.y) * ux3;
  const along = (moved.x - a3.x) * ux3 + (moved.y - a3.y) * uy3;
  assert(near(across, 0.07, 1e-9), `distance across the bone must stay 0.07, got ${across}`);
  assert(near(along, 0, 1e-9), 'a point level with the bone start stays level with it');
}
{ // A 2D thigh that is 0.2 long mapped onto a 3D thigh 0.6 long stretches 3x along the bone only.
  const t = Core.alignBoneSegment({ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.4 }, { x: 0.1, y: 0.1 }, { x: 0.1, y: 0.7 });
  assert(near(t.stretch, 3) && near(t.rotation, 0), 'straight-down to straight-down: stretch 3, no rotation');
  assert(nearPoint(apply(t, { x: 0.6, y: 0.3 }), { x: 0.2, y: 0.4 }), 'halfway down and 0.1 across becomes 0.3 down and 0.1 across');
}
{ // A pure rotation: identical lengths, bone turned a quarter turn.
  const t = Core.alignBoneSegment({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 });
  assert(near(Math.abs(t.rotation), Math.PI / 2) && near(t.stretch, 1));
  assert(nearPoint(apply(t, { x: 2, y: 0 }), { x: 0, y: 2 }));
}
{ // perpendicularScale widens the garment across the bone without touching the length match.
  const t = Core.alignBoneSegment({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 2 }, { perpendicularScale: 2 });
  assert(nearPoint(apply(t, { x: 0, y: 1 }), { x: 0, y: 2 }), 'the bone end still lands on the 3D joint');
  assert(nearPoint(apply(t, { x: 0.1, y: 0 }), { x: 0.2, y: 0 }), 'across-bone distance doubles with perpendicularScale 2');
}
{ // 'balanced' widens across the bone by the square root of the stretch: a 4x stretch is 2x wider, no stretch stays 1x.
  const stretched = Core.alignBoneSegment({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 4 }, { perpendicularScale: 'balanced' });
  assert(nearPoint(apply(stretched, { x: 0, y: 1 }), { x: 0, y: 4 }), 'the bone end still lands on the 3D joint');
  assert(nearPoint(apply(stretched, { x: 0.1, y: 0 }), { x: 0.2, y: 0 }), 'a 4x stretch widens the garment 2x');
  const same = Core.alignBoneSegment({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 1 }, { perpendicularScale: 'balanced' });
  assert(nearPoint(apply(same, { x: 0.1, y: 0.5 }), { x: 0.1, y: 0.5 }), 'no stretch means no widening');
  const shorter = Core.alignBoneSegment({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0.25 }, { perpendicularScale: 'balanced' });
  assert(nearPoint(apply(shorter, { x: 0.1, y: 0 }), { x: 0.05, y: 0 }), 'a short-legged species gets a proportionally narrower garment');
}
{ // Degenerate bones never produce NaN: the garment just follows the joint.
  const t = Core.alignBoneSegment({ x: 0.3, y: 0.3 }, { x: 0.3, y: 0.3 }, { x: 1, y: 1 }, { x: 1, y: 2 });
  assert(Object.values(t).every(Number.isFinite) && nearPoint(apply(t, { x: 0.3, y: 0.3 }), { x: 1, y: 1 }));
  const clamped = Core.alignBoneSegment({ x: 0, y: 0 }, { x: 0, y: 0.001 }, { x: 0, y: 0 }, { x: 0, y: 9 });
  assert(clamped.stretch <= 12, 'a runaway foot target must not blow the garment up');
}

// ---- weighted skinning ------------------------------------------------------
const base = new Float32Array([0.2, 0.3, 0.012, 0.8, 0.9, 0.012, 0.5, 0.5, 0.012]);
const move = { a: 1, b: 0, c: 0, d: 1, tx: 1, ty: 2 }; // Pure translation.
const stretch = Core.alignBoneSegment({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 2 });
const out = new Float32Array(9);
// Vertex 0: all belt (rigid). Vertex 1: all left thigh. Vertex 2: half belt, half left thigh.
const weights = new Float32Array([1, 0, 0, 0, 0,   0, 1, 0, 0, 0,   0.5, 0.5, 0, 0, 0]);
Core.skinWeightedPositions(base, weights, [null, move, null, null, null], out);
assert(near(out[0], 0.2, 1e-6) && near(out[1], 0.3, 1e-6), 'belt-weighted vertices stay rigid');
assert(near(out[3], 1.8, 1e-6) && near(out[4], 2.9, 1e-6), 'a fully bone-weighted vertex follows its bone transform');
assert(near(out[6], 0.5 + 0.5, 1e-6) && near(out[7], 0.5 + 1, 1e-6), 'a half-weighted vertex lands halfway between rigid and the bone');
assert([out[2], out[5], out[8]].every(z => near(z, 0.012, 1e-6)), 'depth is carried through unchanged');
{ // The knee vertex: weighted between thigh and calf, both of which map the knee to the same 3D point.
  const hip2 = { x: 0.4, y: 0.4 }, ankle2 = { x: 0.2, y: 0.8 };
  const knee2 = Core.kneeAtMidpoint(hip2, ankle2);
  const hip3 = { x: 0.3, y: 0.0 }, ankle3 = { x: 0.1, y: -0.6 };
  const knee3 = Core.kneeAtMidpoint(hip3, ankle3);
  const thigh = Core.alignBoneSegment(hip2, knee2, hip3, knee3);
  const calf = Core.alignBoneSegment(knee2, ankle2, knee3, ankle3);
  const kneeVertex = new Float32Array([knee2.x, knee2.y, 0.012]);
  for (const mix of [0, 0.25, 0.5, 0.9, 1]) {
    const result = Core.skinWeightedPositions(kneeVertex, new Float32Array([0, 1 - mix, mix, 0, 0]), [null, thigh, calf, null, null], new Float32Array(3));
    assert(near(result[0], knee3.x, 1e-6) && near(result[1], knee3.y, 1e-6), `the knee stays on the 3D knee at thigh/calf mix ${mix}, so the leg cannot tear at the joint`);
  }
  // Dramatic warp: the 2D leg is 0.4 long, the 3D leg is 0.6 long and tilted: the garment ankle follows it.
  const ankleVertex = new Float32Array([ankle2.x, ankle2.y, 0.012]);
  const ankleOut = Core.skinWeightedPositions(ankleVertex, new Float32Array([0, 0, 1, 0, 0]), [null, thigh, calf, null, null], new Float32Array(3));
  assert(near(ankleOut[0], ankle3.x, 1e-6) && near(ankleOut[1], ankle3.y, 1e-6), 'the garment ankle lands on the 3D foot');
}

// ---- full 3D alignment: legs swinging about the x axis ----------------------
{
  const apply3 = (t, p) => ({ x: t.m[0] * p.x + t.m[1] * p.y + t.m[2] * p.z + t.tx, y: t.m[3] * p.x + t.m[4] * p.y + t.m[5] * p.z + t.ty, z: t.m[6] * p.x + t.m[7] * p.y + t.m[8] * p.z + t.tz });
  const close3 = (p, q, eps = 1e-9) => near(p.x, q.x, eps) && near(p.y, q.y, eps) && near(p.z, q.z, eps);
  const hip2 = { x: 0.1, y: 0.2, z: 0.012 }, knee2 = { x: 0.1, y: 0.1, z: 0.012 };
  // The leg swings forward 40 degrees about the x axis: still 0.2 long in 3D, but its y extent shrinks and it gains z.
  const angle = 40 * Math.PI / 180, length = 0.2;
  const hip3 = { x: 0.5, y: 1, z: 0 }, knee3 = { x: 0.5, y: 1 - length * Math.cos(angle), z: length * Math.sin(angle) };
  const t = Core.alignBoneSegment3D(hip2, knee2, hip3, knee3, { normal: { x: 0, y: 0, z: 1 } });
  assert(close3(apply3(t, hip2), hip3) && close3(apply3(t, knee2), knee3), '3D bone ends land exactly on the live joints');
  assert(near(t.stretch, 2) && near(t.rotation, angle, 1e-9), 'a 0.1 bone mapped to a 0.2 bone is a 2x stretch turned by the swing angle');
  // The garment plane tilts with the leg: a point beside the bone stays beside it (x), and a point in front of the plane tilts too.
  const beside = apply3(t, { x: 0.15, y: 0.2, z: 0.012 }); // 0.05 beside the hip, level with it.
  assert(near(Math.hypot(beside.x - hip3.x, beside.y - hip3.y, beside.z - hip3.z), 0.05, 1e-9) && near(beside.x - hip3.x, 0.05, 1e-9), 'across the bone stays across it, at the same distance');
  const front = apply3(t, { x: 0.1, y: 0.2, z: 0.012 + 0.05 });
  assert(near(Math.hypot(front.x - hip3.x, front.y - hip3.y, front.z - hip3.z), 0.05, 1e-9), 'thickness (distance out of the plane) is kept');
  // Leg flipped end for end must not produce NaN.
  const flipped = Core.alignBoneSegment3D(hip2, knee2, { x: 0, y: 0, z: 0 }, { x: 0, y: 0.2, z: 0 });
  assert(flipped.m.every(Number.isFinite) && close3(apply3(flipped, knee2), { x: 0, y: 0.2, z: 0 }));
  // Skinning with a 3D transform moves z as well.
  const baseV = new Float32Array([0.1, 0.1, 0.012]);
  const outV = Core.skinWeightedPositions(baseV, new Float32Array([0, 1, 0, 0, 0]), [null, t, null, null, null], new Float32Array(3));
  assert(near(outV[0], knee3.x, 1e-6) && near(outV[1], knee3.y, 1e-6) && near(outV[2], knee3.z, 1e-6), 'skinning carries depth with the swing');
  // A 2D-only bone (z all equal) behaves like the planar version.
  const planar = Core.alignBoneSegment({ x: 0.2, y: 0.3 }, { x: 0.2, y: 0.5 }, { x: 1, y: 1 }, { x: 1.5, y: 1.3 }, { perpendicularScale: 'balanced' });
  const spatial = Core.alignBoneSegment3D({ x: 0.2, y: 0.3, z: 0 }, { x: 0.2, y: 0.5, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 1.5, y: 1.3, z: 0 }, { perpendicularScale: 'balanced' });
  const probe = { x: 0.3, y: 0.4, z: 0 };
  assert(near(apply(planar, probe).x, apply3(spatial, probe).x, 1e-9) && near(apply(planar, probe).y, apply3(spatial, probe).y, 1e-9), 'in the plane the 3D transform equals the planar one');
}

// ---- leg roll gain (lateral swing strength, pitch untouched) ------------------
{
  const mk = (h, k, a) => ({ hip: { x: h[0], y: h[1], z: h[2] }, knee: { x: k[0], y: k[1], z: k[2] }, ankle: { x: a[0], y: a[1], z: a[2] } });
  const blank = () => mk([0, 0, 0], [0, 0, 0], [0, 0, 0]);
  const leg = mk([0, 0, 0], [0.1, -0.2, 0.15], [0.15, -0.35, 0.2]); // Splayed toward +x AND pitched forward (z).
  const same = Core.amplifyLegRoll(leg, 1, blank());
  for (const j of ['hip', 'knee', 'ankle']) assert(near(same[j].x, leg[j].x) && near(same[j].y, leg[j].y) && near(same[j].z, leg[j].z), 'gain 1 must return the live bones exactly');
  const strong = Core.amplifyLegRoll(leg, 3, blank());
  const bone = (l, from, to) => ({ x: l[to].x - l[from].x, y: l[to].y - l[from].y, z: l[to].z - l[from].z });
  const lateral = v => Math.atan2(v.x, Math.hypot(v.y, v.z));
  const pitch = v => Math.atan2(v.z, -v.y); // Forward/back tilt about x.
  for (const [from, to] of [['hip', 'knee'], ['knee', 'ankle']]) {
    const before = bone(leg, from, to), after = bone(strong, from, to);
    assert(near(lateral(after), 3 * lateral(before), 1e-9), `${to}: lateral splay is multiplied by the gain`);
    assert(near(pitch(after), pitch(before), 1e-9), `${to}: pitch (forward/back tilt) is untouched`);
    assert(near(Math.hypot(after.x, after.y, after.z), Math.hypot(before.x, before.y, before.z), 1e-9), `${to}: bone length is unchanged`);
  }
  const hanging = Core.amplifyLegRoll(mk([0, 0, 0], [0, -0.2, 0.1], [0, -0.4, 0.2]), 5, blank());
  assert(near(hanging.ankle.x, 0) && near(hanging.ankle.y, -0.4) && near(hanging.ankle.z, 0.2), 'a leg with no lateral splay is not moved by any gain');
  const flat = Core.amplifyLegRoll(mk([0, 0, 0], [0.3, 0, 0], [0.6, 0, 0]), 4, blank());
  assert([flat.knee, flat.ankle].every(j => Number.isFinite(j.x) && Number.isFinite(j.y) && Number.isFinite(j.z)), 'a sideways-horizontal leg stays finite');
}

// ---- weight sharpening ---------------------------------------------------------
{
  const w = new Float32Array([0.25, 0.49, 0.26, 0, 0,   1, 0, 0, 0, 0,   0.5, 0.5, 0, 0, 0]);
  Core.sharpenWeights(w, 4);
  const cellSum = v => w[v * 5] + w[v * 5 + 1] + w[v * 5 + 2] + w[v * 5 + 3] + w[v * 5 + 4];
  assert([0, 1, 2].every(v => near(cellSum(v), 1, 1e-6)), 'cells stay normalized');
  assert(w[1] > 0.8 && w[0] < 0.1, 'a 49% bone vertex becomes strongly bone-weighted');
  assert(near(w[5], 1) && near(w[10], 0.5) && near(w[11], 0.5), 'pure and even cells are unchanged');
  const same = new Float32Array([0.3, 0.7, 0, 0, 0]);
  Core.sharpenWeights(same, 1);
  assert(near(same[0], 0.3, 1e-6) && near(same[1], 0.7, 1e-6), 'power 1 leaves weights as painted');
}

// ---- portrait mapping + species default beltline ----------------------------------
{
  const mapping = Core.portraitMapping({ x: -0.45, y: 0.5 }, { x: 0.45, y: 0.5 }, { x: -0.45, y: -0.4 }); // 0.9 wide, y up on screen
  const mid = Core.portraitPointForLocal(mapping, 0, 0.05);
  assert(near(mid.x, 0.5) && near(mid.y, 0.5), 'the middle of the plane is the middle of the canvas');
  const low = Core.portraitPointForLocal(mapping, 0, -0.4);
  assert(near(low.y, 1), 'the bottom edge of the plane is canvas y = 1');
  const belt = Core.defaultBeltAtPosterior(0.7);
  assert(belt.length === 5 && near(belt[2].y, 0.7) && belt.every(p => p.y >= 0.7 - 1e-9 && p.y <= 0.72), 'default belt sits at the posterior height with the garment belt\'s own curve');
  assert(Core.defaultBeltAtPosterior(1.4).every(p => p.y <= 1), 'a posterior below the image rests on the image edge');
  // A default belt maps the default garment onto the portrait at natural scale (no collapse).
  const garmentBelt = [0.28, 0.27, 0.265, 0.27, 0.28].map((y, i) => ({ x: [0.34, 0.42, 0.5, 0.58, 0.66][i], y }));
  for (const py of [0.3, 0.7, 0.88, 1.2]) {
    const fit = Core.solveAffine(garmentBelt, Core.defaultBeltAtPosterior(py));
    assert(near(fit.d, 1, 1e-6) && near(fit.a, 1, 1e-6), `default belt at ${py} keeps natural scale`);
  }
  // A badly mismatched (almost straight) belt can no longer collapse the garment vertically.
  const flatTarget = [0.34, 0.42, 0.5, 0.58, 0.66].map(x => ({ x, y: 0.86 }));
  const squash = Core.solveAffine(garmentBelt, flatTarget);
  assert(Math.hypot(squash.c, squash.d) >= 0.7 * Math.hypot(squash.a, squash.b) - 1e-9, 'vertical scale stays within the sane band of the horizontal scale');
  const centerMapped = Core.applyAffine(squash, { x: 0.5, y: 0.273 });
  assert(near(centerMapped.y, 0.86, 1e-3), 'the belt centre stays anchored');
  assert(Core.defaultBeltAtPosterior(NaN).every(p => Number.isFinite(p.y)), 'a missing posterior still yields a belt');
}

// ---- initial planar warp + animation motion ------------------------------------------
{
  const P = (x, y, z = 0) => ({ x, y, z });
  const through = (t, p) => ({ x: t.m[0] * p.x + t.m[1] * p.y + t.m[2] * p.z + t.tx, y: t.m[3] * p.x + t.m[4] * p.y + t.m[5] * p.z + t.ty, z: t.m[6] * p.x + t.m[7] * p.y + t.m[8] * p.z + t.tz });
  const g0 = P(0.2, 0.3, 0.012), g1 = P(0.1, 0.6, 0.012); // Garment bone (diagonal in the picture), at the portrait plane depth.
  const r0 = P(0.5, 1, 0.012), r1 = P(0.5, 0.8, 0.012); // Rest bone: straight down, flattened to the same depth.
  const planar = Core.alignBoneSegment(g0, g1, r0, r1, { perpendicularScale: 'balanced' });
  // At rest (live == rest) the result is EXACTLY the planar 2D warp: nothing leaves the portrait plane.
  const atRest = Core.alignBoneWithMotion(g0, g1, r0, r1, r0, r1, { perpendicularScale: 'balanced' });
  for (const p of [P(0.2, 0.3, 0.012), P(0.1, 0.6, 0.012), P(0.4, 0.45, 0.012), P(0.15, 0.5, 0.012)]) {
    const w = through(atRest, p), expected = { x: planar.a * p.x + planar.c * p.y + planar.tx, y: planar.b * p.x + planar.d * p.y + planar.ty };
    assert(near(w.x, expected.x) && near(w.y, expected.y), 'at rest the warp is the planar warp');
    assert(near(w.z, 0.012), 'at rest every point stays at the portrait plane depth (parallel, no tilt)');
  }
  assert(atRest.m[2] === 0 && atRest.m[5] === 0 && atRest.m[6] === 0 && atRest.m[7] === 0, 'at rest no x/y vs z coupling exists');
  // Animation: the leg pitches forward 40 degrees about x (pitch), the same length. The joints follow; depth appears.
  const a = 40 * Math.PI / 180, len = 0.2;
  const l0 = r0, l1 = P(0.5, 1 - len * Math.cos(a), 0.012 + len * Math.sin(a));
  const moved = Core.alignBoneWithMotion(g0, g1, r0, r1, l0, l1, { perpendicularScale: 'balanced' });
  assert(near(through(moved, g0).x, l0.x) && near(through(moved, g0).y, l0.y) && near(through(moved, g0).z, l0.z), 'bone start follows the live joint');
  const end = through(moved, g1);
  assert(near(end.x, l1.x) && near(end.y, l1.y) && near(end.z, l1.z), 'bone end follows the live joint (pitch included)');
  assert(near(moved.rotation, a, 1e-9), 'the motion rotation is the animation pitch, nothing more');
  // A garment point beside the bone tilts with the pitch instead of staying in the plane.
  const beside = through(moved, P(0.3, 0.3, 0.012));
  assert(beside.z > 0.012 || beside.z < 0.012, 'points off the bone move in depth with the pitch');
  // Lengthening since rest stretches the garment bone along its length.
  const longer = Core.alignBoneWithMotion(g0, g1, r0, r1, r0, P(0.5, 0.7, 0.012), { perpendicularScale: 1 });
  assert(near(through(longer, g1).y, 0.7), 'a longer live bone lengthens the garment leg');
  // Shared knee stays shared: thigh and calf transforms agree on the knee in any pose.
  const knee = P(0.5, 0.9, 0.012), kneeLive = P(0.52, 0.9 - 0.1 * Math.cos(a), 0.012 + 0.1 * Math.sin(a));
  const thighT = Core.alignBoneWithMotion(P(0.2, 0.3, 0.012), P(0.15, 0.45, 0.012), r0, knee, l0, kneeLive);
  const calfT = Core.alignBoneWithMotion(P(0.15, 0.45, 0.012), P(0.1, 0.6, 0.012), knee, r1, kneeLive, l1);
  const k1 = through(thighT, P(0.15, 0.45, 0.012)), k2 = through(calfT, P(0.15, 0.45, 0.012));
  assert(near(k1.x, k2.x) && near(k1.y, k2.y) && near(k1.z, k2.z), 'thigh and calf share the knee');
}

// ---- whole-leg weighting (pant sides follow the bone) ----------------------------------
{
  const garment = {
    legBones: { left: { hip: { x: 0.3, y: 0.3 }, knee: { x: 0.3, y: 0.55 }, ankle: { x: 0.3, y: 0.8 } }, right: { hip: { x: 0.7, y: 0.3 }, knee: { x: 0.7, y: 0.55 }, ankle: { x: 0.7, y: 0.8 } } },
    legOpenings: { left: [0.2, 0.25, 0.3, 0.35, 0.4].map(x => ({ x, y: 0.8 })), right: [0.6, 0.65, 0.7, 0.75, 0.8].map(x => ({ x, y: 0.8 })) },
  };
  const segments = 20, count = (segments + 1) * (segments + 1);
  const belt = () => { const w = new Float32Array(count * 5); for (let i = 0; i < count; i++) w[i * 5] = 1; return w; }; // Everything painted belt, as with default weights.
  const at = (u, v) => Math.round(v * segments) * (segments + 1) + Math.round(u * segments);
  const w = belt();
  Core.applyLegAxisWeights(w, segments, garment, 1);
  const cell = (u, v) => Array.from(w.slice(at(u, v) * 5, at(u, v) * 5 + 5));
  const side = cell(0.1, 0.7); // The far outer side of the left leg, low on the leg.
  assert(side[3] === 0 && side[4] === 0 && side[0] < 0.05 && side[1] + side[2] > 0.95, 'the side of a leg is leg-weighted, not belt-weighted');
  const middle = cell(0.5, 0.7); // The crotch/between-the-legs region below the hip.
  assert(middle[0] < 0.05 && middle[1] + middle[2] + middle[3] + middle[4] > 0.95, 'the region between the legs follows the legs too, so the hem cannot go concave');
  assert(cell(0.3, 0.7)[2] > 0.95 && cell(0.3, 0.7)[1] < 0.05, 'calf below the knee');
  assert(cell(0.3, 0.4)[1] > 0.5, 'thigh between hip and knee, once past the hip blend');
  assert(near(cell(0.3, 0.2)[0], 1) && near(cell(0.7, 0.29)[0], 1), 'above the hip stays belt');
  assert(cell(0.9, 0.7)[3] + cell(0.9, 0.7)[4] > 0.95 && cell(0.9, 0.7)[1] === 0, 'the right leg is handled the same way');
  const sum = i => w.slice(i * 5, i * 5 + 5).reduce((a, b) => a + b, 0);
  assert([at(0.1, 0.7), at(0.5, 0.7), at(0.3, 0.35), at(0.8, 0.6)].every(i => near(sum(i), 1, 1e-5)), 'cells stay normalized');
  const off = belt(); Core.applyLegAxisWeights(off, segments, garment, 0);
  assert(off.every((value, i) => value === (i % 5 === 0 ? 1 : 0)), 'strength 0 leaves the painted weights alone');
}

// ---- uniform scale-down for short legs ---------------------------------------------
{
  const apply = (t, p) => ({ x: t.a * p.x + t.c * p.y + t.tx, y: t.b * p.x + t.d * p.y + t.ty });
  const down = Core.alignBoneSegment({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0.25 }, { perpendicularScale: 'shrinkUniform' });
  assert(nearPoint(apply(down, { x: 0.2, y: 0.5 }), { x: 0.05, y: 0.125 }), 'a 4x shorter leg scales down uniformly: width shrinks as much as length');
  const up = Core.alignBoneSegment({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 4 }, { perpendicularScale: 'shrinkUniform' });
  assert(nearPoint(apply(up, { x: 0.1, y: 0 }), { x: 0.2, y: 0 }), 'a longer leg widens by the square root of the stretch');
}

// ---- posterior fit ---------------------------------------------------------------------
{
  const garment = {
    pantsBeltSpline: [0.34, 0.42, 0.5, 0.58, 0.66].map((x, i) => ({ x, y: [0.28, 0.27, 0.265, 0.27, 0.28][i] })),
    legBones: { left: { hip: { x: 0.4, y: 0.4 }, knee: { x: 0.4, y: 0.6 }, ankle: { x: 0.4, y: 0.8 } }, right: { hip: { x: 0.6, y: 0.4 }, knee: { x: 0.6, y: 0.6 }, ankle: { x: 0.6, y: 0.8 } } },
  };
  const portraitBelt = [0.3, 0.4, 0.5, 0.6, 0.7].map(x => ({ x, y: 0.9 })); // 0.4 wide vs the garment belt's 0.32.
  const fit = Core.solvePosteriorFit(garment, portraitBelt, { x: 0.5, y: 0.9 }, 0.06); // Legs 0.06 long in the portrait vs 0.4 in the garment.
  assert(near(fit.a, 0.4 / 0.32) && near(fit.d, 0.06 / 0.4), 'horizontal stretch matches the beltline width; vertical scale matches the leg length');
  const hipMapped = Core.applyAffine(fit, { x: 0.5, y: 0.4 });
  assert(near(hipMapped.x, 0.5) && near(hipMapped.y, 0.9), 'the garment hip centre lands on the posterior point, centred under the beltline');
  const ankleMapped = Core.applyAffine(fit, { x: 0.4, y: 0.8 });
  assert(near(ankleMapped.y - hipMapped.y, 0.06), 'the garment legs are exactly as long as the species legs');
  assert(Core.solvePosteriorFit(garment, portraitBelt, { x: 0.5, y: 0.9 }, NaN) !== null, 'a missing leg length falls back to natural scale');
  assert(Core.solvePosteriorFit({ legBones: null, pantsBeltSpline: garment.pantsBeltSpline }, portraitBelt, { x: 0.5, y: 0.9 }, 0.06) !== undefined, 'missing bones never throw');
}

// ---- translate-only initial alignment (posterior fit) -----------------------------------
{
  const P = (x, y, z = 0.012) => ({ x, y, z });
  const hipG = P(0.4, 0.3), kneeG = P(0.3, 0.32), hipR = P(0.5, 1), kneeR = P(0.5, 0.98);
  const t = Core.alignBoneWithMotion(hipG, kneeG, hipR, kneeR, hipR, kneeR, { initial: 'translate', anchorFrom: hipG, anchorTo: hipR });
  const p = { x: 0.35, y: 0.31, z: 0.012 };
  const out = { x: t.m[0] * p.x + t.m[1] * p.y + t.m[2] * p.z + t.tx, y: t.m[3] * p.x + t.m[4] * p.y + t.m[5] * p.z + t.ty, z: t.m[6] * p.x + t.m[7] * p.y + t.m[8] * p.z + t.tz };
  assert(near(out.x, 0.45) && near(out.y, 1.01) && near(out.z, 0.012), 'at rest the garment is only translated: shape, size and orientation come from the whole-sprite fit');
}

// ---- rotation damping -------------------------------------------------------------------
{
  const P = (x, y, z = 0.012) => ({ x, y, z });
  const g0 = P(0.2, 0.5), g1 = P(0.2, 0.3), r0 = P(0.5, 1), r1 = P(0.5, 0.8); // Garment bone already points the same way as the rest bone.
  const a = 40 * Math.PI / 180;
  const l1 = P(0.5, 1 - 0.2 * Math.cos(a), 0.012 + 0.2 * Math.sin(a));
  const full = Core.alignBoneWithMotion(g0, g1, r0, r1, r0, l1);
  const half = Core.alignBoneWithMotion(g0, g1, r0, r1, r0, l1, { rotationScale: 0.5 });
  const none = Core.alignBoneWithMotion(g0, g1, r0, r1, r0, l1, { rotationScale: 0 });
  const rot = t => Math.acos(Math.max(-1, Math.min(1, (t.m[0] + t.m[4] + t.m[8] - 1) / 2))); // Angle from the matrix trace (uniform scale 1 here).
  assert(near(rot(full), a, 1e-6) && near(rot(half), a / 2, 1e-6) && near(rot(none), 0, 1e-6), 'rotationScale scales the animation angle');
  const hipOut = (t, p) => ({ x: t.m[0] * p.x + t.m[1] * p.y + t.m[2] * p.z + t.tx, y: t.m[3] * p.x + t.m[4] * p.y + t.m[5] * p.z + t.ty, z: t.m[6] * p.x + t.m[7] * p.y + t.m[8] * p.z + t.tz });
  assert(near(hipOut(half, g0).x, r0.x) && near(hipOut(half, g0).y, r0.y), 'the hip still follows the live hip when damped');
}

console.log('Pants rig bone skinning: PASS');
