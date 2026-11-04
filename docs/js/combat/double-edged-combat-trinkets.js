// Central combat attribution and kill events for double-edged trinkets.
// Adds no loot/source entries; game.js still owns damage, Health, Footing, and death transitions.
(() => {
  'use strict';
  if (window.DoubleEdgedCombatTrinkets) return;
  let lastHit = null; // Mobile diagnostics show the last wearer-authorized weapon hit and each independent modifier.
  let lastKill = null; // Mobile diagnostics confirm exact Stamina/Exhaustion refunds after a team kill.

  function modifier(key) {
    const player = window.Combat?.deps?.player; // ResourceSystem applies the user's actual equipped gear, not simulated enemy gear.
    if (!player) return 1;
    const value = Number(window.ResourceSystem?.statModifier?.(player, key));
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function attackSpeed() {
    return modifier('attackSpeed'); // Shared melee and ranged animation tempo; never changes walking or dodge speed.
  }

  function isWearerWeaponHit(options, fromX, fromY, player) {
    if (!player || options?.friendlyFire || options?.environmental || options?.environmentalImpact || options?.playerAttack === false) return false;
    if (options?.attacker && options.attacker !== player) return false; // Companion/NPC attacks never borrow the wearer's buffs.
    if (options?.attacker === player) return true;
    if (options?.ranged === true && !!options?.rangedItemKey) return true; // Explicit player-shot metadata is authoritative when projectiles originate away from the player's live position.
    return Number.isFinite(fromX) && Number.isFinite(fromY) && Math.hypot(fromX - player.x, fromY - player.y) <= 0.01;
  }

  function outgoingMultipliers(target, options, player) {
    const maxHealth = Math.max(1, Number(window.ResourceSystem?.getEffectiveMax?.(player, 'health')) || Number(player?.maxHealth) || 1); // Berserker threshold uses the actual current Health cap.
    const lowHealth = Number(player?.health) > 0 && Number(player.health) / maxHealth < 0.35; // Checked when the hit lands, not before the attack starts.
    const health = modifier('outgoingHealthDamage')
      * (lowHealth ? modifier('lowHealthDamage') : 1)
      * (target?.prone ? modifier('proneTargetDamage') : 1)
      * (options?.ranged === true ? modifier('rangedDamage') : 1);
    const footing = modifier('outgoingFootingDamage')
      * (options?.heavy === true ? modifier('heavyFootingDamage') : 1);
    const affliction = modifier('outgoingAffliction');
    return { health, footing, affliction, lowHealth };
  }

  function modifyPlayerHit(target, amount, fromX, fromY, knockback, options = {}, next) {
    const player = window.Combat?.deps?.player; // The same reference game.js injects into Combat.init.
    if (!isWearerWeaponHit(options, fromX, fromY, player) || !(Number(amount) > 0)) {
      return next(target, amount, fromX, fromY, knockback, options);
    }
    const multipliers = outgoingMultipliers(target, options, player); // Independent channels avoid Glass Fang accidentally increasing Footing or affliction buildup.
    const normalizedHealth = Math.max(0.0001, multipliers.health); // Restores the original buildup and Footing baseline when raw weapon Health damage is amplified.
    const adjusted = { ...options,
      footingDamageMultiplier: (Number.isFinite(Number(options.footingDamageMultiplier)) ? Number(options.footingDamageMultiplier) : 1)
        * multipliers.footing / normalizedHealth,
    };
    if (options.afflictionBonuses) {
      adjusted.afflictionBonuses = Object.fromEntries(Object.entries(options.afflictionBonuses)
        .map(([id, value]) => [id, (Number(value) || 0) * multipliers.affliction / normalizedHealth]));
    }
    if (options.fixedAfflictionBuildup) {
      adjusted.fixedAfflictionBuildup = Object.fromEntries(Object.entries(options.fixedAfflictionBuildup)
        .map(([id, value]) => [id, (Number(value) || 0) * multipliers.affliction]));
    }
    lastHit = { damageMultiplier: multipliers.health, footingMultiplier: multipliers.footing,
      afflictionMultiplier: multipliers.affliction, heavy: !!options.heavy, ranged: !!options.ranged,
      proneTarget: !!target?.prone, lowHealth: multipliers.lowHealth }; // Testable in the in-game trinket diagnostics.
    return next(target, Number(amount) * multipliers.health, fromX, fromY, knockback, adjusted);
  }

  function onActivity(event) {
    if (event?.type !== 'creature_killed') return;
    if (!event.isBandit && !event.isBarbarian && !event.isPredator) return; // Harvested/passive wildlife does not award combat-only Stamina.
    const player = window.Combat?.deps?.player; // Kill credit is already checked by HobunjiActivityEvents via PlayerDowned.isTeamKill.
    if (!player || !(player.health > 0) || window.PlayerDowned?.isDowned?.()) return;
    const restoreFraction = modifier('killStaminaRestore') - 1; // One Death's Momentum restores 40%; more than one composes without reducing the reward.
    if (!(restoreFraction > 0)) return;
    const maxStamina = Math.max(0, Number(window.ResourceSystem?.getEffectiveMax?.(player, 'stamina')) || 0); // Refund respects Hollow Lungs' reduced maximum.
    const ordinary = maxStamina * restoreFraction; // Used only when the wearer is not Exhausted.
    const black = 100 * restoreFraction; // While Exhausted, repay black debt instead; ordinary Stamina must remain zero.
    const result = window.ResourceSystem?.restoreStamina?.(player, ordinary, { exhaustionAmount: black });
    lastKill = { at: Date.now(), ordinaryRequested: ordinary, blackRequested: black,
      restored: result, enemy: event.creatureKey || event.label || 'enemy' };
  }

  const combat = window.Combat; // Installed after combat-core.js, before the game injects its dependencies.
  if (typeof combat?.init === 'function') {
    const previousInit = combat.init.bind(combat); // Preserve existing combat extensions and skill-training interceptors.
    combat.init = function doubleEdgedTrinketCombatInit(injected) {
      if (injected && typeof injected.damageCreature === 'function' && !injected.damageCreature.__doubleEdgedTrinketHits) {
        const originalDamageCreature = injected.damageCreature; // Last authority for actual damage, Footing, death and combat attribution.
        const wrapped = function doubleEdgedWeaponHit(target, amount, fromX, fromY, knockback, options) {
          return modifyPlayerHit(target, amount, fromX, fromY, knockback, options, (...args) => originalDamageCreature.apply(this, args));
        };
        wrapped.__doubleEdgedTrinketHits = true;
        injected.damageCreature = wrapped;
      }
      return previousInit(injected);
    };
    combat.init.__doubleEdgedTrinkets = true;
  }

  if (window.HobunjiActivityEvents?.on) window.HobunjiActivityEvents.on(onActivity); // Shared kill bus deduplicates deaths and enforces team credit.
  else window.addEventListener?.('hobunji-activity', event => onActivity(event?.detail)); // Fallback only when the registry has not loaded.

  window.DoubleEdgedCombatTrinkets = Object.freeze({
    modifier, attackSpeed, isWearerWeaponHit, outgoingMultipliers, modifyPlayerHit, onActivity,
    debugSnapshot: () => ({ lastHit, lastKill, current: {
      attackSpeed: attackSpeed(), outgoingFooting: modifier('outgoingFootingDamage'),
      incomingFooting: modifier('incomingFootingDamage'), incomingHealth: modifier('incomingHealthDamage'),
      incomingAffliction: modifier('incomingAffliction'), ordinaryStaminaRegen: modifier('ordinaryStaminaRegen'),
    } }),
  });
  window.__doubleEdgedTrinketsDebug = () => window.DoubleEdgedCombatTrinkets.debugSnapshot(); // Phone-friendly on-page diagnostics without developer console.
})();
