// Oddclaw's per-exercise state for Spearhead's practice arena (pause, reset,
// per-frame lesson conditions). Extracted from game.js's CombatTutorial.init
// deps; spawning/removal stay in game.js because they own scene collections.
(() => {
  'use strict';
  let tile = 32; // Replaced by game.js's TILE during init.
  function init(deps) { tile = deps.TILE; }
  function pause(target) {
    if (!target) return;
    target.combatTutorialHostile = false;
    target._banditAction?.cancel(); target._banditAction = null;
    target.telegraphState = null; target._banditLunging = false;
    target.vx = 0; target.vy = 0;
  }
  function reset(target, lesson, practice) {
    if (!target) return;
    target.x = (practice?.c ?? 10.5) * tile; target.y = (practice?.r ?? 11.5) * tile;
    target.facing = Math.PI / 2; target.state = 'idle';
    target.attackCooldownT = 1.5; target._banditComboIndex = 0;
    target.knockbackT = 0; target.knockbackVX = 0; target.knockbackVY = 0;
    target.prone = false; target.exhaustion = { active: false, blackStamina: 100 };
    target.maxHealth = lesson?.preview ? 100 : 10000; target.health = target.maxHealth;
    target.afflictions = {}; target._rangedAmmoDebuffs = {};
    target.footing = target.maxFooting; target.stamina = target.maxStamina;
  }
  function maintain(target, lesson) {
    target.combatTutorialPreview = !!lesson?.preview; // Preserve real damage, afflictions and movement while comparing upgrade effects.
    target.combatTutorialAttackWindow = window.Combat?.attackOpportunityPhase?.(target)
      || target._banditAction?.phase
      || target.telegraphState
      || null; // Mobile/debug reports expose the exact shared Quick Attack opportunity phase without devtools.
    if (!lesson?.preview) {
      target.health = lesson?.condition === 'lowHealth' ? 2000 : target.maxHealth; target.afflictions = {};
      target.footing = target.maxFooting; target.prone = false;
      target.stamina = lesson?.condition === 'exhausted' ? 0 : target.maxStamina;
      target.exhaustion = { active: lesson?.condition === 'exhausted', blackStamina: 100 };
    }
    if (!target.combatTutorialHostile && !lesson?.preview) {
      target.knockbackT = 0; target.knockbackVX = 0; target.knockbackVY = 0;
      target.staggered = { active: false, endsAt: 0 };
    }
  }
  window.CombatTutorialPartner = { init, pause, reset, maintain };
})();

