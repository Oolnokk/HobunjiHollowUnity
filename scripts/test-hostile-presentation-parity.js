'use strict';
// Hostile presentation parity with the player/editor: weapon size follows the real body height, free hands rest on the
// lateral axis, the head stays forward independent of body yaw, GLB feet load wherever an import map exists, masks draw
// over hoods, and Workshop-authored body proportions flow through the spawn rules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = p => fs.readFileSync(p, 'utf8');
const near = (a, b, label, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${label}: ${a} vs ${b}`);

// 1. Weapon height factor: the measured species height is rescaled by the body height actually rendered.
{
  const grips = read('docs/js/hand-tool-grips.js');
  assert.match(grips, /function characterHeightRatio\(speciesId, gender, rigScaleY = null\)/, 'height ratio accepts the rendered rig height');
  assert.match(grips, /currentHeight \*= actualRigY \/ defaultRigY/, 'measured height is rescaled by actual/default rig Y');
  assert.match(grips, /heightFactorForTool\(value, identity\?\.speciesId, identity\?\.gender, identity\?\.rigScaleY\)/, 'placement forwards the rig height');
  const bandit = read('docs/js/combat/combat-bandit.js');
  assert.match(bandit, /heldItemPlacementForTool\?\.\(weaponKey, gripContext, \{ speciesId, gender, rigScaleY \}\)/, 'hostile weapon sizing passes its rig height');
  assert.match(bandit, /proceduralHandRigScaleY = Number\(avatarRef\.rigScale\?\.y\)/, 'hand grip targets use the same height as the visual');
  assert.match(read('docs/js/procedural-hand-frame-driver.js'), /rigScaleY: Number\(record\.avatarRoot\?\.userData\?\.proceduralHandRigScaleY\)/, 'hand driver forwards it');
  // Behaviour: same species, taller troop => larger ratio.
  const ctx = { window: {} };
  ctx.window = ctx;
  const start = grips.indexOf('function characterHeightRatio(');
  const end = grips.indexOf('// False until HobunjiCharacterDimensions');
  const fn = vm.runInNewContext(`(global) => { const HEIGHT_REFERENCE_SPECIES = 'mao-ao', HEIGHT_REFERENCE_GENDER = 'male'; ${grips.slice(start, end)}; return characterHeightRatio; }`, ctx)({
    HobunjiCharacterDimensions: { dimensionsFor: (s) => ({ height: s === 'mao-ao' ? 1.0 : 0.9 }) },
    HobunjiCharacterRigScale: { scaleFor: () => ({ y: 1 }) },
  });
  near(fn('maskbound-guardian', 'male'), 0.9, 'species default ratio');
  near(fn('maskbound-guardian', 'male', 1.82), 0.9 * 1.82, 'tall troop ratio');
  assert.ok(fn('maskbound-guardian', 'male', 1.02) < fn('maskbound-guardian', 'male', 1.82), 'troops no longer share one ratio');
}

// 2. Free hands: the hands frame is turned like the legs' frame and kept in sync with the planes.
{
  const bandit = read('docs/js/combat/combat-bandit.js');
  assert.match(bandit, /handsPivot\.rotation\.y = Math\.PI \/ 2;/, 'hands pivot starts in the legs-frame orientation');
  assert.match(bandit, /syncHandFrame\(\) \{ handsPivot\.rotation\.y = \(legsPivot\.rotation\.y \|\| 0\) \+ Math\.PI \/ 2; \}/, 'hand frame helper mirrors legsPivot');
  assert.match(read('docs/game.js'), /legsPivot\.rotation\.y = planeDelta; c\.avatarRef\.syncHandFrame\?\.\(\)/, 'game keeps hands in sync each frame');
  assert.equal((read('docs/js/creature-death.js').match(/syncHandFrame\?\.\(\)/g) || []).length, 3, 'death resets keep hands in sync');
}

// 3. GLB feet resolve their loader from the import map like the hand attachments do.
assert.match(read('docs/js/procedural-leg-animation.js'), /import\('three\/addons\/loaders\/GLTFLoader\.js'\)/, 'leg rig falls back to the page import map');
assert.match(read('docs/tools/enemy-loadout-editor/preview.js'), /js\/procedural-leg-animation\.js/, 'workshop loads the leg rig');

// 4. Head stays forward independent of body yaw.
{
  const bandit = read('docs/js/combat/combat-bandit.js');
  assert.match(bandit, /c\._banditBodyYawRad = bodyYawRad;/, 'sampled body yaw is recorded');
  assert.match(bandit, /const counterYawRad = -\(Number\(c\._banditBodyYawRad\) \|\| 0\);/, 'neck counter-turns the body yaw');
  assert.match(bandit, /neck\.front\.rotation\.y = state\.currentDeg \* BANDIT_NECK_LOOK_RAD \+ counterYawRad;/, 'front neck uses it');
  assert.match(read('docs/tools/enemy-loadout-editor/preview.js'), /restNeckLook\(c, dt\)/, 'workshop runs the idle neck update');
}

// 6. Mask over hood in the front portrait.
{
  const portrait = read('docs/js/portrait-utils.js');
  const front = portrait.indexOf('  drawBreathingLayers(hoodLayers);\n  drawEmoteLayers(maskLayers);');
  assert.ok(front > 0, 'front portrait draws the hood first and the mask on top');
  assert.equal(portrait.indexOf('  drawEmoteLayers(maskLayers);\n  drawBreathingLayers(hoodLayers);'), -1, 'no mask-under-hood order remains');
}

// 7. A lowered (hunched) head must not fold the skin under the chin: the head-scale fade band below the skull has to be
// taller than the head's Head Y offset (Mashtzarr -9.5%, Maskbound troops up to -12%).
{
  const src = read('docs/js/png-plane-avatar.js');
  const grab = name => { const i = src.indexOf('function ' + name + '('); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } };
  const weight = vm.runInNewContext(`${grab('smoothstep01')}\n${grab('headScaleGateAtPixel')}\n${grab('headScaleWeightAt')}\nheadScaleWeightAt`);
  const H = 0.72, neckY = 0.1, bounds = { left: 100, right: 150 };
  const at = below => weight(neckY - below * H, neckY, H, 125, bounds, 1);
  assert.equal(at(0), 1, 'the skull itself is fully head-weighted');
  assert.ok(at(0.12) > 0, 'the fade band still reaches a 12% hunch (it used to end at 8%, folding the mesh)');
  const bandBottom = [...Array(60).keys()].map(i => i / 200).find(b => at(b) === 0);
  assert.ok(bandBottom >= 0.17, 'fade band is at least 17% of the model height tall, got ' + bandBottom);
  let previous = 1;
  for (let b = 0; b <= 0.3; b += 0.01) { const w = at(b); assert.ok(w <= previous + 1e-12, 'weight never increases going down'); previous = w; }
}

// 5. Authored body proportions through the spawn rules.
(async () => {
  const window = {};
  vm.runInNewContext(read('docs/js/combat/enemy-loadout-rules.js'), {
    window, console, URL,
    document: { currentScript: { src: 'https://game.test/docs/js/combat/enemy-loadout-rules.js' }, baseURI: 'https://game.test/docs/' },
    fetch: async () => ({ ok: true, json: async () => ({ schema: 'hobunji_enemy_loadouts.v1', rules: {} }) }),
  });
  const rules = window.EnemyLoadoutRules;
  await rules.ready;
  assert.equal(rules.rigScaleFor('maskbound:sentinel'), null, 'shipped rules add no override');
  rules.set({ schema: 'hobunji_enemy_loadouts.v1', rules: { 'maskbound:reacher': { rigScale: { y: 2.2, offsetY: 0.1 } } } });
  const got = rules.rigScaleFor('maskbound:reacher');
  assert.equal(got.y, 2.2); assert.equal(got.offsetY, 0.1); assert.equal(got.x, undefined, 'only authored fields are overridden');
  got.y = 9;
  assert.equal(rules.rigScaleFor('maskbound:reacher').y, 2.2, 'accessor returns a copy');
  for (const bad of [{ y: 99 }, { offsetY: 2 }, { depth: 1 }, { x: 'wide' }])
    assert.throws(() => rules.set({ schema: 'hobunji_enemy_loadouts.v1', rules: { 'bandit:grunt': { rigScale: bad } } }), /rigScale/, 'invalid ' + JSON.stringify(bad));
  rules.set({ schema: 'hobunji_enemy_loadouts.v1', rules: { 'bandit:grunt': { enabled: false, rigScale: { y: 2 } } } });
  assert.equal(rules.rigScaleFor('bandit:grunt'), null, 'disabled rules apply nothing');
  const bandit = read('docs/js/combat/combat-bandit.js');
  assert.match(bandit, /loadoutRules\?\.rigScaleFor\?\.\(loadoutKind\)/, 'the factory reads the override');
  assert.doesNotMatch(read('docs/js/combat/combat-maskbound-guardian.js'), /headScale:\s*1\}|headScale:1\}/, 'troop head scale is no longer forced');
  const app = read('docs/tools/enemy-loadout-editor/app.js');
  assert.match(app, /renderBodyProportions\(species, gender\)/, 'workshop exposes the Body tab');
  assert.match(read('docs/tools/enemy-loadout-editor/index.html'), /data-tab="body"/);
  console.log('Hostile presentation parity: weapon height, free hands, head forward, GLB feet, mask over hood, authored body proportions');
})();
