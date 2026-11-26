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
  const activeTurns = new WeakMap(); // Actor -> uncommitted angular drift, advanced by ResourceSystem.tick.
  const perceivedYaw = new WeakMap(); // Player -> accumulated camera and movement-basis offset without rewriting the user's own camera controls.
  const panicRolls = new WeakMap(); // Actor -> one in-flight roll, including its collision/ally hit deduplication.
  let registered = false; // Prevents multiple providers in tool previews.
  let lastEffect = null; // Most recent actual illusion or triggered response for mobile diagnostics.

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
    const power = Math.max(0, finite(options.effectMultiplier, 1)); // A Hyped echo scales both illusion buildup and the probability of a sensory turn.
    if (!effect || !target || !(finite(target.health) > 0) || !resource || !potency(options.weaponKey) || !power) return false;
    ensureBuffProvider();
    let applied = false;
    if (effect.chance != null) {
      applied = rng() < Math.min(1, effect.chance * power) && turnTargetAround(target); // Independent seeded 10% roll, scaled by the second attack's Hyped power.
    } else {
      const recipient = effect.grant ? (options.attacker || target) : target;
      const idToApply = effect.grant || effect.affliction;
      const amount = effect.grant
        ? resource.addEnhancedResource?.(recipient, idToApply, effect.buildup * power, { reason: 'Fey: ' + id })
        : resource.addAffliction?.(recipient, idToApply, effect.buildup * power);
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
    window.FeyHypedAttacks?.onStaminaSpent?.(entity, payment, transaction); // Dedicated staged-attack owner consumes Hyped only for actually completed weapon actions.
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

  function pointSegmentDistance(x, y, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
  }

  function onDodgeBlocked(entity, collision = {}) {
    const roll = entity && panicRolls.get(entity); // Handles the actual rejected swept move, rather than detecting a fake wall from a slowing movement.
    if (!roll || roll.collided) return false;
    roll.collided = true;
    const tilePx = Math.max(1, finite(window.Combat?.deps?.TILE, 64)); // Existing resource collision owner expects an impact deficit in tile units.
    const strengthTiles = collision.remainingPx > 0
      ? collision.remainingPx / tilePx : roll.spent * 0.1; // Missing caller metadata retains the documented legacy test fallback.
    const descriptor = collision.descriptor || { kind: 'stone', label: 'Panicked roll blocked by terrain' }; // A real sweep can identify wood, stone or fire.
    window.KnockbackCollisionImpact?.resolveStrength?.(
      entity, descriptor, strengthTiles, tilePx, collision.hooks || {}, { mode: 'fey-panicked-roll' }
    ); // Uses the same physical Health/Footing/affliction profiles and hooks as knocked-back movement.
    entity.dodgeT = 0; // A solid collision stops the rest of the uncontrolled roll, as ordinary blocked knockback does.
    if (entity._enemyDodge) entity._enemyDodge.remainingS = 0;
    lastEffect = { id: 'panicWallCollision', panicSpent: roll.spent, traveled: roll.traveled,
      material: descriptor.kind || 'stone', impactTiles: strengthTiles };
    return true;
  }

  function setActionDuration(entity, durationS) {
    const turn = entity && activeTurns.get(entity); // Only active hallucinated rotation needs its actual combat action timeline.
    const actualS = finite(durationS);
    if (!turn || !(actualS > 0)) return false;
    turn.remainingS = Math.max(0.001, actualS); // Replaces the .22s fallback with the exact authored windup/strike duration.
    return true;
  }

  function onDodgeStarted(entity) {
    const roll = entity && panicRolls.get(entity); // Pending panic is created by the real ResourceSystem stamina payment.
    if (!roll || !entity.dodging || roll.boosted) return false;
    entity.dodgeT = Math.max(0, finite(entity.dodgeT)) * roll.multiplier; // Scale the full authored duration BEFORE any movement step, not after the first frame.
    if (entity._enemyDodge) {
      entity._enemyDodge.durationS *= roll.multiplier; // AI dodge owns its remaining swept movement clock separately.
      entity._enemyDodge.remainingS *= roll.multiplier;
    }
    roll.boosted = true; // The same charge can never multiply a reused dodge state twice.
    setActionDuration(entity, entity.dodgeT); // Panicked travel and Demented camera rotation share the final dodge's actual timeline.
    return true;
  }

  function updatePanicRoll(entity, dt) {
    const roll = panicRolls.get(entity);
    if (!roll) return;
    if (!entity.dodging) { panicRolls.delete(entity); return; }
    onDodgeStarted(entity); // Safe fallback for older callers that don't report an explicit dodge start.
    const nextX = finite(entity.x), nextY = finite(entity.y), step = Math.hypot(nextX - roll.lastX, nextY - roll.lastY);
    roll.elapsedS += dt;
    roll.traveled += step;
    roll.peakStep = Math.max(roll.peakStep, step);
    const deps = window.Combat?.deps;
    const tilePx = Math.max(1, finite(deps?.TILE, 64));
    if (step > 0.01) {
      const playerSide = entity === player() || (entity.isCompanion && !entity.banditCompanion); // Choose the correct faction's pool, not every creature called a companion.
      const candidates = playerSide ? (deps?.companionObjects || [])
        : [...(deps?.hostileObjects || []), ...(deps?.companionObjects || [])]; // Enemy campmates and their owned pets can also be struck by friendly panic.
      for (const ally of candidates) {
        if (!ally || ally === entity || ally.health <= 0 || roll.hitAllies.has(ally)) continue;
        const sameSide = window.Combat?.attach?.isRescueAlly?.(entity, ally)
          ?? (playerSide && ally.isCompanion !== false && !ally.banditCompanion); // Use the existing swarm-rescue faction policy when available.
        if (!sameSide) continue; // Panicked foes must never strike the player's pets as though they were their own allies.
        if (pointSegmentDistance(finite(ally.x), finite(ally.y), roll.lastX, roll.lastY, nextX, nextY) > tilePx * 0.48) continue;
        roll.hitAllies.add(ally);
        rs()?.spendFooting?.(ally, roll.spent, 'panicked roll collision'); // Real instability follows physical contact, not illusory direct damage.
        if (typeof deps?.applyKnockback === 'function') deps.applyKnockback(ally, nextX, nextY, roll.spent * 8, { source: 'fey-panicked-roll' });
        lastEffect = { id: 'panicAllyCollision', ally: ally.name || ally.id || 'companion', panicSpent: roll.spent };
      }
    }
    // Blocked movement is reported synchronously by the authoritative swept
    // collision owner. A slow roll or an animation pause is not a wall impact.
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
      if (entity === player()) {
        perceivedYaw.set(entity, finite(perceivedYaw.get(entity)) + delta); // Camera and compositor consume the same perceived steering yaw.
      } else {
        perceivedYaw.set(entity, finite(perceivedYaw.get(entity)) + delta); // AI navigation intent is world-space; the shared compositor applies this yaw once.
        const angle = finite(entity.angle, finite(entity.facing, 0)) + delta;
        entity.angle = angle;
        if ('facing' in entity) entity.facing = angle;
      }
      if (state.remainingS <= 0.001) activeTurns.delete(entity);
    }
    // Perceptual distortion fades smoothly after the hallucination clears;
    // it never changes or permanently overwrites the player's camera setting.
    if (!activeTurns.has(entity) && !(finite(rs()?.getAffliction?.(entity, 'dementedStamina')) > 0)) {
      const currentYaw = finite(perceivedYaw.get(entity));
      if (Math.abs(currentYaw) > 0.00001) {
        const nextYaw = currentYaw * Math.exp(-deltaS * 5);
        if (Math.abs(nextYaw) <= 0.00001) perceivedYaw.delete(entity);
        else perceivedYaw.set(entity, nextYaw);
      }
    }
    updatePanicRoll(entity, deltaS);
  }

  function movementRotationRad(entity) {
    return finite(perceivedYaw.get(entity)); // Shared compositor rotates player and AI world-space steering; committed attack rays retain their aim.
  }

  function cameraYawDeg(entity) {
    return entity === player() ? -movementRotationRad(entity) / DEG_TO_RAD : 0; // The camera's azimuth is opposite to its world-space forward bearing.
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

  window.FeyIllusions = Object.freeze({
    EFFECTS, apply, potency, playerSymptoms, ensureBuffProvider,
    onStaminaSpent, onDodgeStarted, setActionDuration, onDodgeBlocked, update,
    movementRotationRad, cameraYawDeg,
    isPanickedRolling: entity => !!entity && panicRolls.has(entity), // Allows game.js to skip obstacle classification during entirely ordinary dodges.
    hasRuntime: entity => !!entity && (activeTurns.has(entity) || panicRolls.has(entity)
      || (Math.abs(finite(perceivedYaw.get(entity))) > 0.00001)), // Used by ResourceSystem.tick to skip unmodified actors.
    debugSnapshot: () => ({
      registered, lastEffect, hype: window.FeyHypedAttacks?.debugSnapshot?.() || null,
      playerTurnRadiansRemaining: activeTurns.get(player())?.remainingRad || 0,
      cameraMovementYawDeg: cameraYawDeg(player()), // Mobile probe confirms the actual additive gameplay-camera and locomotion basis.
      activePanicRoll: panicRolls.get(player()) ? {
        spent: panicRolls.get(player()).spent, multiplier: panicRolls.get(player()).multiplier,
        traveled: panicRolls.get(player()).traveled, collided: panicRolls.get(player()).collided,
      } : null,
    }),
  });
})();
