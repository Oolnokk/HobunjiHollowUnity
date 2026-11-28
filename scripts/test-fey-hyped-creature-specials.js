#!/usr/bin/env node
'use strict';

// Real ResourceSystem/FeyHypedAttacks/Combat.animalAttacks modules. Unlike a
// synthetic duplicated damage function, the final tests invoke authored
// Pounce/Guard Charge and their existing movement and damage callbacks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const events = []; // Records only actual damage authority calls from the second, independently simulated attack.
const clocks = { now: () => 1000 }; // Deterministic action-credit expiration for this short game-loop simulation.
const ctx = { console, Date, Math, performance: clocks, CustomEvent: class CustomEvent {
  constructor(type, options) { this.type = type; this.detail = options?.detail; }
}};
ctx.window = ctx;
ctx.addEventListener = () => {};
ctx.dispatchEvent = () => true;
ctx.document = { addEventListener() {}, getElementById: () => null };
ctx.SCRATCHBONES_CONFIG = { game: { combat: { resourceSystem: { pukeChancePerSec: 0 } } } };
const player = { health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, footing: 100, maxFooting: 100,
  x: 30, y: 0, areaId: 'arena' }; // Distinct actor, so a hostile's attack cannot borrow the player's enhanced payment.
const deps = {
  player, players: [player], TILE: 64, hostileObjects: [], companionObjects: [], getCurrentArea: () => 'arena',
  inCone: (ax, ay, angle, x, y, range, halfCone) => {
    const dx = x - ax, dy = y - ay;
    return Math.hypot(dx, dy) <= range && Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - angle),
      Math.cos(Math.atan2(dy, dx) - angle))) <= halfCone;
  },
  canOccupyAt: () => true,
  damagePlayer(amount, fromX, fromY, knockback, opts) { events.push({ target: player, amount, knockback, opts }); return true; },
  damageCreature(target, amount, fromX, fromY, knockback, opts) { events.push({ target, amount, knockback, opts }); return true; },
  requestThreatGrowl() {}, playCreatureClawHit() {}, tickCreatureFootsteps() {}, tickCreatureLungeTrail() {},
};
ctx.Combat = {
  deps,
  meleeHit: (attacker, target, hit) => Math.hypot(attacker.x - target.x, attacker.y - target.y) <= hit.rangePx,
  meleeAimSolution: () => ({ pitch: 0 }),
  meleeLungeProfile: distancePx => ({ distancePx, hopUnits: 0, pitch: 0 }),
  abilities: { get: () => null },
};
vm.createContext(ctx);
const load = filename => vm.runInContext(fs.readFileSync(filename, 'utf8'), ctx, { filename });
load('docs/js/combat/resource-system.js');
load('docs/js/combat/fey-illusions.js');
load('docs/js/combat/fey-hyped-attacks.js');
load('docs/js/combat/combat-animal-attacks.js');
const RS = ctx.ResourceSystem;
const hype = ctx.FeyHypedAttacks;
const attacks = ctx.Combat.animalAttacks;
RS.initEntity(player);
const makeCreature = extra => RS.initEntity({
  id: 'animal-' + String((makeCreature.serial = (makeCreature.serial || 0) + 1)),
  health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, footing: 100, maxFooting: 100,
  x: 0, y: 0, areaId: 'arena',
  def: { attackDamage: 30, attackRangePx: 60, attackHalfConeRad: Math.PI / 3, attackTag: 'sharp',
    attackStaminaCost: 10, modelWidth: 2 },
  ...extra,
});
const makeTarget = extra => RS.initEntity({
  health: 300, maxHealth: 300, stamina: 100, maxStamina: 100, footing: 100, maxFooting: 100,
  x: 40, y: 0, areaId: 'arena', ...extra,
});
const pay = (actor, amount, kind = 'combatCreatureSpecial') => RS.spendStamina(actor, amount, 'creature attack',
  { actionKind: kind, abilityId: kind === 'combatCreatureSpecial' ? 'creatureSpecial' : 'walking' });
