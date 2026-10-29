'use strict';
// Real NPC Quick Attack strike regression for player, animal, NPC, bonus cooldown and misses.
const assert = require('node:assert/strict'); // Verifies actual bonus damage and one-shot dispatch.
const fs = require('node:fs'); // Loads shipped Quick Attack and BanditCombat modules.
const vm = require('node:vm'); // Provides browser-compatible globals without launching the full game.

const quickSource = fs.readFileSync('docs/js/combat/combat-quickattacks.js', 'utf8'); // Exact player/shared conditional technique and victim cooldown implementation.
const banditSource = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8'); // Exact NPC target conditions, damage routing and staged quick strike.
const audioEvents = []; // Captures per-target slash and weapon-impact sounds at the point of dispatch.
const damageEvents = []; // Captures real player-versus-creature damage dispatch and the committed damage.
let staged = null; // One NPC windup/strike instance returned by the real staged-action constructor.
let contact = true; // Melee hit gate can switch to a miss without changing any attack logic.
const player = { id: 'player', x: 0, y: 0, angle: 0 }; // Combat.deps requires a local player even when an NPC attacks another actor.
const win = {
  Combat: {
    abilities: { register() {} },
    deps: { player, getCurrentArea: () => 'farm' },
    meleeHit: () => contact,
    meleeAimSolution: () => ({ pitch: 0 }),
    beginStagedAction(opts) { staged = opts; return opts; },
  },
  ResourceSystem: {
    getDepletionEquivalentCurrent: (actor, key) => actor[key],
    afflictionBonusesForTag: () => ({}),
  },
  AudioSystem: {
    playQuickAttackBonusSfx(...args) { audioEvents.push(['anime-slash', ...args]); },
    playWeaponHitSfx(...args) { audioEvents.push(['weapon-impact', ...args]); },
  },
}; // Only engine surfaces required by the two production functions under test.
const clock = { now: () => 10_000 }; // Frozen clock keeps per-victim cooldown active between immediate strikes.
vm.runInNewContext(quickSource, { window: win, performance: clock, console }); // Uses the real getConditions/buildTechnique/bonus-cooldown table.

function sliceBetween(source, start, end) {
  const begin = source.indexOf(start); // Ensures the test cannot quietly use a stale private NPC implementation.
  const stop = source.indexOf(end, begin);
  assert(begin >= 0 && stop > begin, 'required production combat seam must exist');
  return source.slice(begin, stop);
}
const damageSource = sliceBetween(banditSource, '  function damageBanditCombatTarget(', '  // Mirrors combat-quickattacks.js');
const conditionSource = sliceBetween(banditSource, '  function banditQuickAttackConditions(', "  // The weapon's own natural");
const attackSource = sliceBetween(banditSource, '  function fireBanditQuickAttack(', '  function fireBanditChargedBreaker(');
const deps = {
  TILE: 64,
  damageCreature(target, amount) { damageEvents.push({ route: 'creature', name: target.name, amount }); target.health -= amount; },
  damagePlayer(amount) { damageEvents.push({ route: 'player', amount }); return true; },
}; // Uses the real damageBanditCombatTarget's classification to distinguish player from NPC/animal.
const ctx = {
  window: win, deps, performance: clock, Math,
  banditAttackBaseline: () => ({ damage: 10, rangePx: 100, knockbackPxS: 300 }),
  beginBanditLunge() {}, spawnBanditTrailArc() {}, finishBanditAction() {},
  banditRetreatDurationS: () => 0,
};
vm.createContext(ctx);
vm.runInContext(damageSource + '\n' + conditionSource + '\n' + attackSource, ctx, { filename: 'combat-bandit.js#quick-attack' });
const attacker = {
  id: 'attacker', x: 0, y: 0, areaId: 'farm', facing: 0,
  def: { attackTag: 'sharp', attackCooldownS: 1, weaponShapeStats: { power: 1, speed: 1, range: 1 } },
}; // A real NPC loadout with a fixed, known weapon shape.
const makeTarget = (name, flags) => ({
  name, x: 12, y: 0, areaId: 'farm', angle: 0, health: 20, maxHealth: 100,
  stamina: 100, maxStamina: 100, ...flags,
}); // Mercy Spike condition is true below 30% Health at the instant of contact.
function strike(target) {
  assert.equal(ctx.fireBanditQuickAttack(attacker, attacker.def, { tap2: 'mercySpike' }, target), true);
  assert(staged && typeof staged.onStrike === 'function');
  staged.onStrike(); // One actual NPC strike at contact, not a replicated conditional judgment.
}

for (const [name, flags, route] of [
  ['player', {}, 'player'],
  ['animal', { creatureKey: 'gar-wolf' }, 'creature'],
  ['npc', { isBandit: true }, 'creature'],
]) {
  const target = makeTarget(name, flags);
  audioEvents.length = 0;
  damageEvents.length = 0;
  strike(target);
  assert.equal(audioEvents.filter(e => e[0] === 'anime-slash').length, 1, name + ' plays the anime slash on a qualifying contact');
  assert.equal(audioEvents.filter(e => e[0] === 'weapon-impact').length, 1, name + ' preserves its normal weapon impact');
  assert.equal(damageEvents[0].route, route, name + ' is routed to the right damage API');
  const bonusDamage = damageEvents[0].amount; // Ensures the second strike loses the bonus damage as well as the sound.
  assert(win.Combat.quickAttackData.bonusEffectCooldownRemaining(target) > 0);
  audioEvents.length = 0;
  damageEvents.length = 0;
  target.health = 20;
  strike(target);
  assert.equal(audioEvents.filter(e => e[0] === 'anime-slash').length, 0, name + ' on cooldown must not play another anime slash');
  assert(damageEvents[0].amount < bonusDamage, name + ' on cooldown must also lose the bonus damage');
}

audioEvents.length = 0;
damageEvents.length = 0;
strike(makeTarget('healthy', { health: 90 }));
assert.equal(audioEvents.filter(e => e[0] === 'anime-slash').length, 0, 'healthy targets never proc Mercy Spike');
contact = false;
audioEvents.length = 0;
damageEvents.length = 0;
strike(makeTarget('missed', {}));
assert.equal(audioEvents.length, 0, 'a whiff produces no hit or anime slash SFX');
assert.equal(damageEvents.length, 0, 'a whiff deals no damage');
console.log('NPC conditional Quick Attack SFX: player, creature, NPC, per-target cooldown and whiff PASS');
