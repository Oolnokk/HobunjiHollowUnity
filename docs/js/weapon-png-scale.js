// Gives legacy weapon-slot PNGs a small baseline enlargement without touching weapons
// that already author their own larger scale (the ranged weapons are 1.77x) or now
// carry an intrinsic held-item scale in hand-tool-grips.js. This remains a render-time
// fallback around WeaponToolStances so tool mode keeps its existing sprite size.
(function (global) {
  'use strict';

  const BASE_WEAPON_PNG_SCALE = 1.15;
  const ELIGIBLE_WEAPONS = new Set([
    'hatchet',
    'bronzehoe',
    'pickshovel',
    'fishingspear',
    'fishingmace',
  ]);

  let installed = false;

  function currentWeaponKey(deps) {
    const activeSlot = deps?.getActiveTool?.() || null;
    if (activeSlot !== 'weapon') return null;
    return deps?.equipmentSlots?.weapon || null;
  }

  function authoredBaseScale(itemKey) {
    const scale = Number(global.HobunjiHandToolGrips?.toolScaleForTool?.(itemKey)); // Used below to keep the legacy 1.15 fallback from multiplying an authored per-shape scale a second time.
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  function installScaleHook(deps) {
    const holder = deps?.toolHolder;
    if (!holder?.updateMatrixWorld || holder.__weaponPngBaselineScaleHook) return false;

    const originalUpdateMatrixWorld = holder.updateMatrixWorld;
    holder.updateMatrixWorld = function weaponPngBaselineScaleUpdateMatrixWorld(force) {
      const itemKey = currentWeaponKey(deps);
      const mesh = deps?.toolMeshMap?.weapon || null;
      const toolPlane = mesh?.userData?.toolPlane || null;
      const holderScale = Math.max(
        Math.abs(Number(this.scale?.x) || 1),
        Math.abs(Number(this.scale?.y) || 1),
        Math.abs(Number(this.scale?.z) || 1),
      );
      const itemBaseScale = authoredBaseScale(itemKey); // Intrinsic sprite size from the shared grip/held-item metadata, independent of attack animation scale.
      const shouldUpscale = !!toolPlane
        && ELIGIBLE_WEAPONS.has(itemKey)
        // Respect any current/future animation that already enlarges the weapon.
        && holderScale <= 1.0001
        // Intrinsically scaled shapes already receive their scale in hand-tool-grips.
        && Math.abs(itemBaseScale - 1) <= 0.0001;

      let savedScale = null;
      if (shouldUpscale) {
        savedScale = toolPlane.scale.clone();
        toolPlane.scale.multiplyScalar(BASE_WEAPON_PNG_SCALE);
      }

      try {
        return originalUpdateMatrixWorld.call(this, force);
      } finally {
        if (savedScale && toolPlane) {
          toolPlane.scale.copy(savedScale);
          toolPlane.updateMatrix?.();
        }
      }
    };

    Object.defineProperty(holder, '__weaponPngBaselineScaleHook', {
      value: true,
      configurable: true,
    });
    installed = true;
    global.__farmLog?.('[weapon-png-scale] legacy weapon-slot baseline=1.15 only for shapes without authored base scale', 'combat');
    return true;
  }

  function wrapStances(api) {
    if (!api?.init || api.__weaponPngScaleInitWrapped) return api;
    const originalInit = api.init;
    api.init = function weaponPngScaleAwareInit(deps) {
      const result = originalInit.call(this, deps);
      installScaleHook(deps);
      return result;
    };
    Object.defineProperty(api, '__weaponPngScaleInitWrapped', { value: true, configurable: true });
    return api;
  }

  if (global.WeaponToolStances) {
    global.WeaponToolStances = wrapStances(global.WeaponToolStances);
  } else {
    let value = null;
    Object.defineProperty(global, 'WeaponToolStances', {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(next) {
        value = wrapStances(next);
        Object.defineProperty(global, 'WeaponToolStances', {
          value,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      },
    });
  }

  global.HobunjiWeaponPngScale = Object.freeze({
    baseline: BASE_WEAPON_PNG_SCALE,
    eligibleWeapons: Object.freeze([...ELIGIBLE_WEAPONS]),
    authoredBaseScale,
    get installed() { return installed; },
  });
})(window);