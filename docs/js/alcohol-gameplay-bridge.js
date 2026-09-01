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
  const DEFAULT_SWIGS_PER_BOTTLE = 4;
  const NPC_MAX_SOBRIETY = 100;
  const BLACKOUT_MIN_SKIP_MINUTES = 30;
  const BLACKOUT_MINUTES_PER_PERCENT = 10;
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
  let bottleSwigs = {}; // Persisted by game.js; stores the remaining swigs in each stack's currently open bottle.
  let npcAlcoholState = {}; // Persisted by game.js; stores NPC sobriety and no-teleport blackout deadlines.

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  const lerp = (a, b, t) => a + (b - a) * t;

  function isAlcoholDef(def) {
    if (!def) return false;
    const tags = (def.tags || []).map(tag => String(tag).toLowerCase());
    return /\b(alcohol|wine|sake|vodka|nectar|airag|liquor|spirits?|beer|ale|mead|cider)\b/
      .test(`${def.label || ''} ${tags.join(' ')}`.toLowerCase());
  }

  function swigsPerBottle(def) {
    return Math.max(1, Math.round(Number(def?.swigsPerBottle) || DEFAULT_SWIGS_PER_BOTTLE));
  }

  function getBottleSwigStatus(key, def, inventory = itemDeps?.inventory) {
    if (!key || !isAlcoholDef(def) || !(Number(inventory?.[key]) > 0)) return null;
    const total = swigsPerBottle(def);
    const saved = Math.round(Number(bottleSwigs[key]));
    const remaining = Number.isFinite(saved) && saved > 0 && saved <= total ? saved : total;
    return { key, remaining, total, bottleCount: Math.max(0, Math.floor(Number(inventory[key]) || 0)) };
  }

  function consumeBottleSwig(key, def, inventory = itemDeps?.inventory) {
    const status = getBottleSwigStatus(key, def, inventory);
    if (!status) return { ok: false, message: 'No alcoholic drink to consume.' };
    const remaining = status.remaining - 1;
    let bottleFinished = false;
    if (remaining <= 0) {
      inventory[key] = Math.max(0, (Number(inventory[key]) || 0) - 1);
      itemDeps?.clampInventoryStack?.(key);
      delete bottleSwigs[key];
      bottleFinished = true;
    } else {
      bottleSwigs[key] = remaining;
    }
    return {
      ok: true,
      bottleFinished,
      remaining: bottleFinished && (Number(inventory[key]) || 0) > 0 ? status.total : Math.max(0, remaining),
      total: status.total,
      bottleCount: Math.max(0, Math.floor(Number(inventory[key]) || 0)),
    };
  }

  function serializeBottleSwigs() {
    return Object.fromEntries(Object.entries(bottleSwigs)
      .filter(([key, remaining]) => (!itemDeps?.inventory || Number(itemDeps.inventory[key]) > 0)
        && Number.isFinite(Number(remaining)) && Number(remaining) > 0)
      .map(([key, remaining]) => [key, Math.round(Number(remaining))]));
  }

  function restoreBottleSwigs(saved) {
    bottleSwigs = saved && typeof saved === 'object' && !Array.isArray(saved)
      ? serializeSwigObject(saved)
      : {};
    return serializeBottleSwigs();
  }

  function serializeSwigObject(source) {
    return Object.fromEntries(Object.entries(source || {})
      .filter(([, remaining]) => Number.isFinite(Number(remaining)) && Number(remaining) > 0)
      .map(([key, remaining]) => [key, Math.max(1, Math.round(Number(remaining)))]));
  }

  function absoluteGameMinute() {
    const calendar = itemDeps?.calendar;
    if (!calendar) return 0;
    return Math.max(0, (Math.max(1, Number(calendar.day) || 1) - 1) * GAME_DAY_MINUTES
      + clamp01(calendar.time01) * GAME_DAY_MINUTES);
  }

  function npcState(npcId) {
    const id = String(npcId || '');
    if (!id) return null;
    const existing = npcAlcoholState[id] || {};
    const normalized = {
      sobriety: Math.max(0, Math.min(NPC_MAX_SOBRIETY,
        Number.isFinite(Number(existing.sobriety)) ? Number(existing.sobriety) : NPC_MAX_SOBRIETY)),
      blackoutUntilMinute: Math.max(0, Number(existing.blackoutUntilMinute) || 0),
      lastDrinkKey: existing.lastDrinkKey || null,
    };
    npcAlcoholState[id] = normalized;
    return normalized;
  }

  function npcDrunkFraction(npcId) {
    const state = npcState(npcId);
    return state ? clamp01(1 - state.sobriety / NPC_MAX_SOBRIETY) : 0;
  }

  function npcBlackoutMinutes(deficitPercent) {
    return Math.max(BLACKOUT_MIN_SKIP_MINUTES,
      Math.round(Math.max(1, Number(deficitPercent) || 0) * BLACKOUT_MINUTES_PER_PERCENT));
  }

  function addNpcDrunkenness(npcId, amount, sourceKey) {
    const state = npcState(npcId);
    if (!state) return { ok: false };
    const before = state.sobriety;
    const attempted = before - Math.max(0, Number(amount) || 0);
    state.sobriety = Math.max(0, attempted);
    state.lastDrinkKey = sourceKey || null;
    const overflow = Math.max(0, -attempted);
    const reachedZero = before > 0 && state.sobriety <= 0;
    const blackout = reachedZero || overflow > 0;
    const deficitPercent = blackout ? Math.max(1, overflow / NPC_MAX_SOBRIETY * 100) : 0;
    const blackoutMinutes = blackout ? npcBlackoutMinutes(deficitPercent) : 0;
    if (blackout) {
      state.blackoutUntilMinute = Math.max(state.blackoutUntilMinute,
        absoluteGameMinute() + blackoutMinutes);
    }
    return {
      ok: true,
      sobrietyBefore: before,
      sobriety: state.sobriety,
      drunkFraction: npcDrunkFraction(npcId),
      blackout,
      deficitPercent,
      blackoutMinutes,
    };
  }

  function isNpcBlackedOut(npcId) {
    const state = npcState(npcId);
    return !!state && state.blackoutUntilMinute > absoluteGameMinute();
  }

  function npcSpeedMultiplier(npcId) {
    const sobriety = npcState(npcId)?.sobriety ?? NPC_MAX_SOBRIETY;
    const fraction = clamp01(sobriety / NPC_MAX_SOBRIETY);
    return FOOTING_SPEED_MUL_MIN + (1 - FOOTING_SPEED_MUL_MIN) * fraction;
  }

  function serializeNpcAlcoholState() {
    return Object.fromEntries(Object.entries(npcAlcoholState).map(([id, value]) => {
      const state = npcState(id);
      return [id, {
        sobriety: Math.round(state.sobriety * 1000) / 1000,
        blackoutUntilMinute: Math.round(state.blackoutUntilMinute * 1000) / 1000,
        lastDrinkKey: state.lastDrinkKey,
      }];
    }).filter(([, value]) => value.sobriety < NPC_MAX_SOBRIETY || value.blackoutUntilMinute > 0));
  }

  function restoreNpcAlcoholState(saved) {
    npcAlcoholState = saved && typeof saved === 'object' && !Array.isArray(saved)
      ? JSON.parse(JSON.stringify(saved))
      : {};
    Object.keys(npcAlcoholState).forEach(npcState);
    return serializeNpcAlcoholState();
  }

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

    // Chain onto any future-global setter another module already installed
    // on this same property (e.g. technique-scrolls.js's own lazy item-deps
    // hook on FarmCrates) instead of replacing it outright — a bare
    // Object.defineProperty below would silently discard that earlier trap
    // the moment the real object is assigned, so its own patch() would
    // never fire and its captured deps would stay permanently incomplete.
    if (chainFutureSetter(name, null, patch)) return;

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
    if (!mountDeps) return { active: false, x: 0, y: 0, strength: 0, keyboard: false, rawX: 0, rawY: 0, cameraRelative: false, cameraFacingRad: null };
    const keyboard = mountDeps.getKeyboardVector?.() || { active: false, x: 0, y: 0 };
    const rawX = Number(keyboard.active ? keyboard.x : mountDeps.input?.x) || 0; // Kept for debug so raw input can be compared with the resolved world vector.
    const rawY = Number(keyboard.active ? keyboard.y : mountDeps.input?.y) || 0; // Kept for debug so raw input can be compared with the resolved world vector.
    let x = rawX; // Resolved below into the same world-space direction used by ordinary movement.
    let y = rawY; // Resolved below into the same world-space direction used by ordinary movement.
    const strength = Math.min(1, Math.hypot(rawX, rawY));
    let cameraRelative = false; // Exposed in getDebug() to verify Shoulder Cam used the camera basis.
    let cameraFacingRad = null; // Exposed in getDebug() alongside the resolved movement vector.
    if (strength > 0.001 && mountDeps.isShoulderSurfMode?.()) {
      const aim = Number(mountDeps.cameraFacingAngleRad?.()); // Same camera-facing basis used by on-foot and mounted movement.
      if (Number.isFinite(aim)) {
        const s = Math.sin(aim), c = Math.cos(aim); // Used by the shared Shoulder Cam input rotation formula.
        const resolvedX = -x * s - y * c; // Camera-relative input converted to the game's world X axis.
        const resolvedY = x * c - y * s; // Camera-relative input converted to the game's world Y axis.
        x = resolvedX;
        y = resolvedY;
        cameraRelative = true;
        cameraFacingRad = aim;
      }
    }
    return {
      active: strength > 0.001,
      x,
      y,
      strength,
      keyboard: !!keyboard.active,
      rawX,
      rawY,
      cameraRelative,
      cameraFacingRad,
    };
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
    const alchemyPayload = window.AlchemySystem?.POTION_ITEMS?.[key] || window.AlchemySystem?.getPotionEffectsFromKey?.(key); // Used to respect explicit alchemy use modes.
    const alchemyRecipe = alchemyPayload?.recipeId && window.AlchemySystem?.RECIPE_DEFS?.[alchemyPayload.recipeId]; // Central recipe definition.
    if (alchemyRecipe) return alchemyRecipe.useMode === 'drink';
    if (alchemyPayload?.legacyEffects) return true;
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
    if (window.CharacterActionLocks?.isLocked?.('player', 'actions')) return null;
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
    if (def.isCookedFood) return null; // CookingSystem owns generated meals and their stacked effects.
    if (window.AlchemySystem?.REAGENT_DEFS?.[key]) return { key, def, inventory, kind: 'rawReagent' };
    if (def.alchemyRecipeScrollId) return { key, def, inventory, kind: 'recipe' };
    if (isPotionOrDrink(key, def)) return { key, def, inventory, kind: 'drink' };
    if (isFood(def)) return { key, def, inventory, kind: 'food' };
    return null;
  }

  function getHeldAlcohol() {
    const held = getHeldConsumable();
    return held?.kind === 'drink' && isAlcoholDef(held.def) ? held : null;
  }

  function getHeldItemAction() {
    const held = getHeldConsumable();
    if (!held) return null;
    // The action arch uses this fraction to mirror the selected-item badge.
    const swigs = held.kind === 'drink' && isAlcoholDef(held.def)
      ? getBottleSwigStatus(held.key, held.def, held.inventory)
      : null;
    return {
      icon: held.def.icon || (held.kind === 'drink' ? '🥤' : '🍽️'),
      label: `${held.kind === 'drink' ? 'Drink' : held.kind === 'recipe' ? 'Read' : 'Eat'} ${held.def.label || held.key}`,
      action: 'consume_held_item',
      style: 'primary',
      allowed: true,
      swigFraction: swigs ? `${swigs.remaining}/${swigs.total}` : null,
    };
  }

  function getNpcSwigOfferAction(walker) {
    const held = getHeldAlcohol();
    if (!held || !walker?.rec?.id || isNpcBlackedOut(walker.rec.id)) return null;
    const status = getBottleSwigStatus(held.key, held.def, held.inventory);
    if (!status) return null;
    return {
      icon: held.def.icon || '🍷',
      label: `Offer ${walker.rec.name || walker.rec.displayName || 'them'} a swig (${status.remaining}/${status.total})`,
      action: 'npc_offer_alcohol_swig',
      style: 'secondary',
      allowed: true,
      contextualHeldItem: true,
      swigFraction: `${status.remaining}/${status.total}`,
    };
  }

  function offerNpcSwig(walker) {
    if (performance.now() < consumeLockUntil) return false;
    const held = getHeldAlcohol();
    const npcId = walker?.rec?.id;
    if (!held || !npcId || isNpcBlackedOut(npcId)) return false;
    const response = window.AmbientDialogue?.resolveAlcoholOffer?.(walker) || { accepted: true };
    if (!response.accepted) {
      window.AmbientDialogue?.showAlcoholOfferResponse?.(walker, response);
      consumeLockUntil = performance.now() + 180;
      return true;
    }
    if (!itemDeps?.canPlayNpcDrinkInteraction?.(walker, held.key)) return false;
    const profile = window.HobunjiAlcohol?.profileForItem?.(held.key);
    if (!profile) return false;
    window.AmbientDialogue?.showAlcoholOfferResponse?.(walker, response);
    const serving = consumeBottleSwig(held.key, held.def, held.inventory);
    if (!serving.ok) return false;
    let result = null; // Filled at the drink animation's strike frame and used by the mobile-visible alcohol log.
    const applyNpcSwig = () => {
      if (result) return result;
      result = addNpcDrunkenness(npcId, profile.footing, held.key);
      itemDeps?.saveMemberWorldData?.();
      window.__farmLog?.(`[alcohol] NPC swig: npc=${npcId} item=${held.key} sobriety=${result.sobriety.toFixed(2)} blackout=${result.blackout ? `${result.blackoutMinutes}m` : 'no'}`, 'items');
      return result;
    };
    const animationMs = Number(itemDeps?.playNpcDrinkInteraction?.(walker, held.key, applyNpcSwig)) || 0;
    if (!(animationMs > 0)) applyNpcSwig();
    itemDeps?.showToast?.(`${walker.rec.name || 'They'} accepted a swig of ${held.def.label || held.key}.`, true);
    itemDeps?.refreshItemScroll?.();
    itemDeps?.buildInventoryGrid?.();
    itemDeps?.refreshActionBar?.();
    itemDeps?.saveMemberWorldData?.();
    consumeLockUntil = performance.now() + Math.max(180, animationMs);
    return true;
  }

  function consumeHeldItem() {
    if (performance.now() < consumeLockUntil) return false;
    const held = getHeldConsumable();
    if (!held) return false;
    const { key, def, inventory } = held;

    if (held.kind === 'drink') {
      let result = null; // Filled exactly once at the authored drink strike.
      const applyDrink = () => {
        if (result) return result;
        result = window.AlchemySystem?.drinkPotion?.(key);
        if (!result) return null;
        itemDeps.showToast?.(result.message, result.ok !== false);
        itemDeps.refreshItemScroll?.();
        itemDeps.buildInventoryGrid?.();
        itemDeps.refreshActionBar?.();
        itemDeps.saveMemberWorldData?.();
        return result;
      };
      const animationMs = Number(itemDeps.triggerHeldDrinkAnimation?.(key, applyDrink)) || 0; // Existing liquor animation path.
      if (!(animationMs > 0)) applyDrink();
      consumeLockUntil = performance.now() + Math.max(180, animationMs);
      return true;
    }

    if (held.kind === 'rawReagent') {
      const result = window.AlchemySystem?.consumeRawReagent?.(key);
      itemDeps.showToast?.(result?.message || 'Could not eat that reagent.', result?.ok !== false);
      itemDeps.refreshItemScroll?.(); itemDeps.buildInventoryGrid?.(); itemDeps.refreshActionBar?.(); itemDeps.saveMemberWorldData?.();
      consumeLockUntil = performance.now() + 180;
      return true;
    }

    if (held.kind === 'recipe') {
      const result = window.AlchemySystem?.readRecipeItem?.(key);
      itemDeps.showToast?.(result?.message || 'Could not read that recipe.', result?.ok !== false);
      itemDeps.refreshItemScroll?.(); itemDeps.buildInventoryGrid?.(); itemDeps.refreshActionBar?.(); itemDeps.saveMemberWorldData?.();
      consumeLockUntil = performance.now() + 180;
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
    for (const [npcId, state] of Object.entries(npcAlcoholState)) {
      if (state.sobriety < NPC_MAX_SOBRIETY) {
        state.sobriety = Math.min(NPC_MAX_SOBRIETY, state.sobriety + dt * DRUNK_RECOVERY_PER_SEC);
      }
      if (state.blackoutUntilMinute > 0 && !isNpcBlackedOut(npcId)) state.blackoutUntilMinute = 0;
    }
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
    consumeBottleSwig,
    getHeldItemAction,
    getBottleSwigStatus,
    getNpcSwigOfferAction,
    offerNpcSwig,
    isFood,
    isPotionOrDrink,
    isAlcoholDef,
    npcDrunkFraction,
    npcSpeedMultiplier,
    isNpcBlackedOut,
    serializeBottleSwigs,
    restoreBottleSwigs,
    serializeNpcAlcoholState,
    restoreNpcAlcoholState,
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
        movementInput: movementInput(),
        blackoutSettling: blackoutSettling(),
        blackoutTravelHoldUntil: Number(window.__hobunjiBlackoutTravelHoldUntil) || 0,
        hasDevDeps: !!devDeps,
        hasMountDeps: !!mountDeps,
        hasItemDeps: !!itemDeps,
        playerAttached: !!composer?.playerAttached,
        bodyChannels: composer?.channels || [],
        bottleSwigs: serializeBottleSwigs(),
        npcAlcoholState: serializeNpcAlcoholState(),
      };
    },
  };
})();