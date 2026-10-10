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

// ---- leg roll gain (z rotation strength) -------------------------------------
{
  const mk = (h, k, a) => ({ hip: { x: h[0], y: h[1], z: h[2] }, knee: { x: k[0], y: k[1], z: k[2] }, ankle: { x: a[0], y: a[1], z: a[2] } });
  const blank = () => mk([0, 0, 0], [0, 0, 0], [0, 0, 0]);
  const leg = mk([0, 0, 0], [0.1, -0.2, 0.05], [0.2, -0.4, 0.1]); // Swung toward +x by atan(0.5) = 26.6 degrees, with some z.
  const same = Core.amplifyLegRoll(leg, 1, blank());
  for (const j of ['hip', 'knee', 'ankle']) assert(near(same[j].x, leg[j].x) && near(same[j].y, leg[j].y) && near(same[j].z, leg[j].z), 'gain 1 must return the live bones exactly');
  const strong = Core.amplifyLegRoll(leg, 3, blank());
  const angle = v => Math.atan2(v.x, -v.y);
  const thighBefore = { x: leg.knee.x - leg.hip.x, y: leg.knee.y - leg.hip.y }, thighAfter = { x: strong.knee.x - strong.hip.x, y: strong.knee.y - strong.hip.y };
  assert(near(angle(thighAfter), 3 * angle(thighBefore), 1e-9), 'the thigh swings 3x as far from straight down');
  assert(near(Math.hypot(thighAfter.x, thighAfter.y), Math.hypot(thighBefore.x, thighBefore.y), 1e-9), 'bone length is unchanged');
  assert(near(strong.ankle.z, leg.ankle.z) && near(strong.knee.z, leg.knee.z), 'depth (x-rotation) is untouched');
  const calfAfter = { x: strong.ankle.x - strong.knee.x, y: strong.ankle.y - strong.knee.y };
  assert(near(angle(calfAfter), 3 * angle({ x: leg.ankle.x - leg.knee.x, y: leg.ankle.y - leg.knee.y }), 1e-9), 'the calf is amplified by its own angle');
  const hanging = Core.amplifyLegRoll(mk([0, 0, 0], [0, -0.2, 0], [0, -0.4, 0]), 5, blank());
  assert(near(hanging.ankle.x, 0) && near(hanging.ankle.y, -0.4), 'a leg hanging straight down is not moved by any gain');
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
  assert(belt.length === 5 && belt.every(p => p.y >= 0.69 && p.y <= 0.7 + 1e-9), 'default belt sits at the posterior height');
  assert(Core.defaultBeltAtPosterior(1.4).every(p => p.y <= 1), 'a posterior below the image rests on the image edge');
  assert(Core.defaultBeltAtPosterior(NaN).every(p => Number.isFinite(p.y)), 'a missing posterior still yields a belt');
}

console.log('Pants rig bone skinning: PASS');
