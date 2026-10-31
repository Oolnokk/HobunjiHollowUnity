'use strict';
// Static hunchback ("spine"): one 0-1 hunch value (enemy-loadouts.json rule `spine`, or an NPC's authored
// appearance.aging.hunch) becomes a neck drop, shoulder drop, attack-orbit drop and a wider stance/stride.
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

  // Profile: scales linearly with hunch. The spine bone's shoulder drop plus the head bone's extra drop equal the rig-scale
  // age hunch, so an aged NPC's head ends up exactly where it did before the spine existed.
  const full = spine.profileFor(1), half = spine.profileFor(0.5), upright = spine.profileFor(0);
  near(full.shoulderDrop + full.neckDrop, -rigScale.ageHunchFraction(1), 'spine + head bone equal the rig-scale age hunch');
  near(full.totalNeckDrop, -rigScale.ageHunchFraction(1), 'total neck drop equals the rig-scale age hunch');
  near(half.shoulderDrop, full.shoulderDrop / 2, 'shoulder drop is linear');
  near(full.shoulderDrop, full.totalNeckDrop * spine.shoulderDropRatio, 'shoulders carry their share of the head drop');
  assert.ok(full.shoulderDrop > 0 && full.neckDrop > 0, 'both the spine and the head bone contribute');
  near(full.orbitDrop, full.shoulderDrop, 'the attack orbit moves precisely with the shoulders');
  near(full.stanceScale, 1 + spine.stanceWiden, 'stance widens at full hunch');
  near(full.strideScale, 1 + spine.strideWiden, 'stride lengthens at full hunch');
  assert.deepEqual([upright.neckDrop, upright.shoulderDrop, upright.orbitDrop, upright.stanceScale, upright.strideScale], [0, 0, 0, 1, 1], 'upright characters are untouched');
  near(spine.profileFor(7).hunch, 1, 'hunch clamps to 1');

  // Skin weight: nothing below the waist moves, everything from just under the shoulders up rides the spine, monotonic between.
  const H = 0.9, neckY = 0.2;
  near(spine.weightAt(neckY - 0.5 * H, neckY, H), 0, 'legs/hips are not weighted to the spine');
  near(spine.weightAt(neckY - 0.21 * H, neckY, H), 1, 'everything from mid-torso up rides the spine');
  near(spine.weightAt(neckY - 0.04 * H, neckY, H), 1, 'the shoulder line is fully weighted');
  near(spine.weightAt(neckY + 0.3 * H, neckY, H), 1, 'the head region is fully weighted');
  let last = -1;
  for (let y = neckY - 0.4 * H; y <= neckY + 0.1 * H; y += 0.01) {
    const w = spine.weightAt(y, neckY, H);
    assert.ok(w >= last - 1e-12 && w >= 0 && w <= 1, 'weight rises smoothly from 0 to 1');
    last = w;
  }
  // Bind-pose layout: the torso bone covers only the lower half of the waist-to-neck span, the spine bone takes the freed upper half,
  // and the chain still ends exactly on the plane-space neck pivot, so the skin weights (plane coordinates) are unaffected.
  const layout = spine.layoutFor(0.05, neckY, H);
  const span = layout.spine.y + layout.neck.y;
  near(span, 0.42 * H, 'the chain covers the whole waist-to-neck stretch');
  near(layout.spine.y, 0.25 * span, 'the bend sits low: the torso bone is only the lower quarter');
  near(layout.neck.y, 0.75 * span, 'the spine bone takes the freed length up to the neck');
  assert.ok(layout.spine.y < span / 2, 'the bend is well below the midpoint');
  near(layout.torso.y + layout.spine.y + layout.neck.y, neckY, 'the chain ends exactly at the neck pivot');
  near(layout.torso.x + layout.spine.x + layout.neck.x, 0.05, 'and at the neck pivot X');
  // With an authored posterior the torso bone starts exactly there and the bend lies strictly between the posterior and the neck.
  const posterior = neckY - 0.3 * H;
  const anchored = spine.layoutFor(0.05, neckY, H, posterior);
  near(anchored.torso.y, posterior, 'the torso bone starts at the posterior');
  const bendY = anchored.torso.y + anchored.spine.y;
  assert.ok(bendY > posterior && bendY < neckY, 'the bend is between the posterior and the neck');
  near(anchored.torso.y + anchored.spine.y + anchored.neck.y, neckY, 'the anchored chain still ends at the neck pivot');
  near(spine.weightAt(posterior, neckY, H, posterior), 0, 'nothing at the posterior moves');
  near(spine.weightAt(posterior + 0.5 * (neckY - posterior), neckY, H, posterior), 1, 'halfway from the posterior to the neck rides the spine');
  near(spine.weightAt(-H / 2, neckY, H, -H), 0, 'a posterior below the painted art never moves the art\'s bottom edge');
  assert.equal(spine.layoutFor(0, neckY, H, neckY + 1).torso.y, neckY - 0.42 * H, 'an implausible posterior falls back to the neck-relative estimate');
  // Plane-space posterior, resolved like the legs' hip: authored percent-of-height-from-floor (mao-ao male is 25%), shifted into the plane's
  // frame (floor = modelHeight/2 + assemblyY + planeY), else the hand-anchor fallback for species without a rule (e.g. the skeletons).
  near(spine.posteriorLocalY({ speciesId: 'mao-ao', gender: 'male', modelHeight: 1, placementRatio: 0.5 }), 0.25 - 0.5, 'authored posterior in plane space');
  near(spine.posteriorLocalY({ speciesId: 'mao-ao', gender: 'male', modelHeight: 1, placementRatio: 0.6 }), 0.25 - 0.5 - 0.1, 'shifted by the portrait vertical placement');
  near(spine.posteriorLocalY({ speciesId: 'mao-ao-skeleton', gender: 'male', modelHeight: 1, placementRatio: 0.5, handAttachY: 0.6 }), 0.6 - 0.18 - 0.5, 'no rule: 18% below the hand anchor, like the legs');
  near(spine.posteriorLocalY({ speciesId: 'mao-ao-skeleton', gender: 'male', modelHeight: 1 }), 0.5 - 0.18 - 0.5, 'no rule and no hand anchor: 18% below the plane middle');
  const spineRest = { position: { y: layout.spine.y }, updateMatrix() {}, userData: {} };
  spine.applyToRig({ spineJoint: spineRest, neckLocal: { y: neckY } }, spine.profileFor(1), H);
  near(spineRest.position.y, layout.spine.y - spine.profileFor(1).shoulderDrop * H, 'a hunch lowers the spine bone from its bind-pose offset');
  spine.applyToRig({ spineJoint: spineRest, neckLocal: { y: neckY } }, spine.profileFor(0.5), H);
  near(spineRest.position.y, layout.spine.y - spine.profileFor(0.5).shoulderDrop * H, 'reapplying is relative to the bind pose, never cumulative');

  // Deformation: anchors keep their 2D coordinates and are carried down by the follow at their own height.
  const stooped = spine.profileFor(1);
  const rig = { spineJoint: { position: { y: 0 }, updateMatrix() {} }, neckLocal: { y: neckY } };
  assert.ok(spine.applyToRig(rig, stooped, H));
  near(rig.spineJoint.position.y, -stooped.shoulderDrop * H, 'the spine bone is lowered by the shoulder drop');
  near(spine.deformDrop(stooped, neckY + 0.3 * H), stooped.shoulderDrop * H, 'the head region drops by the full spine drop');
  near(spine.deformDrop(stooped, neckY - 0.5 * H), 0, 'the hips stay put');
  const shoulderDrop = spine.deformDrop(stooped, neckY - 0.06 * H);
  assert.ok(shoulderDrop > 0.8 * stooped.shoulderDrop * H && shoulderDrop <= stooped.shoulderDrop * H + 1e-12, 'shoulders drop nearly the full amount');
  near(spine.deformDrop(spine.profileFor(0), neckY), 0, 'an upright profile deforms nothing');
  const pair = { spineJoint: { front: { position: { y: 0 } }, back: { position: { y: 0 } } }, neckLocal: { y: neckY } };
  spine.applyToRig(pair, spine.profileFor(0.5), H);
  near(pair.spineJoint.back.position.y, pair.spineJoint.front.position.y, 'front and rear skins stoop together');

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

  // Orbit centre: transformPosePoint lowers the whole orbit by orbitDropY; untransform is its exact inverse.
  const pose = window.HobunjiSpeciesPoseScale;
  const options = extra => ({ cx: 0.1, cz: -0.2, floorY: 0, baseY: 0.4, speciesId: 'mao-ao', gender: 'male', modelHeight: 0.9, rigScaleY: 1.2, armLength: 99, poseOrbitScale: { x: 0.8, y: 0.9, z: 0.7 }, ...extra });
  const raw = { x: 0.6, y: 0.7, z: -0.5 };
  const upright1 = pose.transformPosePoint({ ...raw }, options());
  const drop = spine.orbitDropWorld(full, 0.9, 1.2);
  assert.ok(drop > 0);
  const hunched = pose.transformPosePoint({ ...raw }, options({ orbitDropY: drop }));
  near(upright1.y - hunched.y, drop, 'orbit sits exactly orbitDropY lower');
  near(upright1.x, hunched.x, 'X unaffected');
  near(upright1.z, hunched.z, 'Z unaffected');
  const back = pose.untransformPosePoint({ ...hunched }, options({ orbitDropY: drop }));
  for (const axis of ['x', 'y', 'z']) near(back[axis], raw[axis], `untransform round-trips ${axis}`);
  const noDrop = pose.transformPosePoint({ ...raw }, options({ orbitDropY: -5 }));
  near(noDrop.y, upright1.y, 'a negative drop is ignored');

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
  assert.throws(() => rules.validate(doc([0.5])), /spine/);

  console.log('character spine OK');
})().catch(error => { console.error(error); process.exit(1); });
