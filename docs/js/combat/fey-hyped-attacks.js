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
  let npcReplayCount = 0; // Count of real NPC second attacks that connect with an independently tested target.
  let creatureReplayCount = 0; // Counts accepted secondary impacts from named wild and companion creature specials.
  let lastCreatureEcho = null; // Most recent creature-special replay, cancellation or invalidated target for mobile diagnostics.
  let lastNpcEcho = null; // On-phone diagnostics for NPC double-strike hit, miss, cancellation and stamina spend.
  let lastEcho = null; // Last real second-strike result, including cancelled/missed outcomes.
  let bridgeInstalled = false; // True once Combat.beginStagedAction uses the one-time optional feature adapter.

  const numeric = (x, d = 0) => Number.isFinite(Number(x)) ? Number(x) : d;
  const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  const isOffensive = tx => /^(combatCombo|combatQuickAttack|offensiveHeldCharge|offensiveHeldFlurry|combatWeaponAttack|combatNpcMelee|combatCreatureSpecial)$/.test(String(tx?.actionKind || ''))
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

  function claimNpcMelee(actor) {
    const paid = actor && credits.get(actor); // Consumes only the NPC's own eligible stamina transaction, never the player's pending attack.
    if (!actor || actor === window.Combat?.deps?.player || !paid || paid.abilityId !== 'npcMelee' || paid.expiresAt < now()) return null;
    credits.delete(actor); // This one payment funds both stages of exactly one NPC melee action.
    return Object.freeze({ used: paid.used, ratio: paid.used * 0.02, tempo: 2 });
  }

  function claimCreatureSpecial(actor) {
    const paid = actor && credits.get(actor); // Each wild/companion attack claims only its own recently paid special, never the player's staged weapon attack.
    if (!actor || actor === window.Combat?.deps?.player || !paid || paid.abilityId !== 'creatureSpecial' || paid.expiresAt < now()) return null;
    credits.delete(actor); // The original plus one replay share this single ResourceSystem payment.
    return Object.freeze({ used: paid.used, ratio: paid.used * 0.02, tempo: 2 });
  }

  function creatureEffectRatio(actor) {
    const echo = actor?._animalAttack?.hyped; // The original attack deals its full authored effect; only a committed second stage is reduced.
    return echo?.phase === 1 ? Math.max(0, numeric(echo.ratio)) : 1;
  }

  function creatureDamagePayload(actor, damage, knockback, opts = {}) {
    if (actor?._animalAttack?.hyped?.phase !== 1) return null; // Normal attack/first stage: no maps or extra objects allocated in the hot path.
    const ratio = creatureEffectRatio(actor); // Exactly 50 Hyped points means 100% echo power, but it is STILL a distinct replay for hit counts/proc safety.
    const source = opts || {};
    const scaleMap = map => map && Object.fromEntries(Object.entries(map).map(([key, value]) => [key, Math.max(0, numeric(value)) * ratio]));
    return {
      damage: Math.max(0, numeric(damage)) * ratio,
      knockback: Math.max(0, numeric(knockback)) * ratio,
      opts: {
        ...source,
        afflictionBonuses: scaleMap(source.afflictionBonuses),
        fixedAfflictionBuildup: scaleMap(source.fixedAfflictionBuildup),
        feyHypedReplay: true, // The second physical creature special never creates another credit or replays a third time.
      },
    };
  }

  function noteCreatureEcho(actor, status, specialId, hype, hits = 0) {
    lastCreatureEcho = { actor: actor?.name || actor?.creatureKey || actor?.id || 'creature',
      status, specialId, used: hype?.used || 0, ratio: hype?.ratio || 0, hits };
    if (status === 'finished') creatureReplayCount += hits;
  }

  function npcDamagePayload(actor, target, damage, knockback, opts = {}) {
    const sequence = actor?._feyHypedNpcSequence; // Only NPCs whose actual staged attack spent Hyped take this path.
    if (!sequence) return null;
    if (!sequence.echo) {
      sequence.firstHit = { target, damage, knockback, opts: {
        ...opts,
        afflictionBonuses: { ...(opts.afflictionBonuses || {}) },
        fixedAfflictionBuildup: { ...(opts.fixedAfflictionBuildup || {}) },
      } }; // Snapshot the committed mastery/quick/weapon modifiers before the second independently collision-tested strike.
      return null;
    }
    const primary = sequence.firstHit?.target === target ? sequence.firstHit : null;
    const source = primary || { damage, knockback, opts };
    const base = source.opts || {};
    const scaledAfflictions = window.CombatAttackEvents?.scaleAfflictions?.(base.afflictionBonuses, sequence.ratio)
      || Object.fromEntries(Object.entries(base.afflictionBonuses || {}).map(([id, value]) => [id, numeric(value) * sequence.ratio]));
    sequence.echoHits++;
    npcReplayCount++;
    return {
      damage: Math.max(0, numeric(source.damage)) * sequence.ratio,
      knockback: Math.max(0, numeric(source.knockback)) * sequence.ratio,
      opts: {
        ...base, afflictionBonuses: scaledAfflictions,
        fixedAfflictionBuildup: Object.fromEntries(Object.entries(base.fixedAfflictionBuildup || {})
          .map(([id, value]) => [id, numeric(value) * sequence.ratio])),
        feyHypedReplay: true, // Secondary strikes never spend more Stamina or manufacture an additional pair.
      },
    };
  }

  function beginNpcMelee(actor, opts, payment) {
    const combat = window.Combat;
    if (!payment || typeof combat?.beginStagedAction !== 'function') return combat?.beginStagedAction?.(opts);
    const activeArea = actor.areaId; // A removed/repositioned NPC cannot land a second swing in a later map.
    const intendedTarget = opts.feyHypedNpcTarget; // Same committed NPC target; the independent second cone must not hit an actor moved to another area.
    const sequence = { ratio: payment.ratio, used: payment.used, echo: false, echoHits: 0, firstHit: null };
    const originalStrike = opts.onStrike, originalComplete = opts.onComplete, originalCancel = opts.onCancel;
    const npcLive = () => numeric(actor.health, 1) > 0 && (!activeArea || actor.areaId === activeArea)
      && actor._feyHypedNpcSequence === sequence;
    const clean = () => {
      if (actor._feyHypedNpcSequence === sequence) delete actor._feyHypedNpcSequence;
      sequence.firstHit = null; // Avoid keeping the previous duel target alive via a completed strike.
    };
    actor._feyHypedNpcSequence = sequence; // Existing NPC damage authority consults it only during this attack's two staged strikes.
    const duration = {
      windupS: Math.max(0.001, numeric(opts.windupS) / payment.tempo),
      strikeS: Math.max(0.001, numeric(opts.strikeS) / payment.tempo),
      recoverS: Math.max(0, numeric(opts.recoverS) / payment.tempo),
    }; // The NPC's current SharedAttackPose timeline and its subsequent copy both run at twice the authored speed.
    const firstOpts = {
      ...opts, ...duration,
      onComplete: first => {
        if (!npcLive()) {
          clean();
          originalComplete?.(first);
          lastNpcEcho = { used: payment.used, skipped: 'actor died, left area or changed attack' };
          return;
        }
        sequence.echo = true; // Original onStrike still owns independent real-time NPC meleeHit and conditional bonuses.
        sequence.echoHits = 0;
        actor.telegraphState = 'windup';
        opts.onFeyHypedNpcEchoStart?.(sequence.ratio); // The original NPC lunge owner may add a new, scaled and swept movement impulse for the second physical strike.
        const second = combat.beginStagedAction({
          ...opts, ...duration,
          data: { ...(opts.data || {}), feyHypedNpcEcho: true },
          onStrike: stage => { if (npcLive() && (!intendedTarget || (numeric(intendedTarget.health) > 0 && (!activeArea || !intendedTarget.areaId || intendedTarget.areaId === activeArea)))) originalStrike?.(stage); }, // Unloaded/dead targets cannot be damaged by a stale echo.
          onComplete: stage => {
            const hits = sequence.echoHits;
            clean();
            originalComplete?.(stage); // Cooldown, combo chaining and authored swing settle happen only after the second stage.
            lastNpcEcho = { used: payment.used, ratio: payment.ratio, hits, ability: opts.data?.voiceAbilityId || opts.data?.comboId || 'npcMelee' };
          },
          onCancel: stage => {
            clean();
            originalCancel?.(stage);
            lastNpcEcho = { used: payment.used, cancelled: true };
          },
        });
        actor._banditAction = second; // EnemyWeaponStances/SharedAttackPose remain the single pose and animation owner.
        if (actor._banditSwingWindupCurve) actor._banditSwingWindupCurve.action = second; // A charged NPC repeats its existing partial-windup curve on the second strike.
      },
      onCancel: stage => {
        clean();
        originalCancel?.(stage); // No phantom hit if the NPC is staggered or its first stage is canceled.
        lastNpcEcho = { used: payment.used, cancelled: true };
      },
    };
    const first = combat.beginStagedAction(firstOpts);
    if (first?.cancelled) clean();
    return first;
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
    const applied = deps.damageCreature(target, damage, numeric(attack.actor.x), numeric(attack.actor.y), knockback, {
      attacker: attack.actor, // Explicit replay owner for damage and collision attribution.
      abilityId: attack.context.abilityId,
      tag: deps.currentWeaponDamageType?.() || 'sharp',
      heavy: !!attack.context.fullCharge || !!attack.context.comboFinisher,
      afflictionBonuses: afflictions,
      footingDamageMultiplier: numeric(mods.footingDamage, 1), // Damage is already ratio-scaled: multiplying Footing again would incorrectly yield ratio squared.
      feyHypedReplay: true, // Never creates another Hyped credit, mastery payout or recursive attack.
    });
    if (applied === false) return false; // A real rejected melee/iframes block must also suppress its secondary Fey procs.
    for (const id of ['feyDementedStamina', 'feyPanickedStamina', 'feyTurnabout']) {
      if (window.EnchantmentSystem?.hasBase?.(id, attack.context.weaponKey)) {
        window.FeyIllusions?.apply?.(id, target, {
          weaponKey: attack.context.weaponKey, attacker: attack.actor, effectMultiplier: ratio,
        }); // Secondary illusion buildup and the 10% turning chance both scale by the echo's power.
      }
    }
    replayCount++;
    return true;
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
          if (replayTarget(attack, target, deps, ratio)) hits++; // Counts only a second impact admitted by the real damage authority.
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
    onStaminaSpent, prepare, onHit, clearCredit, claimNpcMelee, npcDamagePayload, beginNpcMelee,
    claimCreatureSpecial, creatureEffectRatio, creatureDamagePayload, noteCreatureEcho,
    speedMultiplierForNextAction, installCombatBridge,
    isReplaying: actor => !!actor && replayingActors.has(actor), // Central CombatInput gate prevents other player attacks interrupting the paid two-strike sequence.
    debugSnapshot: () => ({
      bridgeInstalled, replayCount, lastEcho, npcReplayCount, lastNpcEcho, creatureReplayCount, lastCreatureEcho, activeHypedAttacks: attacks.size,
      playerPending: !!pendingByActor.get(window.Combat?.deps?.player),
    }),
  });
})();