const run = (actor, count = 60, step = .05) => {
  let updates = 0; // Def's own update owns lunge, animation, projectiles and damage; this only supplies ordinary frame deltas.
  while (attacks.isBusy(actor) && updates++ < count) attacks.update(actor, step);
  assert.equal(attacks.isBusy(actor), false, 'creature special must always terminate');
  return updates;
};
const close = (got, want, msg) => assert(Math.abs(got - want) < .00001, msg + ': ' + got + ' vs ' + want);

// A real paid special starts twice at 2x speed; no second top-up, no third
// attack, and every hit travels the existing damageCreature owner.
{
  const creature = makeCreature();
  const victim = makeTarget();
  let begins = 0, completes = 0, total = 0;
  const budgets = []; // Authored first and scaled second physical lunge, not a copied damage event.
  attacks.register('hypedTestSpecial', {
    label: 'Test Special', ownsApproach: true,
    start(actor, state, context, d) {
      begins++;
      state.t = 0;
      attacks.beginConeLunge(actor, state, context, d, {
        targets: [context.target], rangePx: 60, halfConeRad: 1,
        maxDistancePx: 100, speedPxS: 500,
      });
      budgets.push(state.lungeMaxDistancePx);
    },
    update(actor, state, dt, d) {
      state.t += dt;
      total += dt;
      if (state.t < .2) return true;
      d.damageCreature(victim, 30, actor.x, actor.y, 200, { attacker: actor,
        afflictionBonuses: { bleedingHealth: .4 },
        fixedAfflictionBuildup: { woundedStamina: 5 } });
      completes++;
      return false;
    },
  });
  RS.addEnhancedResource(creature, 'hypedStamina', 8);
  pay(creature, 2, 'walking');
  assert.equal(RS.getAffliction(creature, 'hypedStamina'), 8, 'walking cannot spend stored Hyped');
  const original = pay(creature, 8);
  assert.equal(original.consumed.find(entry => entry.id === 'hypedStamina')?.rawConsumed, 8);
  assert.equal(attacks.start(creature, 'hypedTestSpecial', { target: victim }), true);
  close(RS.getAffliction(creature, 'hypedStamina'), 0, 'single payment committed');
  run(creature);
  assert.equal(begins, 2, 'original and exactly one second complete animated special');
  assert.equal(completes, 2);
  close(total, .4, 'both attacks advanced at 2x speed over .4 game seconds');
  close(budgets[1], budgets[0] * .16, 'second lunge distance scales to sixteen percent');
  assert.equal(events.length, 2, 'secondary performs its own real damage dispatch');
  close(events[1].amount, 4.8, '8 Hyped → 16% of 30 damage');
  close(events[1].knockback, 32, '8 Hyped → 16% of 200 knockback');
  close(events[1].opts.afflictionBonuses.bleedingHealth, .064, 'status buildup scaled once');
  close(events[1].opts.fixedAfflictionBuildup.woundedStamina, .8, 'flat buildup scaled once');
  assert.equal(events[1].opts.feyHypedReplay, true);
  assert.equal(creature._animalAttack, null, 'no lingering special, stage or target references');
  close(creature._lastHypedCreatureAttack.ratio, .16, 'last status available to mobile diagnostics');
}

// Health-less authored preview actors are valid, not dead. Their paid Hyped
// special must still execute its full second stage, matching start/update.
{
  events.length = 0;
  const creature = makeCreature();
  const victim = makeTarget();
  RS.addEnhancedResource(creature, 'hypedStamina', 5);
  pay(creature, 5);
  delete creature.health; // The editor preview intentionally has no Health field.
  assert.equal(attacks.start(creature, 'hypedTestSpecial', { target: victim }), true);
  run(creature);
  assert.equal(events.length, 2, 'a health-less preview creature must not silently lose its paid second strike');
  close(events[1].amount, 3, '5 Hyped still scales the second preview hit by 10%');
  assert.equal(creature._animalAttack, null, 'health-less preview clears transient Hyped references');
}

