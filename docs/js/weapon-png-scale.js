// Gives weapon-slot PNGs a small baseline enlargement without touching weapons
// that already author their own larger scale (the ranged weapons are 1.77x).
// This is deliberately a render-time multiplier around WeaponToolStances so tool
// mode keeps its existing sprite size and no permanent mesh scale accumulates.
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
      const shouldUpscale = !!toolPlane
        && ELIGIBLE_WEAPONS.has(itemKey)
        // Respect any current/future animation that already enlarges the weapon.
        && holderScale <= 1.0001;

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
    global.__farmLog?.('[weapon-png-scale] weapon-slot baseline=1.15 for unscaled melee/tool weapons', 'combat');
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
    get installed() { return installed; },
  });
})(window);