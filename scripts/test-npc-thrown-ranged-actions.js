// Shared NPC ranged actions: thrown weapons charge and release once, reloadable weapons still load separately.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '../docs/js/combat/ranged-weapons.js'), 'utf8');
function functionSource(name, followingName) {
  const start = source.indexOf('  function ' + name + '(');
  const end = source.indexOf('\n  function ' + followingName + '(', start);
  assert(start >= 0 && end > start, name + ' must remain a testable shared function');
  return source.slice(start, end);
}

const MAX_FIRE_TRIGGER_TO_PROJECTILE_S = 0.012; // Tests the shared delay cap for all NPC fire actions.
const definitions = {
  fishingspear: { rangedType: 'thrown', chargeWindupS: 0.49, fireDurationS: 0.55, fireAtFrac: 0.16, rangeTiles: 7 },
  hatchet: { rangedType: 'thrown', chargeWindupS: 0.35, fireDurationS: 0.5, fireAtFrac: 0.22, rangeTiles: 7 },
  crossbow: { fireDurationS: 1.04, reloadDurationS: 1.04, fireAtFrac: 0.08, rangeTiles: 9 },
  blowgun: { rangedType: 'blowgun', fireDurationS: 1, reloadDurationS: 1, fireAtFrac: 0.2, rangeTiles: 8 },
};
const shots = []; // Records NPC projectile releases for the phase/cooldown assertions.
const loadedTransitions = []; // Makes unintended load or unload actions observable for all thrown items.
const actionSounds = []; // Reload sound should never play for throwing spears/hatchets.
const deps = {
  TILE: 64,
  moveCreatureToward: () => false,
}; // Only NPC scheduler dependencies; projectile physics and 3D rig remain covered by their own tests.
const sandbox = {
  Math, performance: { now: () => 1000 }, deps, shots, loadedTransitions, actionSounds, MAX_FIRE_TRIGGER_TO_PROJECTILE_S,
  defFor: key => definitions[key],
  isLoaded: (_key, actor) => actor._rangedLoaded !== false,
  setLoaded: (key, value, actor) => { actor._rangedLoaded = value; loadedTransitions.push([key, value]); },
  playRangedActionSfx: (key, kind) => actionSounds.push([key, kind]),
  spawnVolley: (key, _x, _y, _angle, team) => shots.push([key, team]),
  banditAimPitch: () => 0,
  banditLosStatus: () => ({ clear: true }),
  rangedAttackRadiusPx: () => deps.TILE * 9, // updateBanditAI is extracted in isolation; keep its weapon-range dependency explicit.
  canMeleeReach: () => false,
  repositionBanditForLos: () => false,
};
vm.createContext(sandbox);
vm.runInContext('let lastEvent = "idle";\n' +
  functionSource('fireReleaseFrac', 'isLoaded') + '\n' +
  functionSource('beginBanditAction', 'banditLosSegment') + '\n' +
  functionSource('updateBanditAI', 'updateBanditVisual') + '\n' +
  'globalThis.npcAI = { updateBanditAI, beginBanditAction };', sandbox);
const update = sandbox.npcAI.updateBanditAI;
const target = { x: 256, y: 0 };
const actor = weapon => ({
  id: 'test-' + weapon, x: 0, y: 0, health: 30, def: { rangedWeaponKey: weapon, chaseSpeed: 100 },
  _rangedLoaded: false, _rangedCooldownT: 0,
}); // Starting unloaded proves throwing does not inherit crossbow magazine state.

for (const key of ['fishingspear', 'hatchet']) {
  const npc = actor(key);
  update(npc, 0.016, target, 256);
  assert.equal(npc._rangedAction.kind, 'fire', key + ' should enter its one throw action immediately');
  assert.equal(npc._rangedAction.chargeDurationS, definitions[key].chargeWindupS, 'author windup timing is preserved');
  assert(Math.abs(npc._rangedAction.durationS - (definitions[key].chargeWindupS + definitions[key].fireDurationS)) < 1e-9, 'held charge and release are one continuous action');
  const releaseAt = npc._rangedAction.releaseAtS;
  assert(releaseAt - npc._rangedAction.chargeDurationS <= MAX_FIRE_TRIGGER_TO_PROJECTILE_S + 1e-9, 'NPC throws release within 12ms of completing charge');
  update(npc, releaseAt - 0.001, target, 256);
  assert.equal(npc._rangedAction.fired, false, 'throw cannot release before the authored strike point');
  update(npc, 0.002, target, 256);
  assert.equal(npc._rangedAction.fired, true, 'throw releases as soon as the strike point is passed');
  assert.equal(shots.filter(s => s[0] === key).length, 1, 'exactly one projectile per throw');
  update(npc, npc._rangedAction.durationS, target, 256);
  assert.equal(npc._rangedAction, null, 'the shared firing action completes without a load phase');
  update(npc, 0.56, target, 256);
  assert.equal(npc._rangedAction.kind, 'fire', 'another throw may begin after cooldown with no loading state');
  assert.equal(loadedTransitions.filter(t => t[0] === key).length, 0, 'thrown ammunition never enters a reload state');
  assert.equal(actionSounds.filter(s => s[0] === key && s[1] === 'load').length, 0, 'throwing has no loading sound');
}

for (const key of ['crossbow', 'blowgun']) {
  const npc = actor(key);
  update(npc, 0.016, target, 256);
  assert.equal(npc._rangedAction.kind, 'load', key + ' still requires a distinct reload');
  update(npc, definitions[key].reloadDurationS + 0.01, target, 256);
  assert.equal(npc._rangedLoaded, true, 'reload must actually arm the weapon');
  update(npc, 0.19, target, 256);
  assert.equal(npc._rangedAction.kind, 'fire', 'armed weapon can fire normally');
  assert(npc._rangedAction.releaseAtS <= MAX_FIRE_TRIGGER_TO_PROJECTILE_S + 1e-9, 'NPC loaded shot releases within 12ms of firing');
  const priorShots = shots.length;
  update(npc, 0.016, target, 256);
  assert.equal(shots.length, priorShots + 1, 'one loaded projectile releases on the first 60fps firing tick');
  update(npc, definitions[key].fireDurationS + 0.01, target, 256);
  assert.equal(npc._rangedLoaded, false, 'reloadable weapon is unloaded after firing');
}
assert.match(source, /if \(thrown && action\?\.kind === 'fire' && action\.fired\) \{ holder\.visible = false; return; \}/, 'NPC must hide thrown sprite when projectile leaves the hand');
assert.match(source, /pose = lerpPose\(def\.chargePose\?\.neutral[\s\S]*?def\.chargePose\?\.windup/, 'NPC throws must actually animate neutral to the held windup before release');
assert.match(source, /get npcRangedActions\(\)/, 'mobile debug should expose per-NPC ranged phase snapshots');
console.log('NPC thrown-weapon attack and reloadable ranged-weapon regression checks passed.');
