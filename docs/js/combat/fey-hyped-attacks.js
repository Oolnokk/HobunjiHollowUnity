// Fey Hyped Stamina: an enhanced-resource payment funds a second, independently
// collision-tested and animated attack at twice the first attack's speed.
// Ability modules retain ownership of their initial swing, mastery and costs.
(() => {
  'use strict';
  if (window.FeyHypedAttacks) return;

  const credits = new WeakMap(); // Attacker -> enhanced Stamina committed to the next matching offensive weapon action.
  const pendingByActor = new WeakMap(); // Attacker -> prepared Hyped attack awaiting the normal staged action owner.
  const replayingActors = new WeakSet(); // Actors locked to the second swing until the staged action's complete/cancel callback.
  const attacks = new Map(); // Attack serial -> first-hit snapshots retained only through the short second strike.
  const MAX_CREDIT_AGE_MS = 12000; // Covers a slow held-charge windup without allowing a stale payment to buff unrelated combat.
  const MIN_SECOND_S = 0.035; // Keeps a valid second-action cadence for zero-duration/instant staged effects.
  let serial = 0; // Unique per-attack marker carried through CombatAttackEvents.hit metadata.
  let replayCount = 0; // Count of actual second strike target hits for mobile Pixel Probe.
  let lastEcho = null; // Last real second-strike result, including cancelled/missed outcomes.
  let bridgeInstalled = false; // True once Combat.beginStagedAction uses the one-time optional feature adapter.

  const numeric = (x, d = 0) => Number.isFinite(Number(x)) ? Number(x) : d;
  const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  const isOffensive = tx => /^(combatCombo|combatQuickAttack|offensiveHeldCharge|offensiveHeldFlurry|combatWeaponAttack)$/.test(String(tx?.actionKind || ''))
    || (!tx?.actionKind && /attack|swing|strike|breaker|flurry|jab|stab|heavy/i.test(String(tx?.reason || '')));
  const actorAlive = actor => actor && numeric(actor.health, 1) > 0;

  function onStaminaSpent(actor, payment, transaction = {}) {
    if (!actor || !isOffensive(transaction)) return;
    const used = (payment?.consumed || []).reduce((sum, line) =>
      sum + (line.id === 'hypedStamina' ? Math.max(0, numeric(line.rawConsumed)) : 0), 0);
    if (!(used > 0)) return;
    const abilityId = String(transaction.abilityId || ''); // Prevents a canceled heavy charge from being inherited by an unrelated quick attack.
    const old = credits.get(actor);
    const reuse = old && old.abilityId === abilityId && old.expiresAt >= now();
    credits.set(actor, {
      used: used + (reuse ? old.used : 0),
      abilityId, expiresAt: now() + MAX_CREDIT_AGE_MS,
    });
  }

  function speedMultiplierForNextAction(actor, abilityId) {
    const credit = actor && credits.get(actor); // Enhanced payment is committed before each authored ability computes its stage timings.
    if (!credit || credit.expiresAt < now() || !(credit.used > 0)) return 1;
    if (credit.abilityId && credit.abilityId !== abilityId) return 1;
    credit.primaryAccelerated = true; // The first and second attack now share the same 2x temporal scaling.
    return 2;
  }

  function clearCredit(actor, abilityId = null) {
    const credit = actor && credits.get(actor);
    if (!credit || (abilityId && credit.abilityId && abilityId !== credit.abilityId)) return false;
    credits.delete(actor);
    return true;
  }

  function prepare(context) {
    const actor = context?.attacker;
    const credit = actor && credits.get(actor);
    if (!credit || credit.expiresAt < now()) return;
    if (credit.abilityId && context.abilityId && credit.abilityId !== context.abilityId) return;
    if (!(context?.rangePx > 0) || !(context?.halfConeRad > 0)) return; // Only melee weapon actions use this staged melee executor.
    credits.delete(actor); // One paid action gets one follow-up, never a stack of free future attacks.
    for (const [id, previous] of attacks) {
      if (now() - previous.createdAt > MAX_CREDIT_AGE_MS) attacks.delete(id); // A canceled pre-stage attack cannot leave strong target refs behind forever.
    }
    const attack = {
      id: ++serial, actor, context, used: credit.used, primaryAccelerated: credit.primaryAccelerated === true,
      createdAt: now(), firstHits: new Map(),
      presentation: null, bound: false, cancelled: false, area: window.Combat?.deps?.getCurrentArea?.() || actor.areaId,
    };
    context.metadata ||= {};
    context.metadata.feyHypedUsed = attack.used;
    context.metadata.feyHypedId = attack.id;
    pendingByActor.set(actor, attack);
    attacks.set(attack.id, attack);
  }

  function onHit(event) {
    const id = numeric(event?.metadata?.feyHypedId);
    const attack = attacks.get(id);
    if (!attack || attack.cancelled || !event?.target || event.metadata?.feyHypedReplay) return;
    attack.firstHits.set(event.target, event); // Keeps target-specific quick bonuses rather than applying one victim's extra afflictions to everyone.
  }

  function attackValid(attack, deps) {
    return !attack.cancelled && actorAlive(attack.actor)
      && !!deps && (!attack.area || deps.getCurrentArea?.() === attack.area)
      && (!deps.currentWeaponKey || deps.currentWeaponKey() === attack.context.weaponKey);
  }

  function replayTarget(attack, target, deps, ratio) {
    const first = attack.firstHits.get(target);
    const mods = first?.modifiers || attack.context.modifiers || {};
    const committedDamage = Number(first?.metadata?.feyPrimaryDamage); // Optional actual first-hit raw damage, after mastery, finisher and mount multipliers.
    const committedKnockback = Number(first?.metadata?.feyPrimaryKnockback); // Optional fully multiplied first-hit knockback.
    const baseDamage = Number.isFinite(committedDamage)
      ? Math.max(0, committedDamage)
      : Math.max(0, numeric(first?.damage, numeric(attack.context.damage)) * numeric(mods.damage, 1));
    const baseKnockback = Number.isFinite(committedKnockback)
      ? Math.max(0, committedKnockback)
      : Math.max(0, numeric(attack.context.knockbackPxS) * numeric(mods.knockback, 1));
    const damage = baseDamage * ratio;
    const knockback = baseKnockback * ratio;
    const rawAfflictions = first?.afflictionBonuses || attack.context.afflictionBonuses;
    const afflictionRatio = first ? ratio : numeric(mods.affliction, 1) * ratio; // First-hit maps already contain mastery/enchantment scaling; never apply it twice.
    const afflictions = window.CombatAttackEvents?.scaleAfflictions?.(rawAfflictions, afflictionRatio)
      || Object.fromEntries(Object.entries(rawAfflictions || {}).map(([id, amount]) => [id, numeric(amount) * afflictionRatio]));
    deps.damageCreature(target, damage, numeric(attack.actor.x), numeric(attack.actor.y), knockback, {
      abilityId: attack.context.abilityId,
      tag: deps.currentWeaponDamageType?.() || 'sharp',
      heavy: !!attack.context.fullCharge || !!attack.context.comboFinisher,
      afflictionBonuses: afflictions,
      footingDamageMultiplier: numeric(mods.footingDamage, 1), // Damage is already ratio-scaled: multiplying Footing again would incorrectly yield ratio squared.
      feyHypedReplay: true, // Never creates another Hyped credit, mastery payout or recursive attack.
    });
    for (const id of ['feyDementedStamina', 'feyPanickedStamina', 'feyTurnabout']) {
      if (window.EnchantmentSystem?.hasBase?.(id, attack.context.weaponKey)) {
        window.FeyIllusions?.apply?.(id, target, {
          weaponKey: attack.context.weaponKey, attacker: attack.actor, effectMultiplier: ratio,
        }); // Secondary illusion buildup and the 10% turning chance both scale by the echo's power.
      }
    }
    replayCount++;
  }

  function beginEcho(attack, firstAction, nativeStaged) {
    const combat = window.Combat, deps = combat?.deps;
    if (!attackValid(attack, deps)) {
      attacks.delete(attack.id);
      lastEcho = { id: attack.id, skipped: 'cancelled, weapon changed or area changed' };
      return;
    }
    const context = attack.context;
    const ratio = Math.max(0, attack.used * 0.02); // The authored uncapped 2% of the first effect per Hyped Stamina point.
    const duration = Math.max(MIN_SECOND_S, numeric(firstAction?.totalS, 0.22) / (attack.primaryAccelerated ? 1 : 2)); // Both swings run at 2x normal speed; legacy untimed owners get a double-speed echo fallback.
    const lead = Math.min(duration, Math.max(0, numeric(firstAction?.windupS) / 2));
    const last = attack.presentation;
    replayingActors.add(attack.actor); // A consecutive double-speed second strike keeps the original player input locked until its recovery completes.
    const visual = last?.options || {
      anim: context.abilityId === 'chargedBreaker' ? 'sweep' : 'thrust',
      pose: window.AttackPoseTemplates?.poseFor?.(context.abilityId === 'chargedBreaker' ? 'hatchet_swing' : 'pickshovel_swing'),
      windupFrac: duration > 0 ? lead / duration : 0.5, strikeFrac: 1,
      coneRangePx: context.rangePx, coneHalfConeRad: context.halfConeRad,
      coneAngle: numeric(context.metadata?.attackAngle, numeric(attack.actor.angle)),
    };
    deps.triggerWeaponSwingVisual?.(duration, {
      ...visual,
      holdS: Math.max(0, numeric(visual.holdS)) / 2,
      coneAngle: numeric(context.metadata?.attackAngle, numeric(attack.actor.angle)),
      afflictions: window.CombatAttackEvents?.scaleAfflictions?.(context.afflictionBonuses, ratio) || {},
    }); // Same authored pose, duration halved: a visibly complete second attack at 2x speed.
    const lunge = Math.max(0, numeric(context.lungePx) * ratio); // The second body's forward effect scales with Hyped strength, too.
    if (lunge > 0) deps.beginCombatLunge?.(lunge, duration, 0, {
      rangePx: context.rangePx, halfConeRad: context.halfConeRad,
    });

    nativeStaged.call(combat, {
      windupS: lead, strikeS: Math.max(0, duration - lead), recoverS: 0,
      data: { feyHypedReplay: true, attacker: attack.actor, silentSfx: true,
        meleeThreat: combat.playerMeleeThreat?.(context.rangePx, context.halfConeRad, {
          yaw: numeric(context.metadata?.attackAngle, numeric(attack.actor.angle)), source: 'Hyped second strike',
        }) },
      onStrike: () => {
        if (!attackValid(attack, combat.deps) || typeof deps.damageCreature !== 'function') return;
        let hits = 0; // Counts real target intersections of this second swing, not copies of the first hit list.
        for (const target of deps.hostileObjects || []) {
          if (!target || numeric(target.health) <= 0 || (attack.area && target.areaId !== attack.area)) continue;
          const connected = combat.meleeHit?.(attack.actor, target, {
            rangePx: context.rangePx, halfConeRad: context.halfConeRad,
            yaw: numeric(context.metadata?.attackAngle, numeric(attack.actor.angle)),
            pitch: deps.getPlayerMeleeAimPitch?.() || 0,
          });
          if (!connected || numeric(target.invulnUntil) > now()) continue;
          replayTarget(attack, target, deps, ratio);
          hits++;
        }
        lastEcho = { at: Date.now(), id: attack.id, used: attack.used, ratio, hits, duration, abilityId: context.abilityId };
      },
      onComplete: () => {
        replayingActors.delete(attack.actor);
        attacks.delete(attack.id);
      },
      onCancel: () => {
        replayingActors.delete(attack.actor);
        attacks.delete(attack.id);
        lastEcho = { id: attack.id, cancelled: true, abilityId: context.abilityId };
      },
    });
  }

  function installCombatBridge() {
    const combat = window.Combat;
    if (!combat || typeof combat.beginStagedAction !== 'function') return false;
    if (combat.beginStagedAction.__feyHypedStageBridge) { bridgeInstalled = true; return true; }
    const nativeStaged = combat.beginStagedAction; // Original stage timing, cancellation and action locks remain authoritative.
    const wrappedStaged = function hypedAwareStagedAction(opts = {}) {
      const actor = combat.deps?.player;
      const attack = actor && pendingByActor.get(actor);
      if (attack && now() - attack.createdAt > 1200) { // Never attach a stale Hyped cost to an unrelated staged attack.
        pendingByActor.delete(actor);
        attacks.delete(attack.id);
        lastEcho = { id: attack.id, skipped: 'prepared stage expired' };
        return nativeStaged.call(this, opts);
      }
      if (!attack || opts?.data?.isBandit || opts?.data?.feyHypedReplay) return nativeStaged.call(this, opts);
      pendingByActor.delete(actor); // Binds exactly the first matching stage after CombatAttackEvents.prepare.
      attack.bound = true;
      const originalComplete = opts.onComplete, originalCancel = opts.onCancel;
      return nativeStaged.call(this, {
        ...opts,
        onComplete: staged => {
          originalComplete?.(staged); // Existing combo/quick attack owner clears busy state before its follow-up begins.
          if (staged.cancelled) { attacks.delete(attack.id); return; }
          beginEcho(attack, staged, nativeStaged);
        },
        onCancel: staged => {
          attack.cancelled = true;
          attacks.delete(attack.id); // A stagger, death, or action lock cancels both swings without free damage.
          originalCancel?.(staged);
        },
      });
    };
    wrappedStaged.__feyHypedStageBridge = true;
    combat.beginStagedAction = wrappedStaged;
    if (typeof combat.init === 'function') {
      const nativeInit = combat.init;
      combat.init = function feyHypedInit(deps) {
        if (deps && typeof deps.triggerWeaponSwingVisual === 'function' && !deps.triggerWeaponSwingVisual.__feyHypedVisualBridge) {
          const nativeVisual = deps.triggerWeaponSwingVisual; // Captures only the normal authored pose for the next Hyped first swing.
          const wrappedVisual = function feyHypedVisual(duration, options) {
            const pending = pendingByActor.get(deps.player);
            if (pending && !pending.presentation) pending.presentation = { duration, options: { ...(options || {}) } };
            return nativeVisual.apply(this, arguments);
          };
          wrappedVisual.__feyHypedVisualBridge = true;
          deps.triggerWeaponSwingVisual = wrappedVisual;
        }
        return nativeInit.apply(this, arguments);
      };
    }
    bridgeInstalled = true;
    return true;
  }

  window.CombatAttackEvents?.on?.('prepare', prepare);
  window.CombatAttackEvents?.on?.('hit', onHit);
  installCombatBridge();
  window.FeyHypedAttacks = Object.freeze({
    onStaminaSpent, prepare, onHit, clearCredit, speedMultiplierForNextAction, installCombatBridge,
    isReplaying: actor => !!actor && replayingActors.has(actor), // Central CombatInput gate prevents other player attacks interrupting the paid two-strike sequence.
    debugSnapshot: () => ({
      bridgeInstalled, replayCount, lastEcho, activeHypedAttacks: attacks.size,
      playerPending: !!pendingByActor.get(window.Combat?.deps?.player),
    }),
  });
})();
