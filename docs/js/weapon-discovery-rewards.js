// Discovery-only weapon acquisition adapter.
//
// This module deliberately does not duplicate gear, saving, or Bronzeworks
// unlock logic. Before WeaponTrustVisits initializes it replaces any trust-gift
// entry for each configured shape with an unreachable synthetic gate. When the
// configured source succeeds, it completes that gate through the existing
// authoritative grant/persistence path.
(function (global) {
  'use strict';

  const cfg = global.WEAPON_DISCOVERY_REWARD_CONFIG;
  const trustCfg = global.WEAPON_TRUST_VISIT_CONFIG;
  if (!cfg || !trustCfg?.gifts) {
    console.warn('[weapon-discovery-rewards] config missing; system disabled');
    return;
  }

  const IS_DIALOGUE_EDITOR = String(global.location?.pathname || '').includes('/tools/dialogue-editor');
  const syntheticGiftByRewardId = new Map();
  const patchedApis = new WeakSet();
  let treasureDeps = null;
  let scanFrame = 0;

  function clampChance(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function syntheticGiftFor(reward) {
    return {
      id: `discovery_${reward.id}`,
      npcId: `${cfg.syntheticNpcIdPrefix || '__weapon_discovery__:'}${reward.id}`,
      shapeKey: reward.shapeKey,
      giftMetalKey: reward.metalKey || 'nativeCopper',
      requiredHearts: Math.max(1000, Number(cfg.syntheticRequiredHearts) || 999999),
      dialogueTreeId: `weapon_discovery_gate_${reward.id}`,
      dialogueLabel: `Discovery Gate — ${reward.label || reward.shapeKey}`,
      dialogueLines: [''],
      weaponDiscoveryRewardId: reward.id,
      weaponDiscoverySource: reward.source,
    };
  }

  function installSyntheticGates() {
    const gifts = trustCfg.gifts;
    for (const reward of (cfg.rewards || [])) {
      if (!reward?.id || !reward?.shapeKey || !reward?.source) continue;

      // Remove only the old acquisition mapping for this SHAPE. This is why
      // Pahu/Gantami remain free to receive some different trust weapon later.
      for (let i = gifts.length - 1; i >= 0; i--) {
        if (gifts[i]?.shapeKey === reward.shapeKey) gifts.splice(i, 1);
      }

      const gate = syntheticGiftFor(reward);
      gifts.push(gate);
      syntheticGiftByRewardId.set(reward.id, gate);
    }
  }

  installSyntheticGates(); // Must run before weapon-trust-visits.js builds its shape maps.

  function trustApi() {
    return global.WeaponTrustVisits || null;
  }

  function rewardCompleted(reward) {
    const gate = syntheticGiftByRewardId.get(reward?.id);
    return !!gate && !!trustApi()?.giftCompleted?.(gate);
  }

  function completeReward(reward) {
    const gate = syntheticGiftByRewardId.get(reward?.id);
    const api = trustApi();
    if (!reward || !gate || !api?.completeGift || rewardCompleted(reward)) return false;
    const completed = api.completeGift(gate) === true;
    if (!completed) return false;

    document.dispatchEvent(new CustomEvent('hobunji-weapon-discovery-reward', {
      detail: {
        rewardId: reward.id,
        source: reward.source,
        shapeKey: reward.shapeKey,
        metalKey: reward.metalKey || 'nativeCopper',
      },
    }));
    global.__farmLog?.(`[weapon-discovery-rewards] ${reward.source} unlocked ${reward.shapeKey}`, 'loot');
    return true;
  }

  function rollSource(source, rng = Math.random) {
    const candidates = (cfg.rewards || []).filter(reward => reward?.source === source && !rewardCompleted(reward));
    for (const reward of candidates) {
      if (rng() >= clampChance(reward.chance)) continue;
      if (completeReward(reward)) return reward; // At most one special weapon per source event.
    }
    return null;
  }

  function patchFishing(api) {
    if (!api?.init || patchedApis.has(api)) return;
    patchedApis.add(api);
    const originalInit = api.init;
    api.init = function weaponDiscoveryFishingInit(injectedDeps) {
      if (injectedDeps && !injectedDeps.__weaponDiscoveryGulletToastWrapped) {
        const originalToast = injectedDeps.showToast;
        if (typeof originalToast === 'function') {
          injectedDeps.showToast = function weaponDiscoveryGulletToast(message, ...args) {
            const result = originalToast.call(this, message, ...args);
            // fishing-events.js emits this once, and only after a Gullet Fish's
            // treasure retrieval succeeds. Failure/escape messages use different text.
            if (String(message || '').startsWith('Gullet Fish treasure:')) rollSource('gulletFish');
            return result;
          };
          Object.defineProperty(injectedDeps, '__weaponDiscoveryGulletToastWrapped', { value: true, configurable: true });
        }
      }
      return originalInit.call(this, injectedDeps);
    };
  }

  function decorateTreasureChestObject(object) {
    if (!object || object.type !== 'treasure_chest' || typeof object.onAction !== 'function' || object.__weaponDiscoveryRewardWrapped) return;
    const originalAction = object.onAction;
    object.onAction = function weaponDiscoveryTreasureAction(action, ...args) {
      const result = originalAction.call(this, action, ...args);
      if (action === 'obj_open_treasure_chest' && result?.ok === true) {
        const reward = rollSource('treasureChest');
        if (reward) {
          const label = reward.label || reward.shapeKey;
          result.message = `${result.message}; also found ${label}`;
        }
      }
      return result;
    };
    Object.defineProperty(object, '__weaponDiscoveryRewardWrapped', { value: true, configurable: true });
  }

  function decorateTreasureObjects() {
    const zoneMaps = treasureDeps?._zoneTreasureObjects;
    if (!zoneMaps?.values) return;
    for (const objectMap of zoneMaps.values()) {
      if (!objectMap?.values) continue;
      for (const object of objectMap.values()) decorateTreasureChestObject(object);
    }
  }

  function patchWildTreasure(api) {
    if (!api?.init || patchedApis.has(api)) return;
    patchedApis.add(api);
    const originalInit = api.init;
    api.init = function weaponDiscoveryTreasureInit(injectedDeps) {
      treasureDeps = injectedDeps;
      const result = originalInit.call(this, injectedDeps);
      decorateTreasureObjects();
      return result;
    };

    // Public zone rebuilds can replace registered chest objects. Decorating
    // after these calls makes the successful-open hook immediate rather than
    // waiting for the safety scan below.
    for (const methodName of ['ensureZone', 'syncZoneInteractivity']) {
      const original = api[methodName];
      if (typeof original !== 'function') continue;
      api[methodName] = function weaponDiscoveryTreasureRefresh(...args) {
        const result = original.apply(this, args);
        decorateTreasureObjects();
        return result;
      };
    }
  }

  function patchApiWhenAssigned(name, patcher) {
    const existing = global[name];
    if (existing) { patcher(existing); return; }
    const descriptor = Object.getOwnPropertyDescriptor(global, name);
    if (descriptor && descriptor.configurable === false) return;
    let stored = descriptor?.get ? descriptor.get.call(global) : descriptor?.value;
    Object.defineProperty(global, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return stored; },
      set(value) {
        stored = value;
        patcher(value);
        Object.defineProperty(global, name, { value: stored, writable: true, configurable: true, enumerable: true });
      },
    });
  }

  function scan() {
    decorateTreasureObjects();
    scanFrame = global.requestAnimationFrame(scan);
  }

  global.WeaponDiscoveryRewards = Object.freeze({
    config: cfg,
    rollSource,
    completeReward,
    rewardCompleted,
    debugSnapshot() {
      return {
        rewards: (cfg.rewards || []).map(reward => ({
          id: reward.id,
          source: reward.source,
          shapeKey: reward.shapeKey,
          chance: clampChance(reward.chance),
          completed: rewardCompleted(reward),
        })),
        syntheticGateIds: [...syntheticGiftByRewardId.values()].map(gate => gate.id),
        treasureHookReady: !!treasureDeps,
      };
    },
  });

  if (!IS_DIALOGUE_EDITOR) {
    patchApiWhenAssigned('Fishing', patchFishing);
    patchApiWhenAssigned('WildTreasure', patchWildTreasure);
    scanFrame = global.requestAnimationFrame(scan);
  }
})(window);
