// Game-facing integration for alcohol/drunkenness outside the resource model.
//
// Resource math: combat-core/resource-system
// Body/gait visuals: drunk-locomotion + player-body-transform-composer
// Body-bound attachments: player-body-attachment-bridge
//
// This module owns only blackout timing/safety, drunken movement inertia,
// held food/drink consumption, and adapters to late-created gameplay systems.
(() => {
  'use strict';

  const RS = window.ResourceSystem;
  if (!RS || window.__hobunjiDrunkGameplayBridgeInstalled) return;
  window.__hobunjiDrunkGameplayBridgeInstalled = true;

  const DRUNK_FOOTING_ID = 'drunkenFooting';
  const DRUNK_HEALTH_ID = 'drunkenHealth';
  const DRUNK_RECOVERY_PER_SEC = 0.02;
  const GAME_DAY_SECONDS = 288;
  const GAME_DAY_MINUTES = 16 * 60;
  const FOOTING_SPEED_MUL_MIN = 0.55;
  const STOP_LAMBDA_LIGHT_DRUNK = 9.0;
  const STOP_LAMBDA_MAX_DRUNK = 2.1;
  const BLACKOUT_ACTION_SETTLE_MS = 750;

  let devDeps = null;
  let mountDeps = null;
  let itemDeps = null;
  let inertiaVX = 0;
  let inertiaVY = 0;
  let lastPlayerX = null;
  let lastPlayerY = null;
  let lastPostAt = performance.now();
  let consumeLockUntil = 0;

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  const lerp = (a, b, t) => a + (b - a) * t;

  function approach(current, target, maxDelta) {
    const delta = target - current;
    return Math.abs(delta) <= maxDelta ? target : current + Math.sign(delta) * maxDelta;
  }

  function chainFutureSetter(name, beforeSet, afterSet) {
    const desc = Object.getOwnPropertyDescriptor(window, name);
    const previousSet = desc?.set;
    if (typeof previousSet !== 'function') return false;
    Object.defineProperty(window, name, {
      configurable: true,
      get: desc.get,
      set(value) {
        beforeSet?.(value);
        previousSet.call(window, value);
        afterSet?.(value);
      },
    });
    return true;
  }

  function hookFutureInit(name, onInit) {
    function patch(api) {
      if (!api?.init || api.__drunkGameplayInitHooked) return;
      const originalInit = api.init.bind(api);
      api.init = function drunkGameplayAwareInit(injectedDeps) {
        const result = originalInit(injectedDeps);
        onInit(injectedDeps);
        return result;
      };
      api.__drunkGameplayInitHooked = true;
    }

    if (window[name]) {
      patch(window[name]);
      return;
    }

    const desc = Object.getOwnPropertyDescriptor(window, name);
    if (desc && !desc.configurable) return;
    let value;
    Object.defineProperty(window, name, {
      configurable: true,
      get() { return value; },
      set(next) {
        value = next;
        patch(next);
      },
    });
  }

  // Alchemy is exposed through a future-global setter by combat-core. Preserve
  // that chain and publish the authored potion table under the generic name the
  // held-consumable path expects.
  chainFutureSetter('AlchemySystem', null, api => {
    if (api?.ALCHEMY_POTION_ITEMS) api.POTION_ITEMS = api.ALCHEMY_POTION_ITEMS;
  });

  // DevSpawner's dependency bag contains a few game-owned helpers this adapter
  // needs. Keep the reference private rather than exporting another shared
  // global bag. The separate body-attachment bridge may wrap the same init;
  // each wrapper is additive and preserves the previous one.
  chainFutureSetter('DevSpawner', api => {
    if (!api?.init || api.__drunkenZoneCompatInstalled) return;
    const originalInit = api.init.bind(api);
    api.init = function drunkenZoneCompatInit(injectedDeps) {
      if (injectedDeps && !injectedDeps._isZoneArea) {
        injectedDeps._isZoneArea = area => !!injectedDeps.EXTERIOR_ZONES?.[area];
      }
      if (injectedDeps?.startSceneTransition && !injectedDeps.__drunkTransitionSettleWrapped) {
        const originalStartSceneTransition = injectedDeps.startSceneTransition;
        injectedDeps.startSceneTransition = function drunkSafeSceneTransition(callback) {
          const wait = Math.max(0,
            (Number(window.__hobunjiBlackoutTravelHoldUntil) || 0) - performance.now());
          if (wait > 0) {
            setTimeout(() => originalStartSceneTransition(callback), wait);
            return;
          }
          return originalStartSceneTransition(callback);
        };
        injectedDeps.__drunkTransitionSettleWrapped = true;
      }
      devDeps = injectedDeps;
      return originalInit(injectedDeps);
    };
    api.__drunkenZoneCompatInstalled = true;
  }, null);

  hookFutureInit('Mounts', deps => { mountDeps = deps; });
  hookFutureInit('FarmCrates', deps => { itemDeps = deps; });

  function drunkFootingFraction(player) {
    const max = Math.max(0, Number(player?.maxFooting) || 0);
    return max
      ? clamp01((Number(player?.afflictions?.[DRUNK_FOOTING_ID]) || 0) / max)
      : 0;
  }

  function footingSpeedMuls(player) {
    const max = Math.max(0, Number(player?.maxFooting) || 0);
    if (!max) return { legacy: 1, desired: 1 };
    const footing = Math.max(0, Number(player?.footing) || 0);
    const effectiveMax = Math.max(0, Number(RS.getEffectiveMax?.(player, 'footing')) || 0);
    const legacyFrac = clamp01(footing / max);
    const ordinaryFrac = effectiveMax > 0 ? clamp01(footing / effectiveMax) : 1;
    return {
      legacy: FOOTING_SPEED_MUL_MIN + (1 - FOOTING_SPEED_MUL_MIN) * legacyFrac,
      desired: FOOTING_SPEED_MUL_MIN + (1 - FOOTING_SPEED_MUL_MIN) * ordinaryFrac,
    };
  }

  // Predict blackout before combat-core performs its synchronous travel so an
  // already-started tool action can resolve against its original map grid.
  // Afterwards recover drunken afflictions by the gameplay-time equivalent of
  // the skipped in-world minutes.
  const originalAddDrunkenness = RS.addDrunkenness?.bind(RS);
  if (originalAddDrunkenness && !RS.__blackoutSobrietyRecoveryInstalled) {
    RS.addDrunkenness = function blackoutSobrietyAwareAdd(entity, footingAmount, healthAmount, opts = {}) {
      const player = window.Combat?.deps?.player;
      if (entity === player) {
        const max = Math.max(0, Number(entity?.maxFooting) || 0);
        const before = Math.max(0, Number(entity?.afflictions?.[DRUNK_FOOTING_ID]) || 0);
        const attempted = before + Math.max(0, Number(footingAmount) || 0);
        const willBlackout = max > 0 && attempted >= max && (before < max || attempted > max);
        if (willBlackout) {
          window.__hobunjiBlackoutTravelHoldUntil = Math.max(
            Number(window.__hobunjiBlackoutTravelHoldUntil) || 0,
            performance.now() + BLACKOUT_ACTION_SETTLE_MS
          );
        }
      }

      const result = originalAddDrunkenness(entity, footingAmount, healthAmount, opts);
      if (!result?.blackout || entity !== player) return result;

      const skippedMinutes = Number(window.HobunjiAlcohol?.getDebug?.()?.lastBlackout?.skippedMinutes) || 0;
      const elapsedTickSeconds = skippedMinutes * GAME_DAY_SECONDS / GAME_DAY_MINUTES;
      const recovery = Math.max(0, elapsedTickSeconds * DRUNK_RECOVERY_PER_SEC);
      if (!(recovery > 0)) return result;

      const beforeFootingDrunk = Number(entity.afflictions?.[DRUNK_FOOTING_ID]) || 0;
      RS.removeAffliction(entity, DRUNK_FOOTING_ID, recovery);
      const footingRecovered = Math.max(0,
        beforeFootingDrunk - (Number(entity.afflictions?.[DRUNK_FOOTING_ID]) || 0));
      RS.removeAffliction(entity, DRUNK_HEALTH_ID, recovery);
      if (footingRecovered > 0) {
        entity.footing = Math.min(
          RS.getEffectiveMax(entity, 'footing'),
          (Number(entity.footing) || 0) + footingRecovered
        );
      }
      RS.enforceCaps(entity);
      result.sobrietyRecovered = recovery;
      return result;
    };
    RS.__blackoutSobrietyRecoveryInstalled = true;
  }

  function movementInput() {
    if (!mountDeps) return { active: false, x: 0, y: 0, strength: 0, keyboard: false };
    const keyboard = mountDeps.getKeyboardVector?.() || { active: false, x: 0, y: 0 };
    const x = Number(keyboard.active ? keyboard.x : mountDeps.input?.x) || 0;
    const y = Number(keyboard.active ? keyboard.y : mountDeps.input?.y) || 0;
    const strength = Math.min(1, Math.hypot(x, y));
    return { active: strength > 0.001, x, y, strength, keyboard: !!keyboard.active };
  }

  function terrainSpeedMul(player) {
    const tileSize = Number(devDeps?.TILE) || 55;
    const grid = devDeps?.getActiveGrid?.();
    const col = Math.floor((Number(player?.x) || 0) / tileSize);
    const row = Math.floor((Number(player?.y) || 0) / tileSize);
    const tile = grid?.[row]?.[col];
    if (!tile || tile.incline) return 1;
    return tile.type === 'river' || tile.type === 'stream' ? 0.5 : 1;
  }

  function updateDrunkMomentum(dt) {
    const player = window.Combat?.deps?.player;
    if (!player || !mountDeps) return;

    const drunk = drunkFootingFraction(player);
    const mounted = window.Mounts?.rideState && window.Mounts.rideState !== 'none';
    if (!(drunk > 0) || player.prone || player.climbing || player.lunging || mounted) {
      inertiaVX = inertiaVY = 0;
      lastPlayerX = Number(player.x) || 0;
      lastPlayerY = Number(player.y) || 0;
      return;
    }

    if (window.PlayerChat?.isOpen
      || document.getElementById('npcDialogue')?.classList.contains('open')
      || document.getElementById('menuPanel')?.classList.contains('open')) {
      inertiaVX = inertiaVY = 0;
      return;
    }

    const move = movementInput();
    const { legacy: legacyFootingMul, desired: desiredFootingMul } = footingSpeedMuls(player);

    if (move.active) {
      const analogEase = move.keyboard ? 1 : (0.28 + 0.72 * move.strength);
      const baseSpeed = (Number(mountDeps.MOVE_SPEED) || 238)
        * terrainSpeedMul(player)
        * analogEase
        * (window.Combat?.getMovementSpeedMul?.() ?? 1)
        * (mountDeps.getAlchemySpeedMul?.() ?? window.AlchemySystem?.getSpeedMul?.() ?? 1)
        * (mountDeps.getDevGlobalSpeedMul?.() ?? 1);
      const desiredSpeed = baseSpeed * desiredFootingMul;
      const targetVx = move.x * desiredSpeed;
      const targetVy = move.y * desiredSpeed;
      const accel = Math.max(1, Number(mountDeps.ACCEL) || 980);
      const legacyStep = accel * legacyFootingMul * dt;
      const prechargeX = targetVx + Math.sign(targetVx || move.x) * legacyStep;
      const prechargeY = targetVy + Math.sign(targetVy || move.y) * legacyStep;
      const catchup = accel * dt * 2.25;
      player.vx = approach(Number(player.vx) || 0, prechargeX, catchup);
      player.vy = approach(Number(player.vy) || 0, prechargeY, catchup);
      inertiaVX = targetVx;
      inertiaVY = targetVy;
    } else {
      const decay = Math.exp(-Math.max(
        0.1,
        lerp(STOP_LAMBDA_LIGHT_DRUNK, STOP_LAMBDA_MAX_DRUNK, drunk)
      ) * dt);
      inertiaVX *= decay;
      inertiaVY *= decay;

      let idealSpeed = Math.hypot(inertiaVX, inertiaVY);
      if (idealSpeed < 2) {
        inertiaVX = inertiaVY = 0;
        idealSpeed = 0;
      }

      const px = Number(player.x) || 0;
      const py = Number(player.y) || 0;
      if (lastPlayerX != null
        && Math.hypot(px - lastPlayerX, py - lastPlayerY) < 0.02
        && idealSpeed > 30) {
        inertiaVX = inertiaVY = 0;
        idealSpeed = 0;
      }

      if (idealSpeed > 0) {
        const prechargedSpeed = idealSpeed + Math.max(0, Number(mountDeps.DECEL) || 1850) * dt;
        player.vx = inertiaVX / idealSpeed * prechargedSpeed;
        player.vy = inertiaVY / idealSpeed * prechargedSpeed;
      } else {
        player.vx = player.vy = 0;
      }
    }

    lastPlayerX = Number(player.x) || 0;
    lastPlayerY = Number(player.y) || 0;
  }

  function isPotionOrDrink(key, def) {
    if (!key || !def) return false;
    if (window.AlchemySystem?.POTION_ITEMS?.[key]
      || window.AlchemySystem?.getPotionEffectsFromKey?.(key)) return true;
    const tags = (def.tags || []).map(tag => String(tag).toLowerCase());
    return /\b(alcohol|wine|sake|vodka|nectar|airag|liquor|spirit|potion|drink|tea|juice|milk)\b/
      .test(`${def.label || ''} ${tags.join(' ')}`.toLowerCase());
  }

  function isFood(def) {
    if (!def) return false;
    const tags = (def.tags || []).map(tag => String(tag).toLowerCase());
    if (['crop', 'processed', 'food', 'meal'].includes(String(def.cat || '').toLowerCase())) return true;
    return tags.some(tag => [
      'food', 'meal', 'crop', 'berry', 'fruit', 'vegetable', 'meat', 'noodles', 'cheese', 'curd',
    ].includes(tag));
  }

  // Describes the selected held consumable without mutating inventory.
  // The action bar uses this to make consumption a normal configurable item action.
  function getHeldConsumable() {
    // Held mode changes synchronously when the mobile item dial is released;
    // the rendered plane becomes visible on the following animation frame.
    // Using semantic mode prevents that one-frame delay from caching an empty arch.
    const heldMode = itemDeps?.getHeldMode?.();
    if (heldMode != null ? heldMode !== 'item' : !window.PlayerBodyTransformComposer?.hasVisibleHeldItem?.()) return false;

    const active = itemDeps?.getActiveInventoryItem?.();
    const key = active?.key;
    const def = active;
    const inventory = itemDeps?.inventory;
    if (!key || !def || !inventory || (inventory[key] || 0) < 1) return false;
    if (isPotionOrDrink(key, def)) return { key, def, inventory, kind: 'drink' };
    if (isFood(def)) return { key, def, inventory, kind: 'food' };
    return null;
  }

  function getHeldItemAction() {
    const held = getHeldConsumable();
    if (!held) return null;
    return {
      icon: held.def.icon || (held.kind === 'drink' ? '🥤' : '🍽️'),
      label: `${held.kind === 'drink' ? 'Drink' : 'Eat'} ${held.def.label || held.key}`,
      action: 'consume_held_item',
      style: 'primary',
      allowed: true,
    };
  }

  function consumeHeldItem() {
    if (performance.now() < consumeLockUntil) return false;
    const held = getHeldConsumable();
    if (!held) return false;
    const { key, def, inventory } = held;

    if (held.kind === 'drink') {
      const result = window.AlchemySystem?.drinkPotion?.(key);
      if (!result) return false;
      itemDeps.showToast?.(result.message, result.ok !== false);
      if (result.ok !== false) {
        // Used to retain the just-consumed bottle and lock repeat consumption
        // until its authored raise/drink/return animation has completed.
        const animationMs = Number(itemDeps.triggerHeldDrinkAnimation?.(key)) || 0;
        itemDeps.refreshItemScroll?.();
        itemDeps.buildInventoryGrid?.();
        itemDeps.refreshActionBar?.();
        itemDeps.saveMemberWorldData?.();
        consumeLockUntil = performance.now() + Math.max(180, animationMs);
      } else {
        consumeLockUntil = performance.now() + 180;
      }
      return true;
    }

    inventory[key]--;
    itemDeps.clampInventoryStack?.(key);

    const player = window.Combat?.deps?.player;
    const healthRestore = Number(def.healthRestore ?? def.restoreHealth ?? def.health) || 0;
    const staminaRestore = Number(def.staminaRestore ?? def.restoreStamina ?? def.stamina) || 0;
    if (player && healthRestore > 0) {
      player.health = Math.min(Number(player.maxHealth) || 100,
        (Number(player.health) || 0) + healthRestore);
    }
    if (player && staminaRestore > 0) {
      player.stamina = Math.min(Number(player.maxStamina) || 100,
        (Number(player.stamina) || 0) + staminaRestore);
    }

    itemDeps.showToast?.(`${def.icon || '🍽️'} Ate ${def.label || key}.`, true);
    itemDeps.refreshItemScroll?.();
    itemDeps.buildInventoryGrid?.();
    itemDeps.refreshActionBar?.();
    itemDeps.saveMemberWorldData?.();
    consumeLockUntil = performance.now() + 180;
    return true;
  }

  function blackoutSettling() {
    return performance.now() < (Number(window.__hobunjiBlackoutTravelHoldUntil) || 0);
  }

  // The player is incapacitated during the short blackout action-settle window:
  // do not let a fresh old-grid action be queued just before travel executes.
  document.addEventListener('pointerdown', event => {
    const id = event.target?.closest?.('button')?.id || '';
    if (!blackoutSettling() || !/^btn(?:Item)?Action[1-5]$/.test(id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener('keydown', event => {
    if (!blackoutSettling()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  function postFrameLoop(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - lastPostAt) / 1000));
    lastPostAt = now;
    updateDrunkMomentum(dt);
    requestAnimationFrame(postFrameLoop);
  }

  function startPostFrameLoop() {
    lastPostAt = performance.now();
    requestAnimationFrame(postFrameLoop);
  }

  if (document.readyState === 'complete') startPostFrameLoop();
  else window.addEventListener('load', startPostFrameLoop, { once: true });

  window.HobunjiDrunkGameplayBridge = {
    consumeHeldItem,
    getHeldItemAction,
    getDebug() {
      const player = window.Combat?.deps?.player;
      const muls = footingSpeedMuls(player);
      const composer = window.PlayerBodyTransformComposer?.getDebug?.();
      return {
        drunkFootingFraction: drunkFootingFraction(player),
        legacyFootingSpeedMul: muls.legacy,
        desiredFootingSpeedMul: muls.desired,
        inertiaVX,
        inertiaVY,
        blackoutSettling: blackoutSettling(),
        blackoutTravelHoldUntil: Number(window.__hobunjiBlackoutTravelHoldUntil) || 0,
        hasDevDeps: !!devDeps,
        hasMountDeps: !!mountDeps,
        hasItemDeps: !!itemDeps,
        playerAttached: !!composer?.playerAttached,
        bodyChannels: composer?.channels || [],
      };
    },
  };
})();
