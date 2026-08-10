// Fetches docs/config/combat/attack-values.json once at boot and pushes each
// section into the combat-*.js module that owns it, via the applyXConfig
// functions those modules expose (see combat-combo.js's applyComboConfig for
// the general in-place-mutation pattern every one of them follows). Runs
// after every combat-*.js file has already registered its synchronous
// hardcoded defaults, so those defaults are what's actually in play until
// this fetch resolves — same "synchronous fallback, async override" shape
// as docs/game.js's loadLootShopConfig().
//
// The full parsed config is also stashed on window.__attackValuesConfig so
// game.js's weaponAbility()/CREATURE_DB attack-field merge (which don't have
// their own combat-*.js-style module to push into) can read it directly, and
// so the attack-animation-editor tool's live-preview can inspect the exact
// values currently in effect.
//
// Routed through window.LocalDBOverrides.loadDatabase() (see docs/js/local-
// db-overrides.js) instead of a bare fetch so the "Database Source" toggle on
// the onboarding save-select screen can swap in a locally-saved edit of this
// file without touching the repo copy — falls back to a direct fetch if that
// module somehow isn't loaded.
(function () {
  'use strict';
  const _load = window.LocalDBOverrides
    ? window.LocalDBOverrides.loadDatabase('attackValues')
    : fetch('config/combat/attack-values.json').then(r => r.ok ? r.json() : null);
  window.__attackValuesConfigPromise = _load
    .then(cfg => {
      if (!cfg) return null;
      window.__attackValuesConfig = cfg;
      window.Combat?.applyComboConfig?.(cfg.combo);
      window.Combat?.applyQuickAttackConfig?.(cfg.quickAttacks);
      window.Combat?.applyChargedBreakerConfig?.(cfg.chargedBreaker);
      window.Combat?.applyFlurryConfig?.(cfg.flurry);
      window.Combat?.applyCounterShieldConfig?.(cfg.counterShield);
      window.Combat?.animalAttacks?.applyConfig?.(cfg.creatureAttacks);
      window.dispatchEvent(new CustomEvent('hobunji-attack-values-loaded', { detail: cfg }));
      return cfg;
    })
    .catch(() => null);
})();

(function installDrunkenCrossModuleBridges() {
  'use strict';

  function chainFutureSetter(name, beforeSet, afterSet) {
    const desc = Object.getOwnPropertyDescriptor(window, name);
    const previousSet = desc?.set;
    if (typeof previousSet !== 'function') return;
    Object.defineProperty(window, name, {
      configurable: true,
      get: desc.get,
      set(value) {
        beforeSet?.(value);
        previousSet.call(window, value);
        afterSet?.(value);
      },
    });
  }

  chainFutureSetter('AlchemySystem', null, (api) => {
    if (api?.ALCHEMY_POTION_ITEMS) api.POTION_ITEMS = api.ALCHEMY_POTION_ITEMS;
  });

  chainFutureSetter('DevSpawner', (api) => {
    if (!api?.init || api.__drunkenZoneCompatInstalled) return;
    const originalInit = api.init.bind(api);
    api.init = function drunkenZoneCompatInit(injectedDeps) {
      if (injectedDeps && !injectedDeps._isZoneArea) {
        injectedDeps._isZoneArea = (area) => !!injectedDeps.EXTERIOR_ZONES?.[area];
      }
      window.__hobunjiDrunkBridgeDevDeps = injectedDeps;
      return originalInit(injectedDeps);
    };
    api.__drunkenZoneCompatInstalled = true;
  }, null);
})();