// Hyped is charged for an eligible special's generic cost AND its authored
// extra stamina top-up; the replay must not repeat either expenditure.
{
  events.length = 0;
  const creature = makeCreature();
  const victim = makeTarget();
  attacks.register('hypedCostlySpecial', {
    label: 'Costly', ownsApproach: true, additionalStaminaCost: () => 5,
    start(actor, state) { state.t = 0; },
    update(actor, state, dt, d) {
      state.t += dt;
      if (state.t < .1) return true;
      d.damageCreature(victim, 10, actor.x, actor.y, 10, { attacker: actor });
      return false;
    },
  });
  RS.addEnhancedResource(creature, 'hypedStamina', 10);
  pay(creature, 5);
  assert.equal(attacks.start(creature, 'hypedCostlySpecial', { target: victim }), true);
  const staminaAfterPayment = creature.stamina;
  run(creature);
  assert.equal(creature.stamina, staminaAfterPayment, 'the secondary does not pay the cost or the extra top-up again');
  assert.equal(events.length, 2);
  close(events[1].amount, 2, 'combined 10 Hyped generates a 20% effect');
}

// The independently tested second special can hit after a first whiff;
// a canceled, dead or vanished actor/target must not attack afterward.
{
  events.length = 0;
  const creature = makeCreature();
  const victim = makeTarget();
  let count = 0;
  attacks.register('hypedWhiffSpecial', {
    label: 'Whiff', ownsApproach: true,
    start(actor, state) { state.t = 0; },
    update(actor, state, dt, d) {
      state.t += dt;
      if (state.t < .1) return true;
      if (++count === 2) d.damageCreature(victim, 40, actor.x, actor.y, 50, { attacker: actor });
      return false;
    },
  });
  RS.addEnhancedResource(creature, 'hypedStamina', 5); pay(creature, 5);
  attacks.start(creature, 'hypedWhiffSpecial', { target: victim });
  run(creature);
  assert.equal(count, 2);
  assert.equal(events.length, 1, 'a first miss cannot suppress the independent second');
  close(events[0].amount, 4, 'second whiff recovery retains 10% of the authored hit');

  RS.addEnhancedResource(creature, 'hypedStamina', 5); pay(creature, 5);
  attacks.start(creature, 'hypedWhiffSpecial', { target: victim });
  attacks.cancel(creature);
  assert.equal(creature._animalAttack, null);
  assert.equal(creature._lastHypedCreatureAttack.stage, 'cancelled');
  assert.equal(count, 2, 'cancellation must never start the echo');

  RS.addEnhancedResource(creature, 'hypedStamina', 5); pay(creature, 5);
  attacks.start(creature, 'hypedWhiffSpecial', { target: victim });
  victim.areaId = 'other-map';
  run(creature);
  assert.equal(count, 3, 'first staged attack may finish after target moves');
  assert.equal(creature._lastHypedCreatureAttack.stage, 'finished', 'no repeat when target moved');
  assert.equal(events.length, 1, 'map change cannot cause a ghost second impact');
  victim.areaId = 'arena';

  RS.addEnhancedResource(creature, 'hypedStamina', 3); pay(creature, 3);
  attacks.start(creature, 'hypedWhiffSpecial', { target: victim });
  creature.health = 0;
  assert.equal(attacks.update(creature, .1), false, 'dead creatures cancel the outstanding special immediately');
  assert.equal(creature._animalAttack, null);
}

