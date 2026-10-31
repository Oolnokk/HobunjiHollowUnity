'use strict';
// Static hunchback ("spine"): one 0-1 hunch value (enemy-loadouts.json rule `spine`, or an NPC's authored
// appearance.aging.hunch) becomes a 7-node spline from the posterior to the neck that curls the portrait, carries the shoulders and attack
// orbit centre off the local root, and widens the stance/stride.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = p => fs.readFileSync(p, 'utf8');
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

(async () => {
  const window = { location: { pathname: '/game/' }, setInterval(fn) { fn(); return 1; }, clearInterval() {}, console, URL };
  window.window = window;
  const sandbox = vm.createContext(window); // The global object IS window, as in a browser (the modules read bare `location`).
  for (const file of ['docs/config/attachment-rig-profiles.js', 'docs/config/character-rig-scale-defaults.js', 'docs/js/character-rig-scale.js', 'docs/js/character-spine.js', 'docs/js/species-pose-scaling.js']) {
    vm.runInContext(read(file), sandbox, { filename: file });
  }
  const spine = window.HobunjiCharacterSpine;
  const rigScale = window.HobunjiCharacterRigScale;

  // Profile: scales linearly with hunch. The spline's vertical drop plus the head bone's extra drop equal the rig-scale age hunch, so an
  // aged NPC's head ends up exactly where it did before the spine existed.
  const full = spine.profileFor(1), half = spine.profileFor(0.5), upright = spine.profileFor(0);
  near(full.shoulderDrop + full.neckDrop, -rigScale.ageHunchFraction(1), 'spline + head bone equal the rig-scale age hunch');
  near(full.totalNeckDrop, -rigScale.ageHunchFraction(1), 'total neck drop equals the rig-scale age hunch');
  near(half.shoulderDrop, full.shoulderDrop / 2, 'shoulder drop is linear');
  near(full.shoulderDrop, full.totalNeckDrop * spine.shoulderDropRatio, 'the spline carries its share of the head drop');
  assert.ok(full.shoulderDrop > 0 && full.neckDrop > 0, 'both the spline and the head bone contribute');
  near(full.stanceScale, 1 + spine.stanceWiden, 'stance widens at full hunch');
  near(full.strideScale, 1 + spine.strideWiden, 'stride lengthens at full hunch');
  assert.deepEqual([upright.neckDrop, upright.shoulderDrop, upright.sway, upright.stanceScale, upright.strideScale], [0, 0, 0, 1, 1], 'upright characters are untouched');
  near(spine.profileFor(7).hunch, 1, 'hunch clamps to 1');
  near(spine.profileFor(1, 9).sway, 1, 'sway clamps to 1');
  near(spine.swayFor({ spine: { hunch: 0.5, sway: -0.4 } }), -0.4, 'sway is read from an authored spine');
  assert.equal(spine.swayFor({ spine: 0.5 }), 0, 'and defaults to none');
  assert.equal(spine.splineNodes, 7, 'seven spline nodes');

  // Layout: 7 nodes evenly spaced from the posterior (pinned to the local root, x = 0 and z = 0) to the neck pivot, chained by offset.
  const H = 0.9, neckY = 0.2, neckX = 0.05, posterior = neckY - 0.5 * H; // A realistic posterior-to-neck span: the shipped skeleton's is half its height.
  const layout = spine.layoutFor(neckX, neckY, H, posterior);
  assert.equal(layout.nodes.length, 7);
  assert.deepEqual([layout.nodes[0].x, layout.nodes[0].z], [0, 0], 'the posterior sits on the root in x and z');
  near(layout.nodes[0].y, posterior, 'the spline starts at the posterior');
  near(layout.nodes[6].x, neckX, 'and ends at the neck pivot X');
  near(layout.nodes[6].y, neckY, 'and Y');
  for (let k = 1; k < 7; k++) {
    near(layout.nodes[k].y - layout.nodes[k - 1].y, (neckY - posterior) / 6, 'evenly spaced');
    near(layout.nodes[k - 1].x + layout.offsets[k].x, layout.nodes[k].x, 'offsets chain to the nodes (x)');
    near(layout.nodes[k - 1].y + layout.offsets[k].y, layout.nodes[k].y, 'offsets chain to the nodes (y)');
  }
  near(layout.neck.x + layout.neck.y + layout.neck.z, 0, 'the head-turn bone sits right on the last node');
  assert.equal(spine.layoutFor(0, neckY, H, neckY + 1).nodes[0].y, neckY - 0.42 * H, 'an implausible posterior falls back to the neck-relative estimate');
  assert.equal(spine.layoutFor(0, neckY, H).nodes[0].y, neckY - 0.42 * H, 'and so does a missing one');

  // Skin weights: the two neighbouring nodes by height; below the posterior rides node 0, above the neck rides the last node.
  const w = {};
  let at = spine.nodeWeightsAt(posterior - 1, neckY, H, posterior, w);
  assert.deepEqual([at.a, at.b, at.wb], [0, 1, 0], 'below the posterior everything rides node 0');
  at = spine.nodeWeightsAt(neckY + 1, neckY, H, posterior, w);
  assert.deepEqual([at.a, at.b, at.wb], [5, 6, 1], 'above the neck everything rides the last node');
  for (let k = 0; k < 6; k++) {
    const y = posterior + (neckY - posterior) * (k + 0.5) / 6;
    at = spine.nodeWeightsAt(y, neckY, H, posterior, w);
    assert.equal(at.a, k); assert.equal(at.b, k + 1); near(at.wb, 0.5, 'halfway between two nodes shares them equally');
  }
  let lastBlend = -1;
  for (let y = posterior; y <= neckY; y += 0.002) {
    at = spine.nodeWeightsAt(y, neckY, H, posterior, w);
    const blend = at.a + at.wb;
    assert.ok(blend >= lastBlend - 1e-12, 'the blended node position rises monotonically with height');
    lastBlend = blend;
  }

  // Plane-space posterior, resolved like the legs' hip: authored percent-of-height-from-floor (mao-ao male is 25%), shifted into the plane's
  // frame (floor = modelHeight/2 + assemblyY + planeY), else the hand-anchor fallback for species without a rule (e.g. the skeletons).
  near(spine.posteriorLocalY({ speciesId: 'mao-ao', gender: 'male', modelHeight: 1, placementRatio: 0.5 }), 0.25 - 0.5, 'authored posterior in plane space');
  near(spine.posteriorLocalY({ speciesId: 'mao-ao', gender: 'male', modelHeight: 1, placementRatio: 0.6 }), 0.25 - 0.5 - 0.1, 'shifted by the portrait vertical placement');
  near(spine.posteriorLocalY({ speciesId: 'mao-ao-skeleton', gender: 'male', modelHeight: 1, placementRatio: 0.5, handAttachY: 0.6 }), 0.6 - 0.18 - 0.5, 'no rule: 18% below the hand anchor, like the legs');
  near(spine.posteriorLocalY({ speciesId: 'mao-ao-skeleton', gender: 'male', modelHeight: 1 }), 0.5 - 0.18 - 0.5, 'no rule and no hand anchor: 18% below the plane middle');

  // The curl: node 0 is pinned to the root; the neck node drops by exactly the profile's drop; the spline sweeps forward (+z) and, with a sway,
  // sideways, off the root; segment lengths are preserved; the cumulative pitch eases out so the curvature sits low in the back.
  const lengthOf = (nodes, k) => Math.hypot(nodes[k].x - nodes[k - 1].x, nodes[k].y - nodes[k - 1].y);
  const stooped = spine.profileFor(1);
  const curve = spine.solveCurve(stooped, layout, H);
  assert.deepEqual([curve[0].x, curve[0].y, curve[0].z], [0, 0, 0], 'the posterior never leaves the root');
  near(curve[6].y, -stooped.shoulderDrop * H, 'the neck node drops by exactly the profile drop');
  assert.ok(curve[6].z > 0, 'the neck swings forward');
  assert.ok(curve.every(node => Math.abs(node.x) < 1e-12), 'no sway, no sideways travel');
  let previousPitch = Infinity, previousDrop = 0, previousZ = 0;
  for (let k = 1; k < 7; k++) {
    const dx = layout.offsets[k].x + curve[k].x - curve[k - 1].x, dy = layout.offsets[k].y + curve[k].y - curve[k - 1].y, dz = (curve[k].z - curve[k - 1].z) / spine.depthScale;
    near(Math.hypot(dx, dy, dz), lengthOf(layout.nodes, k), 'each segment keeps its length');
    const pitch = Math.atan2(dz, dy);
    assert.ok(pitch > 0 && pitch >= (k > 1 ? 0 : 0), 'every segment is pitched forward');
    assert.ok(curve[k].y <= previousDrop + 1e-12 && curve[k].z >= previousZ - 1e-12, 'the nodes sweep down and forward');
    previousDrop = curve[k].y; previousZ = curve[k].z;
  }
  const cumulative = [];
  for (let k = 1; k < 7; k++) cumulative.push(Math.atan2((curve[k].z - curve[k - 1].z) / spine.depthScale, layout.offsets[k].y + curve[k].y - curve[k - 1].y));
  for (let k = 1; k < cumulative.length; k++) assert.ok(cumulative[k] >= cumulative[k - 1], 'pitch accumulates up the spline');
  for (let k = 2; k < cumulative.length; k++) assert.ok(cumulative[k] - cumulative[k - 1] <= cumulative[k - 1] - cumulative[k - 2] + 1e-12, 'with the curvature easing out (low in the back)');
  const swayed = spine.solveCurve(spine.profileFor(1, 0.6), layout, H);
  assert.ok(swayed[6].x > 0 && swayed[3].x > 0 && swayed[6].x > swayed[3].x, 'a sway carries the spline sideways, off the root');
  near(swayed[6].y, -stooped.shoulderDrop * H, 'with the same vertical drop');
  assert.ok(spine.solveCurve(spine.profileFor(1, -0.6), layout, H)[6].x < 0, 'a negative sway goes the other way');
  assert.ok(spine.solveCurve(upright, layout, H).every(node => node.x === 0 && node.y === 0 && node.z === 0), 'an upright character does not move at all');
  const capped = spine.solveCurve({ ...stooped, shoulderDrop: 5 }, layout, H);
  assert.ok(capped[6].y > -5 * H && capped[6].y < 0, 'an impossible drop is capped by the maximum curl');

  // Applying it to a rig: each node bone moves by its step along the curve from its bind-pose offset (never accumulating); the rear skin is the
  // same card turned around, so its x and z run the other way.
  const fakeBones = () => layout.offsets.map((offset, k) => ({
    userData: {}, updateMatrix() {},
    position: { x: k === 0 ? layout.nodes[0].x : offset.x, y: k === 0 ? layout.nodes[0].y : offset.y, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
  }));
  const chain = bones => { const points = [{ ...bones[0].position }]; for (let k = 1; k < 7; k++) points.push({ x: points[k - 1].x + bones[k].position.x, y: points[k - 1].y + bones[k].position.y, z: points[k - 1].z + bones[k].position.z }); return points; };
  const front = fakeBones(), rear = fakeBones();
  const profile = spine.profileFor(1, 0.3);
  assert.ok(spine.applyToRig({ splineNodes: { front, back: rear }, neckLocal: { x: neckX, y: neckY }, spinePosteriorY: posterior }, profile, H));
  const frontPoints = chain(front), rearPoints = chain(rear);
  const solved = spine.solveCurve(profile, layout, H);
  for (let k = 0; k < 7; k++) {
    near(frontPoints[k].x, layout.nodes[k].x + solved[k].x, 'front nodes follow the curve (x)');
    near(frontPoints[k].y, layout.nodes[k].y + solved[k].y, 'front nodes follow the curve (y)');
    near(frontPoints[k].z, solved[k].z, 'front nodes follow the curve (z)');
    near(rearPoints[k].y, frontPoints[k].y, 'the rear skin drops the same');
    near(rearPoints[k].z, -frontPoints[k].z, 'but its z runs the other way');
    near(rearPoints[k].x - layout.nodes[k].x, -(frontPoints[k].x - layout.nodes[k].x), 'and so does its sideways travel');
  }
  assert.deepEqual([front[0].position.x, front[0].position.y, front[0].position.z], [0, posterior, 0], 'the posterior node never moves off the root');
  spine.applyToRig({ splineNodes: front, neckLocal: { x: neckX, y: neckY }, spinePosteriorY: posterior }, spine.profileFor(0.5), H);
  near(chain(front)[6].y, layout.nodes[6].y + spine.solveCurve(spine.profileFor(0.5), layout, H)[6].y, 'reapplying is relative to the bind pose, never cumulative');

  // Point deformation: anchors keep their 2D coordinates and ride the same curve at their own height.
  const bound = spine.profileFor(1, 0.3);
  spine.applyToRig({ splineNodes: fakeBones(), neckLocal: { x: neckX, y: neckY }, spinePosteriorY: posterior }, bound, H);
  const head = spine.deformAt(bound, neckY + 0.3 * H, {});
  near(head.y, bound.curve[6].y, 'the head region rides the neck node (y)');
  near(head.z, bound.curve[6].z, 'and (z)');
  near(head.x, bound.curve[6].x, 'and (x)');
  const hips = spine.deformAt(bound, posterior - 0.1, {});
  assert.deepEqual([hips.x, hips.y, hips.z], [0, 0, 0], 'below the posterior nothing moves');
  const shoulders = spine.deformAt(bound, neckY - 0.08 * H, {});
  assert.ok(shoulders.y < 0 && shoulders.z > 0 && shoulders.x > 0, 'the shoulders are carried down, forward and sideways, off the local root');
  assert.ok(Math.abs(shoulders.y) <= Math.abs(head.y) + 1e-9, 'by no more than the neck');
  const none = spine.deformAt(spine.profileFor(0), neckY, {});
  assert.deepEqual([none.x, none.y, none.z], [0, 0, 0], 'an upright profile deforms nothing');
  near(bound.orbitOffset.y, shoulders.y, 'the orbit centre moves precisely with the shoulders (y)');
  near(bound.orbitOffset.z, shoulders.z, 'and (z)');
  near(bound.orbitOffset.x, shoulders.x, 'and (x)');
  assert.equal(spine.orbitOffsetWorld(upright, 1, 1), null, 'no hunch, no orbit offset');
  const worldOffset = spine.orbitOffsetWorld(bound, 2, 3);
  near(worldOffset.x, bound.orbitOffset.x * 2, 'the world orbit offset follows the width scale (x)');
  near(worldOffset.y, bound.orbitOffset.y * 3, 'the height scale (y)');
  near(worldOffset.z, bound.orbitOffset.z * 2, 'and depth tracks width (z)');

  // Sources: an explicit spine wins; otherwise the NPC database's appearance.aging.hunch (what 4 shipped elders author).
  near(spine.hunchFor({ spine: { hunch: 0.4 }, profile: { aging: { hunch: 0.9 } } }), 0.4, 'explicit spine wins over aging');
  near(spine.hunchFor({ spine: 0.25 }), 0.25, 'a bare number is accepted');
  near(spine.hunchFor({ profile: { aging: { hunch: 0.3 } } }), 0.3, 'NPC profile aging.hunch');
  near(spine.hunchFor({ npcRecord: { appearance: { aging: { hunch: 0.13 } } } }), 0.13, 'NPC record aging.hunch');
  assert.equal(spine.hunchFor({}), 0);
  assert.equal(spine.hunchFor(null), 0);
  const npcDb = JSON.parse(read('docs/config/npcs/hobunji-starter-npc-database.json'));
  const aged = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.aging && Number(node.aging.hunch) > 0) aged.push(node.aging.hunch);
    for (const value of Object.values(node)) walk(value);
  })(npcDb);
  assert.ok(aged.length >= 4, 'the NPC database authors hunch for its elders');
  for (const hunch of aged) assert.ok(spine.profileFor(spine.hunchFor({ npcRecord: { appearance: { aging: { hunch } } } })).shoulderDrop > 0, 'every authored NPC hunch lowers the shoulders');

  // bind/fromRoot: the avatar root carries the profile for the layers that read it live.
  const root = { userData: {}, parent: null };
  const child = { userData: {}, parent: root };
  assert.ok(spine.bind(root, { spine: { hunch: 0.6 } }).hunch > 0);
  near(spine.fromRoot(child).hunch, 0.6, 'children find the root spine');
  spine.bind(root, {});
  assert.equal(spine.fromRoot(child), null, 'rebinding upright clears it');

  // Orbit centre: transformPosePoint moves the whole orbit by orbitOffset (in the pose frame, turned by its facing); untransform is its exact inverse.
  const pose = window.HobunjiSpeciesPoseScale;
  const options = extra => ({ cx: 0.1, cz: -0.2, floorY: 0, baseY: 0.4, speciesId: 'mao-ao', gender: 'male', modelHeight: 0.9, rigScaleY: 1.2, armLength: 99, poseOrbitScale: { x: 0.8, y: 0.9, z: 0.7 }, ...extra });
  const raw = { x: 0.6, y: 0.7, z: -0.5 };
  const upright1 = pose.transformPosePoint({ ...raw }, options());
  const offset = { x: 0.03, y: -0.15, z: 0.12 };
  const moved = pose.transformPosePoint({ ...raw }, options({ orbitOffset: offset }));
  near(moved.y - upright1.y, offset.y, 'the orbit sits exactly orbitOffset.y lower');
  near(moved.x - upright1.x, offset.x, 'and sideways by orbitOffset.x');
  near(moved.z - upright1.z, offset.z, 'and forward by orbitOffset.z');
  const back = pose.untransformPosePoint({ ...moved }, options({ orbitOffset: offset }));
  for (const axis of ['x', 'y', 'z']) near(back[axis], raw[axis], `untransform round-trips ${axis}`);
  const turned = pose.transformPosePoint({ ...raw }, options({ orbitOffset: { x: 0, y: 0, z: 1 }, yawRad: Math.PI / 2 }));
  const turnedUpright = pose.transformPosePoint({ ...raw }, options({ yawRad: Math.PI / 2 }));
  near(turned.x - turnedUpright.x, 1, 'forward follows the pose frame: a quarter turn points it along world X');
  near(turned.z - turnedUpright.z, 0, 'and not along Z');
  const backTurned = pose.untransformPosePoint({ ...turned }, options({ orbitOffset: { x: 0, y: 0, z: 1 }, yawRad: Math.PI / 2 }));
  for (const axis of ['x', 'y', 'z']) near(backTurned[axis], raw[axis], `turned untransform round-trips ${axis}`);
  const ignored = pose.transformPosePoint({ ...raw }, options({ orbitOffset: { x: NaN, y: 1, z: 1 } }));
  near(ignored.y, upright1.y, 'a malformed offset is ignored');

  // Loadout rules: the shipped config hunches skeletons and Maskbound; the schema validates the value.
  const rulesWindow = {};
  vm.runInNewContext(read('docs/js/combat/enemy-loadout-rules.js'), {
    window: rulesWindow,
    document: { currentScript: { src: 'https://game.test/docs/js/combat/enemy-loadout-rules.js' }, baseURI: 'https://game.test/docs/' },
    URL,
    fetch: async () => ({ ok: true, json: async () => JSON.parse(read('docs/config/combat/enemy-loadouts.json')) }),
    console,
  });
  const rules = rulesWindow.EnemyLoadoutRules;
  await rules.ready;
  for (const kind of ['mao-ao-skeleton', 'harlyao-skeleton', 'maskbound:sentinel', 'maskbound:bulwark', 'maskbound:reacher']) {
    const authored = rules.spineFor(kind);
    assert.ok(authored && authored.hunch > 0 && authored.hunch <= 1, `${kind} is hunched in the shipped loadouts`);
  }
  assert.equal(rules.spineFor('bandit:captain'), null, 'unconfigured kinds stay upright');
  assert.equal(rules.spineFor('ghost-marcher'), null);
  const doc = hunch => ({ schema: 'hobunji_enemy_loadouts.v1', rules: { 'mao-ao-skeleton': { spine: hunch } } });
  assert.doesNotThrow(() => rules.validate(doc({ hunch: 0.5 })));
  assert.throws(() => rules.validate(doc({ hunch: 1.5 })), /spine\.hunch/);
  assert.throws(() => rules.validate(doc({ hunch: -0.1 })), /spine\.hunch/);
  assert.throws(() => rules.validate(doc({ hunch: '0.5' })), /spine\.hunch/);
  assert.throws(() => rules.validate(doc({ lean: 0.5 })), /unknown field/);
  assert.doesNotThrow(() => rules.validate(doc({ hunch: 0.5, sway: -0.5 })), 'a sway rolls the curl sideways');
  assert.throws(() => rules.validate(doc({ hunch: 0.5, sway: 1.5 })), /spine\.sway/);
  assert.throws(() => rules.validate(doc([0.5])), /spine/);

  console.log('character spine OK');
})().catch(error => { console.error(error); process.exit(1); });