(function installDrunkenGameplayBridges() {
  'use strict';

  const RS = window.ResourceSystem;
  const legApi = window.ProceduralLegAnimation;
  if (!RS || !legApi?.attach || window.__hobunjiDrunkGameplayBridgeInstalled) return;
  window.__hobunjiDrunkGameplayBridgeInstalled = true;

  const DRUNK_FOOTING_ID = 'drunkenFooting';
  const DRUNK_HEALTH_ID = 'drunkenHealth';
  const DRUNK_RECOVERY_PER_SEC = 0.02;
  const GAME_DAY_SECONDS = 288;
  const GAME_DAY_MINUTES = 16 * 60;
  const FOOTING_SPEED_MUL_MIN = 0.55;
  const STOP_LAMBDA_LIGHT_DRUNK = 9.0;
  const STOP_LAMBDA_MAX_DRUNK = 2.1;

  let mountDeps = null;
  let itemDeps = null;
  let playerMeshRef = null;
  let passiveRoots = [];
  let passiveBaseQuats = new Map();
  let inertiaVX = 0, inertiaVY = 0;
  let lastPlayerX = null, lastPlayerY = null;
  let lastPostAt = performance.now();
  let consumeLockUntil = 0;

  const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
  const lerp = (a, b, t) => a + (b - a) * t;
  function approach(current, target, maxDelta) {
    const d = target - current;
    if (Math.abs(d) <= maxDelta) return target;
    return current + Math.sign(d) * maxDelta;
  }
  function drunkFootingFraction(player) {
    const max = Math.max(0, Number(player?.maxFooting) || 0);
    return max ? clamp01((Number(player?.afflictions?.[DRUNK_FOOTING_ID]) || 0) / max) : 0;
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

  const originalAddDrunkenness = RS.addDrunkenness?.bind(RS);
  if (originalAddDrunkenness && !RS.__blackoutSobrietyRecoveryInstalled) {
    RS.addDrunkenness = function blackoutSobrietyAwareAdd(entity, footingAmount, healthAmount, opts = {}) {
      const result = originalAddDrunkenness(entity, footingAmount, healthAmount, opts);
      if (!result?.blackout || entity !== window.Combat?.deps?.player) return result;
      const skippedMinutes = Number(window.HobunjiAlcohol?.getDebug?.()?.lastBlackout?.skippedMinutes) || 0;
      const elapsedTickSeconds = skippedMinutes * GAME_DAY_SECONDS / GAME_DAY_MINUTES;
      const recovery = Math.max(0, elapsedTickSeconds * DRUNK_RECOVERY_PER_SEC);
      if (!(recovery > 0)) return result;
      const beforeFootingDrunk = Number(entity.afflictions?.[DRUNK_FOOTING_ID]) || 0;
      RS.removeAffliction(entity, DRUNK_FOOTING_ID, recovery);
      const footingRecovered = Math.max(0, beforeFootingDrunk - (Number(entity.afflictions?.[DRUNK_FOOTING_ID]) || 0));
      RS.removeAffliction(entity, DRUNK_HEALTH_ID, recovery);
      if (footingRecovered > 0) {
        entity.footing = Math.min(RS.getEffectiveMax(entity, 'footing'), (Number(entity.footing) || 0) + footingRecovered);
      }
      RS.enforceCaps(entity);
      result.sobrietyRecovered = recovery;
      return result;
    };
    RS.__blackoutSobrietyRecoveryInstalled = true;
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
    if (window[name]) { patch(window[name]); return; }
    const desc = Object.getOwnPropertyDescriptor(window, name);
    if (desc && !desc.configurable) return;
    let value;
    Object.defineProperty(window, name, {
      configurable: true,
      get() { return value; },
      set(v) { value = v; patch(v); },
    });
  }

  hookFutureInit('Mounts', deps => { mountDeps = deps; });
  hookFutureInit('FarmCrates', deps => { itemDeps = deps; });

  const drunkOwnedRoot = child => {
    if (!child) return false;
    const name = String(child.name || '').toLowerCase();
    return child.userData?.modelRole === 'temporary-npc-demo-model'
      || name.includes('player_avatar') || name.includes('player_portrait')
      || name.includes('hat_xray') || name.includes('occlusion_ghost')
      || name.includes('procedural_leg');
  };

  const previousAttach = legApi.attach.bind(legApi);
  legApi.attach = function drunkAttachmentAwareAttach(THREEArg, parent, options = {}) {
    const isPlayer = String(options.name || '').toLowerCase() === 'player';
    const childrenBefore = isPlayer ? Array.from(parent?.children || []) : null;
    const handle = previousAttach(THREEArg, parent, options);
    if (!childrenBefore || !handle) return handle;

    playerMeshRef = parent;
    passiveRoots = childrenBefore.filter(child => child?.isObject3D && !drunkOwnedRoot(child));
    passiveBaseQuats = new Map(passiveRoots.map(child => [child, child.quaternion.clone()]));
    const originalUpdate = handle.update.bind(handle);
    const originalDispose = handle.dispose.bind(handle);
    const localEuler = new THREEArg.Euler(0, 0, 0, 'YXZ');
    const localQ = new THREEArg.Quaternion();

    handle.update = function drunkAttachmentAwareUpdate(...args) {
      const result = originalUpdate(...args);
      const debug = window.HobunjiDrunkWalk?.getDebug?.();
      localEuler.set(
        (Number(debug?.pitchDeg) || 0) * Math.PI / 180,
        (Number(debug?.yawDeg) || 0) * Math.PI / 180,
        (Number(debug?.rollDeg) || 0) * Math.PI / 180,
        'YXZ'
      );
      localQ.setFromEuler(localEuler);
      for (const root of passiveRoots) {
        const base = passiveBaseQuats.get(root);
        if (base && root?.quaternion) root.quaternion.copy(base).multiply(localQ);
      }
      return result;
    };
    handle.dispose = function drunkAttachmentAwareDispose() {
      for (const root of passiveRoots) {
        const base = passiveBaseQuats.get(root);
        if (base && root?.quaternion) root.quaternion.copy(base);
      }
      if (playerMeshRef === parent) {
        playerMeshRef = null;
        passiveRoots = [];
        passiveBaseQuats.clear();
      }
      return originalDispose();
    };
    return handle;
  };

  function localDrunkQuaternion() {
    const debug = window.HobunjiDrunkWalk?.getDebug?.();
    const e = new THREE.Euler(
      (Number(debug?.pitchDeg) || 0) * Math.PI / 180,
      (Number(debug?.yawDeg) || 0) * Math.PI / 180,
      (Number(debug?.rollDeg) || 0) * Math.PI / 180,
      'YXZ'
    );
    return new THREE.Quaternion().setFromEuler(e);
  }

  function renderRotatedSibling(obj, pivot, worldDrunkQ, undo) {
    if (!obj?.isObject3D || !obj.visible) return;
    const oldPos = obj.position.clone();
    const oldQuat = obj.quaternion.clone();
    const offset = obj.position.clone().sub(pivot).applyQuaternion(worldDrunkQ);
    obj.position.copy(pivot).add(offset);
    obj.quaternion.premultiply(worldDrunkQ);
    undo.push(() => { obj.position.copy(oldPos); obj.quaternion.copy(oldQuat); });
  }

  if (window.THREE?.WebGLRenderer && !window.THREE.WebGLRenderer.prototype.__drunkAttachmentRenderHook) {
    const proto = window.THREE.WebGLRenderer.prototype;
    const originalRender = proto.render;
    proto.render = function drunkenAttachmentAwareRender(scene, camera) {
      const undo = [];
      if (playerMeshRef) {
        const localQ = localDrunkQuaternion();
        if (Math.abs(localQ.x) + Math.abs(localQ.y) + Math.abs(localQ.z) > 1e-7) {
          const parentQ = playerMeshRef.quaternion.clone();
          const worldQ = parentQ.clone().multiply(localQ).multiply(parentQ.clone().invert());
          const pivot = playerMeshRef.position.clone();
          renderRotatedSibling(window.__hobunjiDrunkBridgeDevDeps?.toolHolder, pivot, worldQ, undo);
          for (const c of window.Combat?.deps?.companionObjects || []) {
            if (c?.health <= 0 || c?.stableRole !== 'shoulderPet' || (c.master || window.Combat?.deps?.player) !== window.Combat?.deps?.player) continue;
            renderRotatedSibling(c.avatarRef?.group, pivot, worldQ, undo);
          }
        }
      }
      try { return originalRender.call(this, scene, camera); }
      finally { for (let i = undo.length - 1; i >= 0; i--) undo[i](); }
    };
    proto.__drunkAttachmentRenderHook = true;
  }

  function movementInput() {
    if (!mountDeps) return { active: false, x: 0, y: 0, strength: 0, keyboard: false };
    const kb = mountDeps.getKeyboardVector?.() || { active: false, x: 0, y: 0 };
    const x = Number(kb.active ? kb.x : mountDeps.input?.x) || 0;
    const y = Number(kb.active ? kb.y : mountDeps.input?.y) || 0;
    const strength = Math.min(1, Math.hypot(x, y));
    return { active: strength > 0.001, x, y, strength, keyboard: !!kb.active };
  }

  function terrainSpeedMul(player) {
    const deps = window.__hobunjiDrunkBridgeDevDeps;
    const tileSize = Number(deps?.TILE) || 55;
    const grid = deps?.getActiveGrid?.();
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
    if (!(drunk > 0) || player.prone || player.climbing || player.lunging || (window.Mounts?.rideState && window.Mounts.rideState !== 'none')) {
      inertiaVX = inertiaVY = 0;
      lastPlayerX = Number(player.x) || 0; lastPlayerY = Number(player.y) || 0;
      return;
    }
    if (window.PlayerChat?.isOpen || document.getElementById('npcDialogue')?.classList.contains('open') || document.getElementById('menuPanel')?.classList.contains('open')) {
      inertiaVX = inertiaVY = 0;
      return;
    }

    const move = movementInput();
    const { legacy: legacyFootingMul, desired: desiredFootingMul } = footingSpeedMuls(player);
    if (move.active) {
      const analogEase = move.keyboard ? 1 : (0.28 + 0.72 * move.strength);
      const baseSpeed = (Number(mountDeps.MOVE_SPEED) || 238)
        * terrainSpeedMul(player) * analogEase
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
      const lambda = lerp(STOP_LAMBDA_LIGHT_DRUNK, STOP_LAMBDA_MAX_DRUNK, drunk);
      const decay = Math.exp(-Math.max(0.1, lambda) * dt);
      inertiaVX *= decay; inertiaVY *= decay;
      let idealSpeed = Math.hypot(inertiaVX, inertiaVY);
      if (idealSpeed < 2) { inertiaVX = inertiaVY = 0; idealSpeed = 0; }

      const px = Number(player.x) || 0, py = Number(player.y) || 0;
      if (lastPlayerX != null && Math.hypot(px - lastPlayerX, py - lastPlayerY) < 0.02 && idealSpeed > 30) {
        inertiaVX = inertiaVY = 0;
        idealSpeed = 0;
      }
      if (idealSpeed > 0) {
        const decelStep = Math.max(0, Number(mountDeps.DECEL) || 1850) * dt;
        const prechargedSpeed = idealSpeed + decelStep;
        player.vx = inertiaVX / idealSpeed * prechargedSpeed;
        player.vy = inertiaVY / idealSpeed * prechargedSpeed;
      } else {
        player.vx = player.vy = 0;
      }
    }
    lastPlayerX = Number(player.x) || 0;
    lastPlayerY = Number(player.y) || 0;
  }

  function heldItemHolderVisible() {
    if (!playerMeshRef) return false;
    return passiveRoots.some(root => root?.visible && !root.name && root.type === 'Group');
  }

  function isPotionOrDrink(key, def) {
    if (!key || !def) return false;
    if (window.AlchemySystem?.POTION_ITEMS?.[key] || window.AlchemySystem?.getPotionEffectsFromKey?.(key)) return true;
    const tags = (def.tags || []).map(t => String(t).toLowerCase());
    const text = `${def.label || ''} ${tags.join(' ')}`.toLowerCase();
    return /\b(alcohol|wine|sake|vodka|nectar|airag|liquor|spirit|potion|drink|tea|juice|milk)\b/.test(text);
  }

  function isFood(def) {
    if (!def) return false;
    const tags = (def.tags || []).map(t => String(t).toLowerCase());
    if (['crop', 'processed', 'food', 'meal'].includes(String(def.cat || '').toLowerCase())) return true;
    return tags.some(t => ['food', 'meal', 'crop', 'berry', 'fruit', 'vegetable', 'meat', 'noodles', 'cheese', 'curd'].includes(t));
  }

  function consumeHeldItem() {
    if (performance.now() < consumeLockUntil || !heldItemHolderVisible()) return false;
    const active = itemDeps?.getActiveInventoryItem?.();
    const key = active?.key;
    const inventory = itemDeps?.inventory;
    const def = active;
    if (!key || !def || !inventory || (inventory[key] || 0) < 1) return false;

    if (isPotionOrDrink(key, def)) {
      const result = window.AlchemySystem?.drinkPotion?.(key);
      if (!result) return false;
      itemDeps.showToast?.(result.message, result.ok !== false);
      if (result.ok !== false) {
        itemDeps.refreshItemScroll?.();
        itemDeps.buildInventoryGrid?.();
        itemDeps.saveMemberWorldData?.();
      }
      consumeLockUntil = performance.now() + 180;
      return true;
    }
    if (!isFood(def)) return false;

    inventory[key]--;
    itemDeps.clampInventoryStack?.(key);
    const player = window.Combat?.deps?.player;
    const healthRestore = Number(def.healthRestore ?? def.restoreHealth ?? def.health) || 0;
    const staminaRestore = Number(def.staminaRestore ?? def.restoreStamina ?? def.stamina) || 0;
    if (player && healthRestore > 0) player.health = Math.min(Number(player.maxHealth) || 100, (Number(player.health) || 0) + healthRestore);
    if (player && staminaRestore > 0) player.stamina = Math.min(Number(player.maxStamina) || 100, (Number(player.stamina) || 0) + staminaRestore);
    itemDeps.showToast?.(`${def.icon || '🍽️'} Ate ${def.label || key}.`, true);
    itemDeps.refreshItemScroll?.();
    itemDeps.buildInventoryGrid?.();
    itemDeps.saveMemberWorldData?.();
    consumeLockUntil = performance.now() + 180;
    return true;
  }

  document.addEventListener('pointerdown', event => {
    const id = event.target?.closest?.('button')?.id;
    if (!/^btn(?:Item)?Action[1-5]$/.test(id || '')) return;
    if (!consumeHeldItem()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener('keydown', event => {
    if (event.repeat || !['Space', 'Enter', 'KeyE'].includes(event.code)) return;
    if (!consumeHeldItem()) return;
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
    getDebug() {
      const player = window.Combat?.deps?.player;
      const muls = footingSpeedMuls(player);
      return {
        drunkFootingFraction: drunkFootingFraction(player),
        legacyFootingSpeedMul: muls.legacy,
        desiredFootingSpeedMul: muls.desired,
        inertiaVX, inertiaVY,
        hasDevDeps: !!window.__hobunjiDrunkBridgeDevDeps,
        hasMountDeps: !!mountDeps,
        hasItemDeps: !!itemDeps,
        playerAttached: !!playerMeshRef,
      };
    },
  };
})();