// A no-cost Furious auto-interrupt keeps its existing single 2x special,
// without draining Hyped or multiplying the tempo to 4x.
{
  events.length = 0;
  const creature = makeCreature();
  const victim = makeTarget();
  const previous = RS.addEnhancedResource(creature, 'hypedStamina', 5);
  creature._furiousSpecial = { id: 'hypedTestSpecial', cooldownBefore: .7, hadRearKickCooldown: false };
  assert.equal(attacks.start(creature, 'hypedTestSpecial', { target: victim, furiousSpecial: true }), true);
  assert.equal(attacks.hypedDebug(creature).active, false, 'Furious override is not an unpaid Hyped echo');
  run(creature);
  assert.equal(events.length, 1, 'no Furious+Hyped triple attack');
  assert.equal(RS.getAffliction(creature, 'hypedStamina'), previous);
  assert.equal(creature._furiousSpecial, null, 'Furious cleanup remains under original owner');
  close(creature.attackCooldownT, .7, 'Furious original cooldown restored after attack');
}

// The real authored Pounce, not the synthetic test special, is executed with
// two real independent pitched cone contacts and one paid stamina cost.
{
  events.length = 0;
  const creature = makeCreature({ def: {
    attackDamage: 24, attackRangePx: 50, attackHalfConeRad: 1.1,
    attackTag: 'sharp', attackStaminaCost: 10,
  }});
  const originalX = player.x;
  player.x = 30;
  RS.addEnhancedResource(creature, 'hypedStamina', 8);
  pay(creature, 8);
  assert.equal(attacks.start(creature, 'pounce', { target: player }), true);
  const staminaBeforeEcho = creature.stamina;
  run(creature, 80, .05);
  assert.equal(events.length, 2, 'the real Pounce commits two separate contacts');
  close(events[0].amount, 24, 'first pounce unchanged');
  close(events[1].amount, 24 * .16, 'second pounce carries sixteen percent effect');
  assert.equal(creature.stamina, staminaBeforeEcho, 'second pounce cannot repeat the additional Pounce cost');
  player.x = originalX;
}

// The second Charge remains a real zero-Health-damage footing/knockback
// impact with a physically scaled swept movement budget.
{
  events.length = 0;
  const creature = makeCreature({ def: {
    attackDamage: 8, attackRangePx: 60, attackHalfConeRad: Math.PI / 3,
    attackTag: 'blunt', attackStaminaCost: 10, modelWidth: 2,
  }});
  RS.addEnhancedResource(creature, 'hypedStamina', 8); pay(creature, 8);
  assert.equal(attacks.start(creature, 'guardCharge', { target: player }), true);
  run(creature, 30, .05);
  assert.equal(events.length, 2, 'real Guard Charge contacts the player twice');
  close(events[0].amount, 0, 'original Guard Charge remains nonlethal');
  close(events[1].knockback, events[0].knockback * .16, 'second charge knockback scaled');
  close(events[1].opts.afflictionBonuses.bruisedHealth,
    events[0].opts.afflictionBonuses.bruisedHealth * .16, 'nonlethal Guard Charge status scaled');
}

// At 50 Hyped, the second special is exactly as strong as the first but
// still needs its replay flag for correct one-shot procs and hit diagnostics.
{
  events.length = 0;
  const creature = makeCreature();
  const victim = makeTarget();
  RS.addEnhancedResource(creature, 'hypedStamina', 50);
  pay(creature, 50);
  assert.equal(attacks.start(creature, 'hypedTestSpecial', { target: victim }), true);
  run(creature);
  assert.equal(events.length, 2, 'full-strength Hyped still performs exactly two attacks');
  close(events[1].amount, events[0].amount, '50 Hyped grants a 100% second hit');
  assert.equal(events[1].opts.feyHypedReplay, true, '100% second effect is a replay, not an ordinary attack that can recurse');
  assert.equal(creature._lastHypedCreatureAttack.hits, 1, 'full-strength second contact is counted in mobile diagnostics');
}

const feySources = ['docs/game.js','docs/js/combat/combat-grehlr-stink.js',
  'docs/js/combat/combat-grehlr-burrow.js','docs/js/combat/combat-attach.js'];
const sources = feySources.map(path => fs.readFileSync(path, 'utf8'));
assert.equal((sources[0].match(/actionKind: 'combatCreatureSpecial'/g) || []).length, 4,
  'game.js identifies four independent wild/companion special spending entry points');
