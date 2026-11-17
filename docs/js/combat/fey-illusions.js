// Fey illusions alter perceived sensations, not the underlying anatomy.
// Their consequences come from the target's movement and exertion responses.
(() => {
  'use strict';
  if (window.FeyIllusions) return;

  const EFFECTS = Object.freeze({
    feyDementedStamina: Object.freeze({
      label: 'Demented Stamina', affliction: 'dementedStamina', buildup: 9,
      text: 'Every exertion pulls your sense of direction farther off course.',
    }),
    feyPanickedStamina: Object.freeze({
      label: 'Panicked Stamina', affliction: 'panickedStamina', buildup: 9,
      text: 'Terror waits in your legs for the next desperate dodge.',
    }),
    feyTurnabout: Object.freeze({
      label: 'False Bearing', chance: 0.10,
      text: 'A false sensation of turning spins the victim halfway around.',
    }),
    feyHypedPulse: Object.freeze({
      label: 'Hyped Stamina', grant: 'hypedStamina', buildup: 12,
      text: 'An impossible rush pushes the next attack into a rapid follow-up.',
    }),
    feyDreadPulse: Object.freeze({
      label: 'Panic Surge', affliction: 'panickedStamina', buildup: 16,
      text: 'A sudden sensation of danger charges a dangerous escape.',
    }),
  });

  const ICONS = Object.freeze({
    dementedStamina: '🌀', panickedStamina: '⚡', hypedStamina: '✦',
  }); // Used by the existing shared EffectBuffBar provider.
  const DEG_TO_RAD = Math.PI / 180; // Used by the one-degree-per-Stamina disorientation rule.
  const DEFAULT_ACTION_S = 0.22; // Easing fallback for stamina spends with no authored action duration.
  const HYPED_REPLAY_DELAY_MS = 55; // Used for the rapid secondary impact after a real strike, never for its initial hit.
  const activeTurns = new WeakMap(); // Actor -> uncommitted angular drift, advanced by the shared Combat.update hook.
  const panicRolls = new WeakMap(); // Actor -> one in-flight roll, including its collision/ally hit deduplication.
  const hypedCredits = new WeakMap(); // Attacker -> Hyped Stamina actually spent on their next attack context.
  let registered = false; // Prevents multiple providers in tool previews.
  let lastEffect = null; // Most recent actual illusion or triggered response for mobile diagnostics.
  let lastSecondaryStrike = null; // Most recent actual Hyped follow-up, including skipped targets.
  let replayCount = 0; // Counts only secondary impacts that actually reached the ordinary damage owner.

  const rng = () => window.GameRandom?.random?.() ?? Math.random();
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const rs = () => window.ResourceSystem;
  const player = () => window.Combat?.deps?.player;

  function ensureBuffProvider() {
    if (registered) return true;
    const register = window.EffectBuffBar?.registerProvider;
    if (typeof register !== 'function') return false;
    registered = register('fey-illusions', playerSymptoms) === true;
    return registered;
  }

  function potency(weaponKey) {
    // Fey ignores positive Immundanity; an explicit 0% suppression still cancels it.
    const power = Number(window.EnchantmentSystem?.getEnchantmentPowerMultiplier?.(weaponKey));
    return Number.isFinite(power) && power <= 0 ? 0 : 1;
  }

  function turnTargetAround(target) {
    if (!target || target.health <= 0) return false;
    const base = finite(target.facing, finite(target.angle, 0)); // Existing enemy AI reads facing; the player movement owner reads angle.
    const angle = Math.atan2(Math.sin(base + Math.PI), Math.cos(base + Math.PI));
    target.facing = angle;
    if ('angle' in target) target.angle = angle;
    if (target === player()) window.Combat?.deps?.setFacingAngle?.(angle);
    return true;
  }

  function apply(id, target, options = {}) {
    const effect = EFFECTS[id];
    const resource = rs();
    if (!effect || !target || !(finite(target.health) > 0) || !resource || !potency(options.weaponKey)) return false;
    ensureBuffProvider();
    let applied = false;
    if (effect.chance != null) {
      applied = rng() < effect.chance && turnTargetAround(target); // One seeded 10% roll per actual hit, never a per-frame check.
    } else {
      const recipient = effect.grant ? (options.attacker || target) : target;
      const idToApply = effect.grant || effect.affliction;
      const amount = effect.grant
        ? resource.addEnhancedResource?.(recipient, idToApply, effect.buildup, { reason: 'Fey: ' + id })
        : resource.addAffliction?.(recipient, idToApply, effect.buildup);
      applied = finite(amount) > 0;
    }
    if (!applied) return false;
    lastEffect = { id, label: effect.label, weaponKey: options.weaponKey || null, description: effect.text };
    window.EnchantmentSystem?.logEvent?.('Fey sensory effect: ' + effect.label);
    window.EffectBuffBar?.refresh?.();
    return true;
  }

  function onStaminaSpent(entity, payment, transaction = {}) {
    if (!entity) return;
    const used = Math.max(0, finite(payment.spent) + finite(payment.excess) + finite(payment.enhancedPaid)); // Actual action cost, including enhanced and black Stamina.
    if (used > 0 && finite(rs()?.getAffliction?.(entity, 'dementedStamina')) > 0) {
      const drift = used * DEG_TO_RAD * (rng() < 0.5 ? -1 : 1);
      const state = activeTurns.get(entity) || { remainingRad: 0, remainingS: 0 };
      state.remainingRad += drift; // Stamina points add signed angles even when an earlier rotation is still lerping.
      state.remainingS = Math.max(state.remainingS, finite(transaction.durationS, DEFAULT_ACTION_S), 0.001);
      activeTurns.set(entity, state);
    }
    const hypeUsed = (payment.consumed || []).filter(entry => entry.id === 'hypedStamina')
      .reduce((total, entry) => total + Math.max(0, finite(entry.rawConsumed)), 0);
    const actionKind = String(transaction.actionKind || '');
    const offensive = /^(combatCombo|combatQuickAttack|offensiveHeldCharge|offensiveHeldFlurry|rangedWeaponFire|combatWeaponAttack)$/.test(actionKind)
      || (!actionKind && /attack|swing|strike|breaker|flurry|shot/i.test(String(transaction.reason || '')));
    if (hypeUsed > 0 && offensive) {
      const credit = hypedCredits.get(entity) || { used: 0, expiresAt: 0 };
      credit.used += hypeUsed;
      credit.expiresAt = performance.now() + 4000; // A stale canceled attack cannot empower an unrelated swing later.
      hypedCredits.set(entity, credit);
    }
    if (finite(payment.panicSpent) > 0 && transaction.dodge) {
      const panicSpent = finite(payment.panicSpent);
      panicRolls.set(entity, {
        spent: panicSpent, multiplier: 1 + 0.1 * panicSpent, boosted: false,
        x: finite(entity.x), y: finite(entity.y), lastX: finite(entity.x), lastY: finite(entity.y),
        traveled: 0, peakStep: 0, stalledS: 0, elapsedS: 0, collided: false, hitAllies: new WeakSet(),
      }); // The next ordinary roll spends every Panicked point once, including its bonus cost.
      lastEffect = { id: 'panickedDodge', label: 'Panicked dodge', spent: panicSpent, reachMultiplier: 1 + 0.1 * panicSpent };
    }
  }

  function prepareHypedAttack(context) {
    const actor = context?.attacker;
    const credit = actor && hypedCredits.get(actor);
    if (!credit) return;
    hypedCredits.delete(actor); // One paid attack, not every later attack until the timer expires.
    if (credit.expiresAt < performance.now()) return;
    context.metadata ||= {};
    context.metadata.feyHypedUsed = credit.used; // The attack-context metadata travels to every real on-hit observer.
  }

  function replayHypedHit(event) {
    const amount = Math.max(0, finite(event?.metadata?.feyHypedUsed));
    if (!(amount > 0) || !event?.target || event?.metadata?.feyHypedReplay) return;
    const ratio = amount * 0.02; // Deliberately uncapped: the authored rule is 2% per Hyped point.
    const originalTarget = event.target; // Used to validate the still-present target after the short second-strike delay.
    const attacker = event.attacker;
    const deps = window.Combat?.deps;
    const targetArea = originalTarget.areaId;
    setTimeout(() => {
      if (!(finite(originalTarget.health) > 0) || !(finite(attacker?.health) > 0)
        || (targetArea && originalTarget.areaId !== targetArea)
        || (deps?.getCurrentArea && targetArea && deps.getCurrentArea() !== targetArea)) {
        lastSecondaryStrike = { ratio, skipped: 'target unavailable' };
        return;
      }
      // Require a fresh second-hit geometry test for melee, rather than duplicating an
      // enemy that already left the swing cone. The first hit is never replayed here.
      if (event.rangePx > 0 && event.halfConeRad > 0 && window.Combat?.meleeHit
        && !window.Combat.meleeHit(attacker, originalTarget, {
          rangePx: event.rangePx, halfConeRad: event.halfConeRad,
          yaw: finite(attacker?.angle, finite(attacker?.facing)),
          pitch: deps?.getPlayerMeleeAimPitch?.() || 0,
        })) {
        lastSecondaryStrike = { ratio, skipped: 'second strike missed' };
        return;
      }
      if (typeof deps?.damageCreature !== 'function') {
        lastSecondaryStrike = { ratio, skipped: 'no combat damage owner' };
        return;
      }
      const hitAfflictions = window.CombatAttackEvents?.scaleAfflictions?.(event.afflictionBonuses, ratio)
        || Object.fromEntries(Object.entries(event.afflictionBonuses || {}).map(([id, points]) => [id, points * ratio]));
      const damage = Math.max(0, finite(event.damage) * finite(event.modifiers?.damage, 1) * ratio);
      const knockback = Math.max(0, finite(event.knockbackPxS) * finite(event.modifiers?.knockback, 1) * ratio);
      deps.damageCreature(originalTarget, damage, finite(attacker.x), finite(attacker.y), knockback, {
        abilityId: event.abilityId, afflictionBonuses: hitAfflictions,
        footingDamageMultiplier: finite(event.modifiers?.footingDamage, 1) * ratio,
        feyHypedReplay: true,
      });
      replayCount++;
      lastSecondaryStrike = { ratio, used: amount, target: originalTarget.name || originalTarget.id || 'target', at: Date.now() };
      window.EnchantmentSystem?.logEvent?.('Hyped follow-up ×' + ratio.toFixed(2));
    }, HYPED_REPLAY_DELAY_MS); // One fast second impact; never triggers another chained copy.
  }

  function pointSegmentDistance(x, y, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
  }

  function updatePanicRoll(entity, dt) {
    const roll = panicRolls.get(entity);
    if (!roll) return;
    if (!entity.dodging) { panicRolls.delete(entity); return; }
    if (!roll.boosted) {
      entity.dodgeT = Math.max(0, finite(entity.dodgeT)) * roll.multiplier; // The existing swept roll movement and collision remain authoritative.
      roll.boosted = true; // Never multiply its remaining time twice when Combat.update runs multiple times.
    }
    const nextX = finite(entity.x), nextY = finite(entity.y), step = Math.hypot(nextX - roll.lastX, nextY - roll.lastY);
    roll.elapsedS += dt;
    roll.traveled += step;
    roll.peakStep = Math.max(roll.peakStep, step);
    const deps = window.Combat?.deps;
    const tilePx = Math.max(1, finite(deps?.TILE, 64));
    if (step > 0.01) {
      for (const ally of deps?.companionObjects || []) {
        if (!ally || ally === entity || ally.health <= 0 || roll.hitAllies.has(ally)) continue;
        if (pointSegmentDistance(finite(ally.x), finite(ally.y), roll.lastX, roll.lastY, nextX, nextY) > tilePx * 0.48) continue;
        roll.hitAllies.add(ally);
        rs()?.spendFooting?.(ally, roll.spent, 'panicked roll collision'); // Real instability follows physical contact, not illusory direct damage.
        if (typeof deps?.applyKnockback === 'function') deps.applyKnockback(ally, nextX, nextY, roll.spent * 8, { source: 'fey-panicked-roll' });
        lastEffect = { id: 'panicAllyCollision', ally: ally.name || ally.id || 'companion', panicSpent: roll.spent };
      }
    }
    if (roll.peakStep > tilePx * 0.015 && step < roll.peakStep * 0.06) roll.stalledS += dt;
    else roll.stalledS = 0;
    if (!roll.collided && roll.elapsedS > 0.075 && roll.stalledS >= 0.06) {
      roll.collided = true;
      window.KnockbackCollisionImpact?.resolveStrength?.(entity, {
        kind: 'fallback', label: 'Panicked roll blocked by terrain',
      }, roll.spent * 0.1, tilePx, {}, { mode: 'fey-panicked-roll' }); // Reuses the existing collision-Footing pipeline, without inventing impact Health damage.
      lastEffect = { id: 'panicWallCollision', panicSpent: roll.spent, traveled: roll.traveled };
    }
    roll.lastX = nextX;
    roll.lastY = nextY;
  }

  function update(dt, entity = player()) {
    const deltaS = Math.max(0, Math.min(0.25, finite(dt))); // A long tab pause must not teleport facing or create false collision ticks.
    if (!entity || !(deltaS > 0)) return;
    const state = activeTurns.get(entity);
    if (state) {
      const fraction = Math.min(1, deltaS / Math.max(0.001, state.remainingS));
      const delta = state.remainingRad * fraction; // Linear interpolation distributes each earned degree across the action.
      state.remainingRad -= delta;
      state.remainingS = Math.max(0, state.remainingS - deltaS);
      const angle = finite(entity.angle, finite(entity.facing, 0)) + delta;
      entity.angle = angle;
      if ('facing' in entity) entity.facing = angle;
      if (entity === player()) window.Combat?.deps?.setFacingAngle?.(angle);
      if (state.remainingS <= 0.001) activeTurns.delete(entity);
    }
    updatePanicRoll(entity, deltaS);
  }

  function playerSymptoms() {
    const p = player();
    const resource = rs();
    if (!p || !resource) return [];
    return Object.entries(ICONS).flatMap(([id, icon]) => {
      const amount = finite(resource.getAffliction?.(p, id));
      if (!(amount > 0)) return [];
      return [{
        key: id, label: resource.AFFLICTIONS?.[id]?.name || id, icon,
        kind: id === 'hypedStamina' ? 'boon' : 'bane', stacks: 1,
        sourceLabel: 'Fey · perceived sensation, real behavioral effect',
        description: resource.AFFLICTIONS?.[id]?.desc || '',
        timeBasis: 'conditional', remainingLabel: id === 'hypedStamina' ? 'Until spent' : 'Until perception clears',
        remainingS: 1, durationS: 1,
      }];
    });
  }

  ensureBuffProvider();
  if (!registered && typeof document !== 'undefined') document.addEventListener?.('DOMContentLoaded', ensureBuffProvider, { once: true });
  window.addEventListener?.('hobunjiPlayerReady', ensureBuffProvider);
  window.CombatAttackEvents?.on?.('prepare', prepareHypedAttack);
  window.CombatAttackEvents?.on?.('hit', replayHypedHit);

  window.FeyIllusions = Object.freeze({
    EFFECTS, apply, potency, playerSymptoms, ensureBuffProvider,
    onStaminaSpent, prepareHypedAttack, replayHypedHit, update,
    hasRuntime: entity => !!entity && (activeTurns.has(entity) || panicRolls.has(entity)), // Used by ResourceSystem.tick to skip unmodified actors.
    debugSnapshot: () => ({
      registered, lastEffect, lastSecondaryStrike, replayCount,
      playerTurnRadiansRemaining: activeTurns.get(player())?.remainingRad || 0,
      activePanicRoll: panicRolls.get(player()) ? {
        spent: panicRolls.get(player()).spent, multiplier: panicRolls.get(player()).multiplier,
        traveled: panicRolls.get(player()).traveled, collided: panicRolls.get(player()).collided,
      } : null,
    }),
  });
})();