// Shared Quick Attack condition contract.
//
// All combatants now expose the same four condition semantics. The shared
// staged-action wrapper mirrors offensive windup/strike timing onto the actor,
// including the player, while generic creature telegraphs and modular animal
// attacks continue to participate through their existing public state.
(() => {
  'use strict';
  const combat = window.Combat; // Existing combat namespace patched before game.js begins ticking combat.
  if (!combat?.beginStagedAction || !combat?.update || combat.__quickAttackConditionContractInstalled) return;

  const trackedByActor = new WeakMap(); // Offensive staged actions keyed by their owning player/enemy actor.
  const trackedActors = new Set(); // Iterable actor set used to synchronize opportunity phases after Combat.update().
  const originalBeginStagedAction = combat.beginStagedAction.bind(combat); // Preserves every existing staged-action wrapper already installed.
  const originalCombatUpdate = combat.update.bind(combat); // Preserves core combat ticking before condition synchronization.

  function finite(value, fallback = 0) {
    const number = Number(value); // Numeric normalization shared by positions/resources/facing.
    return Number.isFinite(number) ? number : fallback;
  }

  function actorFacing(actor) {
    if (!actor) return 0;
    if (actor === combat.deps?.player && Number.isFinite(Number(actor.angle))) return Number(actor.angle);
    if (Number.isFinite(Number(actor.facing))) return Number(actor.facing);
    return Number.isFinite(Number(actor.angle)) ? Number(actor.angle) : 0;
  }

  function actionPhase(action) {
    if (!action || action.cancelled || action.phase === 'done') return null;
    const elapsed = Math.max(0, finite(action.t)); // Live staged-action clock used instead of relying on its legacy phase label.
    const windupS = Math.max(0, finite(action.windupS)); // Boundary before the attack becomes an active strike.
    const strikeS = Math.max(0, finite(action.strikeS)); // Length of the actual Opportunist-valid strike window.
    if (elapsed < windupS) return 'windup';
    if (elapsed < windupS + strikeS) return 'strike';
    return 'recover';
  }

  function isOffensiveStagedAction(options) {
    const data = options?.data; // Staged metadata distinguishes real attacks from defensive/non-damaging timers.
    return !!(data?.meleeThreat || data?.isBandit || data?.attackOpportunity);
  }

  function stagedOwner(options) {
    if (!isOffensiveStagedAction(options)) return null;
    const data = options?.data; // Enemy executors provide attacker explicitly; player melee uses the singleton combat deps.
    return data?.attacker || combat.deps?.player || null;
  }

  function untrack(actor, action) {
    const actions = trackedByActor.get(actor); // Current offensive staged actions for this combatant.
    if (!actions) return;
    actions.delete(action);
    if (!actions.size) {
      trackedByActor.delete(actor);
      trackedActors.delete(actor);
    }
  }

  function trackedOpportunityPhase(actor) {
    const actions = trackedByActor.get(actor); // Concurrent attacks are rare; the most immediately dangerous phase wins.
    if (!actions?.size) return null;
    let sawRecover = false;
    let sawWindup = false;
    for (const action of [...actions]) {
      const phase = actionPhase(action);
      if (!phase) { untrack(actor, action); continue; }
      if (phase === 'strike') return 'strike';
      if (phase === 'windup') sawWindup = true;
      else if (phase === 'recover') sawRecover = true;
    }
    return sawWindup ? 'windup' : (sawRecover ? 'recover' : null);
  }

  function modularAnimalPhase(actor) {
    if (!actor) return null;
    if (combat.animalAttacks?.isStriking?.(actor)) return 'strike';
    if (combat.animalAttacks?.isWindingUp?.(actor)) return 'windup';
    return null;
  }

  function attackOpportunityPhase(actor) {
    if (!actor) return null;
    const tracked = trackedOpportunityPhase(actor); // Shared staged attacks include player, humanoids, liches, and other modular attackers.
    if (tracked) return tracked;
    if (actor.telegraphState === 'strike' || actor.telegraphState === 'windup') return actor.telegraphState;
    const banditPhase = actionPhase(actor._banditAction); // Compatibility for an already-started humanoid action created before this wrapper installed.
    if (banditPhase) return banditPhase;
    return modularAnimalPhase(actor);
  }

  function syncActorOpportunity(actor) {
    if (!actor) return;
    const phase = trackedOpportunityPhase(actor); // Staged phase is mirrored for legacy readers such as combat-quickattacks.js.
    actor._quickAttackOpportunityPhase = phase;
    if (phase === 'windup' || phase === 'strike') {
      actor.telegraphState = phase;
      actor._quickAttackOpportunityOwnsTelegraph = true;
      return;
    }
    if (actor._quickAttackOpportunityOwnsTelegraph) {
      if (actor.telegraphState === 'windup' || actor.telegraphState === 'strike') actor.telegraphState = null;
      actor._quickAttackOpportunityOwnsTelegraph = false;
    }
  }

  combat.beginStagedAction = function quickConditionTrackedBeginStagedAction(options = {}) {
    const owner = stagedOwner(options); // Actor whose attack window should become visible to Quick Attack conditions.
    const action = originalBeginStagedAction(options);
    if (!owner || !action || action.phase === 'done' || action.cancelled) return action;

    let actions = trackedByActor.get(owner); // Per-actor set supports rare overlapping staged actions without losing the earlier one.
    if (!actions) {
      actions = new Set();
      trackedByActor.set(owner, actions);
      trackedActors.add(owner);
    }
    actions.add(action);

    const originalCancel = action.cancel?.bind(action); // Cancellation must clear the condition immediately rather than one frame later.
    if (originalCancel) {
      action.cancel = () => {
        originalCancel();
        untrack(owner, action);
        syncActorOpportunity(owner);
      };
    }
    syncActorOpportunity(owner);
    return action;
  };
  combat.beginStagedAction.__hobunjiQuickAttackConditionContract = true;

  combat.update = function quickConditionTrackedCombatUpdate(dt) {
    const result = originalCombatUpdate(dt);
    for (const actor of [...trackedActors]) syncActorOpportunity(actor);
    return result;
  };
  combat.update.__hobunjiQuickAttackConditionContract = true;

  function depletionCurrent(target, resource) {
    const adjusted = window.ResourceSystem?.getDepletionEquivalentCurrent?.(target, resource); // Canonical visible/usable resource reading including affliction bands and max reducers.
    if (Number.isFinite(Number(adjusted))) return Number(adjusted);
    return finite(target?.[resource]);
  }

  function getQuickAttackConditions(deps, target, attacker = deps?.player) {
    if (!target || !attacker) return { enemyStriking: false, exhausted: false, behind: false, lowHealth: false };
    const dx = finite(attacker.x) - finite(target.x); // Target-to-attacker vector used to decide whether the attacker is behind the target.
    const dy = finite(attacker.y) - finite(target.y); // World Y here is the game's horizontal map axis, matching existing combat math.
    const distance = Math.max(0.001, Math.hypot(dx, dy));
    const facing = actorFacing(target); // Player uses angle; creatures/humanoids use facing.
    const behindDot = Math.cos(facing) * (dx / distance) + Math.sin(facing) * (dy / distance);
    const staminaForCondition = depletionCurrent(target, 'stamina'); // Exhaust Cutter reads the effective visible/usable Stamina state.
    const healthForCondition = depletionCurrent(target, 'health'); // Mercy Spike reads pre-impact effective visible/usable Health.
    const maxStamina = Math.max(0, finite(target.maxStamina)); // Authored maximum remains the depletion threshold baseline, preserving max-reducer semantics.
    const maxHealth = Math.max(0, finite(target.maxHealth)); // Authored maximum remains the low-Health threshold baseline.
    const attackWindow = attackOpportunityPhase(target); // Opportunist is true only during windup/strike, never recovery/idle.
    const conditions = {
      enemyStriking: attackWindow === 'windup' || attackWindow === 'strike',
      exhausted: !!target.exhaustion?.active || (maxStamina > 0 && staminaForCondition <= maxStamina * 0.20),
      behind: behindDot < -0.35,
      lowHealth: finite(target.health) > 0 && maxHealth > 0 && healthForCondition <= maxHealth * 0.30,
    };

    if (combat.quickAttackData) {
      combat.quickAttackData.lastConditionCheck = { // Mobile-readable audit of every condition, not only the resource-gated pair.
        targetId: target.id || target.name || null,
        attackerId: attacker.id || attacker.name || (attacker === deps?.player ? 'player' : null),
        rawStamina: finite(target.stamina),
        staminaForCondition,
        rawHealth: finite(target.health),
        healthForCondition,
        effectiveStaminaMax: window.ResourceSystem?.getEffectiveMax?.(target, 'stamina') ?? target.maxStamina,
        effectiveHealthMax: window.ResourceSystem?.getEffectiveMax?.(target, 'health') ?? target.maxHealth,
        targetFacing: facing,
        behindDot,
        attackWindow: attackWindow || 'idle',
        ...conditions,
      };
    }
    return conditions;
  }

  combat.attackOpportunityPhase = attackOpportunityPhase;
  combat.getQuickAttackConditions = getQuickAttackConditions;
  if (combat.quickAttackData) combat.quickAttackData.getConditions = getQuickAttackConditions;
  combat.__quickAttackConditionContractInstalled = true;
})();
