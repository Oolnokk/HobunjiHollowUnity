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
  for (const file of ['docs/config/character-rig-scale-defaults.js', 'docs/js/character-rig-scale.js', 'docs/js/character-spine.js', 'docs/js/species-pose-scaling.js']) {
    vm.runInContext(read(file), sandbox, { filename: file });
  }
  const spine = window.HobunjiCharacterSpine;
  const rigScale = window.HobunjiCharacterRigScale;

  // Profile: scales linearly with hunch; the neck drop IS the rig-scale age hunch so aged NPCs keep their head position.
  const full = spine.profileFor(1), half = spine.profileFor(0.5), upright = spine.profileFor(0);
  near(full.neckDrop, -rigScale.ageHunchFraction(1), 'neck drop equals the rig-scale age hunch');
  near(half.neckDrop, full.neckDrop / 2, 'neck drop is linear');
  near(full.shoulderDrop, full.neckDrop * spine.shoulderDropRatio, 'shoulders sink by a share of the neck drop');
  assert.ok(full.shoulderDrop < full.neckDrop && full.orbitDrop > 0, 'shoulders sink less than the head; orbit follows them');
  near(full.stanceScale, 1 + spine.stanceWiden, 'stance widens at full hunch');
  near(full.strideScale, 1 + spine.strideWiden, 'stride lengthens at full hunch');
  assert.deepEqual([upright.neckDrop, upright.shoulderDrop, upright.orbitDrop, upright.stanceScale, upright.strideScale], [0, 0, 0, 1, 1], 'upright characters are untouched');
  near(spine.profileFor(7).hunch, 1, 'hunch clamps to 1');

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
