'use strict';
// Regression coverage for automatic Furious companion specials and shared Quick Attack / Soursap audio hooks.
const assert = require('node:assert/strict'); // Live dispatch and resource assertions distinguish Fury from ordinary Stamina.
const fs = require('node:fs'); // Reads the shipped combat modules instead of testing a reimplementation.
const vm = require('node:vm'); // Runs the actual modular animal-attack dispatcher with deterministic browser seams.

let now = 10000; // Simulates performance.now() so paused absolute special cooldowns can be verified.
const player = { id: 'owner' }; // The exact local master required for automatic Furious attacks.
let totalOrdinarySpend = 0; // Must remain zero for the entire Fury-funded attack.
const starts = []; // Records which signature actually begins and its tactical focus.
const actor = {
  id: 'companion', x: 0, y: 0, isCompanion: true, stableRole: 'companion', master: player,
  def: { attackStaminaCost: 10, attackRangePx: 90, attacks: ['cheap', 'expensive'] },
  stamina: 0, maxStamina: 100, attackCooldownT: 4.25,
  afflictions: { furiousStamina: 24.9 },
  _voorgRearKickCooldownUntil: now + 5000,
}; // An otherwise exhausted animal proves the interrupt only uses Enhanced Furious Stamina.
const target = { x: 20, y: 0, health: 100 }; // Target is already within normal reach, avoiding movement-fixture dependencies.
const context = {
  console,
  performance: { now: () => now },
  window: null,
};
context.window = context;
context.Combat = { deps: { TILE: 64, player, requestThreatGrowl() {} } };
context.ResourceSystem = {
  getAffliction: (c, id) => c.afflictions?.[id] || 0,
  removeAffliction(c, id, cost) {
    const taken = Math.min(c.afflictions[id] || 0, cost);
    c.afflictions[id] -= taken;
    return taken;
  },
  spendStamina(c, amount) { totalOrdinarySpend += amount; c.stamina -= amount; },
  timedDebuffModifier: () => 1,
};
context.StableAnimalTrainingRefinements = {
  enabledSpecialAttackIds: () => ['cheap', 'expensive'],
  combatTempo: () => ({ stamina: 1 }),
  prepareFuriousSpecial: (c, id) => { starts.push(id); c._companionTacticLastMove = id; },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/combat/combat-animal-attacks.js', 'utf8'), context, { filename: 'combat-animal-attacks.js' });
const attacks = context.Combat.animalAttacks; // Uses the actual production API, including cost selection and finish/cancel cleanup.
const observedDt = []; // Confirms every named-attack update receives double elapsed combat time.
for (const [id, extraCost] of [['cheap', 5], ['expensive', 15]]) {
  attacks.register(id, {
    label: id,
    additionalStaminaCost: () => extraCost,
    start(_actor, state) { state.elapsed = 0; },
    update(_actor, state, dt) { observedDt.push(dt); state.elapsed += dt; return state.elapsed < 0.65; },
  });
}
assert.equal(attacks.mostExpensiveCompanionSpecial(actor, { target }).id, 'expensive');
assert.equal(attacks.mostExpensiveCompanionSpecial(actor, { target }).cost, 25);
assert.equal(attacks.startFuriousSpecial(actor, { target }), false, '24.9 Furious must not buy a 25-point attack');
assert.equal(starts.length, 0);
actor.afflictions.furiousStamina = 25;
assert.equal(attacks.startFuriousSpecial(actor, { target }), true);
assert.equal(actor._animalAttack.id, 'expensive');
assert.deepEqual(starts, ['expensive']);
assert.equal(actor.afflictions.furiousStamina, 0, 'all 25 points come exclusively from Furious');
assert.equal(actor.stamina, 0, 'ordinary Stamina is not required, spent or sent into exhaustion');
assert.equal(totalOrdinarySpend, 0);
assert.equal(attacks.startFuriousSpecial(actor, { target }), false, 'a running attack cannot trigger itself again');
assert.equal(attacks.update(actor, 0.15), true);
assert.equal(observedDt[0], 0.3, 'Furious speed multiplier applies to the real named-attack update');
now += 2000;
actor.attackCooldownT = 99;
assert.equal(attacks.update(actor, 0.2), false);
assert.equal(actor.attackCooldownT, 4.25, 'the interrupted ordinary cooldown resumes at the exact remaining time');
assert.equal(actor._voorgRearKickCooldownUntil, now + 5000, 'a separately timestamped Rear Kick cooldown is also paused');
assert.equal(actor._lastFuriousSpecial.state, 'finished');
assert.equal(attacks.isBusy(actor), false);
assert.equal(totalOrdinarySpend, 0);
actor.afflictions.furiousStamina = 25;
actor.attackCooldownT = 3;
assert.equal(attacks.startFuriousSpecial(actor, { target }), true);
actor.attackCooldownT = 77;
attacks.cancel(actor);
assert.equal(actor.attackCooldownT, 3, 'cancel/stagger restores the same paused timer');
assert.equal(actor._furiousSpecial, null);
assert.equal(attacks.update(actor, 0.1), false, 'cancelled special cannot advance after presentation cleanup');
assert.equal(attacks.startFuriousSpecial({ ...actor, banditCompanion: true, _animalAttack: null, afflictions: { furiousStamina: 25 } }, { target }), false);
assert.equal(attacks.startFuriousSpecial({ ...actor, master: {}, _animalAttack: null, afflictions: { furiousStamina: 25 } }, { target }), false);
assert.equal(attacks.startFuriousSpecial({ ...actor, stableRole: 'mount', _animalAttack: null, afflictions: { furiousStamina: 25 } }, { target }), false);

const game = fs.readFileSync('docs/game.js', 'utf8'); // Structural coverage confirms live companion AI calls this tested seam.
assert.match(game, /c\._furiousSpecial\.cooldownBefore/, 'companion cooldown remains frozen during the special');
assert.match(game, /animalAttacks\?\.startFuriousSpecial\?\.\(c, \{ target \}\)/, 'companion AI checks threshold before its regular action timer');
const playerQuick = fs.readFileSync('docs/js/combat/combat-quickattacks.js', 'utf8');
const enemyQuick = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
const audio = fs.readFileSync('docs/js/audio-system.js', 'utf8');
const objects = fs.readFileSync('docs/js/shattercasks.js', 'utf8');
const config = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8');
assert.match(playerQuick, /if \(conditionBonusUsed\) window\.AudioSystem\?\.playQuickAttackBonusSfx/, 'player slash only plays for an actual bonus proc');
assert.match(enemyQuick, /impactTech\.bonusActive[\s\S]{0,350}playQuickAttackBonusSfx/, 'NPC quick attack bonus is re-evaluated and played at target contact');
assert.match(audio, /function playQuickAttackBonusSfx\(/);
assert.match(audio, /function playSoursapBurstSfx\(/);
assert.match(audio, /const renderer = window\.AnimalVoiceIndependentPlayback\?\.renderDecodedIndependentBuffer/, 'Soursap reuses the existing independent pitch/tempo DSP');
assert.match(audio, /renderer\(entry\.buffer, combatPositionalContext/, 'decoded recording is passed through the shared processor');
assert.match(audio, /tempo: 0\.8, pitchSemitones: -12/, 'the independent WSOLA request uses precisely the requested sound transformation');
assert.match(config, /"quickAttackBonusSlash"[^\n]+sfx_anime_slash\.wav/);
assert.match(config, /"soursapSplat"[^\n]+sfx_splat_1\.mp3/, 'Soursap references the Drenkirra pellet splat file');
assert.match(objects, /playSoursapBurstSfx\?\.\(x\*tileSize\(\),z\*tileSize\(\),fruit\.mapId\)/, 'the actual explosion location and mapId own the splat, even when visual scene setup fails');
assert.match(audio, /const approximateRate = Math\.sqrt\(pitchRatio \* tempoRatio\)/, 'native first-hit fallback avoids a double application of the 80%-tempo and -12 st factors');
const burrowCode = fs.readFileSync('docs/js/combat/combat-grehlr-burrow.js', 'utf8'); // Uses the real Burrow exhaustion implementation rather than reimplementing that penalty.
const startBurrowCost = burrowCode.indexOf('  function applySelfExhaustion(creature) {'); // Isolates the genuine Burrow resource transaction in a lightweight VM.
const endBurrowCost = burrowCode.indexOf('\n  function resolveBite', startBurrowCost);
assert(startBurrowCost > 0 && endBurrowCost > startBurrowCost);
const burrowCostFn = burrowCode.slice(startBurrowCost, endBurrowCost); // Preserves the authored Footing penalty and post-burrow Stamina rules.
let burrowOrdinaryPaid = 0; // Every ordinary Stamina point paid at Burrow emergence is counted.
const selfExhaust = vm.runInNewContext(burrowCostFn + '\napplySelfExhaustion;', {
  tuning: { SELF_FOOTING_DRAIN_FRACTION: 0.8, SELF_STAMINA_DRAIN_FRACTION: 0.9 },
  window: { ResourceSystem: { spendStamina(_creature, cost) { burrowOrdinaryPaid += cost; } } },
});
const burrowCompanion = { maxStamina: 100, maxFooting: 100, footing: 100, def: { maxStamina: 100 }, _furiousSpecial: { id: 'grehlrBurrow' } }; // Fury-funded Grehlr has the same post-emergence penalty phase as a normal burrower.
selfExhaust(burrowCompanion);
assert.equal(burrowCompanion.footing, 20, 'Furious Burrow preserves the signature 80% self-Footing penalty');
assert.equal(burrowOrdinaryPaid, 0, 'Furious Burrow must not pay a hidden second cost from ordinary Stamina');
delete burrowCompanion._furiousSpecial;
burrowCompanion.footing = 100;
selfExhaust(burrowCompanion);
assert.equal(burrowOrdinaryPaid, 90, 'ordinary Grehlr Burrow still pays the original 90% self-Stamina cost');
console.log('Furious companion interrupt, Grehlr exhaustion, fruit origin, and conditional audio wiring: PASS');
