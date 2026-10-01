#!/usr/bin/env node
'use strict';

// Hostile (BanditCombat-family) weapon visuals must carry the same base x
// calculated-height scale that the procedural hand's grip target uses, and
// only recompute it when grip/height data changes. Executes the real
// syncBanditWeaponScale source extracted from combat-bandit.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
const start = source.indexOf('  let banditWeaponScaleRevision = 0;');
const end = source.indexOf('  function makeBanditToolHolder(');
assert.ok(start > 0 && end > start, 'syncBanditWeaponScale block must exist before makeBanditToolHolder');

let listener = null;
let calls = 0;
const scales = { 'mao-ao|male': 1.3, 'kenkari|female': 1.3 * 1.2 };
const window = {
  HobunjiHandToolGrips: {
    effectiveToolScaleForTool(key, speciesId, gender) { calls += 1; return scales[`${speciesId}|${gender}`] ?? 1; },
    subscribe(fn) { listener = fn; return () => {}; },
  },
};
const context = { window };
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}\nthis.syncBanditWeaponScale = syncBanditWeaponScale;`, context);
const sync = context.syncBanditWeaponScale;

function makeVisual() {
  return { userData: {}, scale: { x: 1, y: 1, z: 1, setScalar(v) { this.x = this.y = this.z = v; } } };
}
const visual = makeVisual();
const holder = { children: [visual] };
const bandit = { avatarRef: { speciesId: 'kenkari', gender: 'female', group: { userData: {} } } };

sync(bandit, holder, 'hatchet');
assert.equal(visual.scale.x, 1.3 * 1.2, 'visual uses effective base x height scale for the bandit identity');
assert.equal(calls, 1);
sync(bandit, holder, 'hatchet');
assert.equal(calls, 1, 'unchanged key + data does not recompute every frame');

scales['kenkari|female'] = 1.5;
listener();
sync(bandit, holder, 'hatchet');
assert.equal(visual.scale.x, 1.5, 'grip/height data change re-applies the scale');

const fallback = makeVisual();
sync({ avatarRef: { group: { userData: { speciesId: 'mao-ao', gender: 'male' } } } }, { children: [fallback] }, 'hatchet');
assert.equal(fallback.scale.x, 1.3, 'identity falls back to the avatar group userData');

sync(bandit, { children: [] }, 'hatchet'); // Missing visual is a no-op.
sync(bandit, holder, null); // Missing key is a no-op.
console.log('bandit weapon height-scale sync tests passed');