assert(sources[1].includes('creatureEffectRatio?.(creature)'), 'direct Grehlr Winded Stamina scales on the echo');
assert(sources[2].includes('creature?._animalAttack?.hyped?.phase === 1'), 'Grehlr burrow self-cost only charged once');
assert(sources[3].includes('creatureDamagePayload?.(c, amount, 0, opts)'), 'attached Swarm ticks use their author-owned damage pipeline');
const pingdortSource = fs.readFileSync('docs/js/pingdort-flocks.js', 'utf8'); // Delayed Shattercasks impacts happen after the named attack has cleared.
assert(pingdortSource.includes('state.boulder.pendingFeyHypedImpactRatio=echoScale')
  && pingdortSource.includes('delete burden.pendingFeyHypedImpactRatio')
  && pingdortSource.includes('150*feyScale'),
  'Hyped Pingdort boulder carries exactly one reduced impact, then consumes its replay marker');
// A full-strength echo is still a secondary attack. Its one-use tag must not
// disappear merely because 50 Hyped points happen to produce a ratio of 1.
{
  const begin = pingdortSource.indexOf('  function boulderImpact(');
  const end = pingdortSource.indexOf('  function ensureBoulderFactory(', begin);
  assert(begin >= 0 && end > begin, 'real Pingdort boulder impact function is available');
  const hits = []; // Spy on real boulder damage options to catch full-strength replay flags.
  const deps = { TILE: 64, hostileObjects: [{ health: 100, areaId: 'arena', x: 0, y: 0 }],
    damageCreature(target, amount, x, y, knockback, opts) { hits.push({ amount, knockback, replay: opts.feyHypedReplay }); return true; } };
  const debug = { boulderImpacts: 0 }; // Match the impact handler's real enclosing module diagnostics.
  const hit = vm.runInNewContext(pingdortSource.slice(begin, end) + '\n boulderImpact', {
    window: { THREE: { Vector3: class Vector3 {} }, Combat: { deps },
      Shattercasks: { discardBurden(burden) { burden.exploded = true; return true; } } },
    debug,
  });
  const dropped = ratio => {
    const burden = { mapId: 'arena', hanging: false, group: { getWorldPosition: () => ({ x: 0, y: 0, z: 0 }) } };
    if (ratio !== null) burden.pendingFeyHypedImpactRatio = ratio;
    assert.equal(hit(burden, 'test'), true);
    assert.equal('pendingFeyHypedImpactRatio' in burden, false, 'the impact consumes its replay marker exactly once');
    assert.equal(burden.exploded, true, 'both ordinary and replay boulders break on contact');
    assert.equal(hit(burden, 'duplicate'), false, 'duplicate impact cannot replay damage');
  };
  dropped(null);
  dropped(.16);
  dropped(1);
  assert.equal(hits.length, 3, 'all ordinary/partial/full boulders use the original impact owner');
  assert.equal(debug.boulderImpacts, 3, 'diagnostics count only the three genuine impacts');
  close(hits[1].knockback, hits[0].knockback * .16, 'partial replay also scales knockback');
  close(hits[2].knockback, hits[0].knockback, 'full replay retains knockback');
  close(hits[0].amount, 18, 'ordinary boulders retain full damage');
  assert.equal(hits[0].replay, false, 'ordinary boulders remain ordinary hits');
  close(hits[1].amount, 2.88, '8 Hyped points produce a sixteen-percent boulder');
  assert.equal(hits[1].replay, true, 'partial-strength boulder is tagged as a replay');
  close(hits[2].amount, 18, '50 Hyped points produce a full-strength second boulder');
  assert.equal(hits[2].replay, true, 'full-strength second boulder must still be tagged as a replay');
}

assert(hype.debugSnapshot().creatureReplayCount >= 5, 'mobile diagnostics track all real creature secondary contacts');
console.log('Hyped creature specials: native Pounce, Charge, paid top-ups, movement, afflictions, whiff, cancellation, map safety, Furious precedence PASS');
