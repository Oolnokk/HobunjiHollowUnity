(() => {
  'use strict';
  if (window.LivestockNurseryOutdoorGrowth) return;

  // LivestockNursery historically required a free barn stall before a baby
  // could mature, even though adult livestock already have a supported
  // outdoors state. Keep the Nursery's normal open-stall path untouched, but
  // turn only its no-stall failure into a successful outdoor maturation. This
  // module loads before AnimalGrowth, so AnimalGrowth's public growBaby wrapper
  // remains the single authority that checks/consumes the Growth Tonic.
  let animalDeps = null; // Captured from FarmAnimals.init for livestock persistence and permission checks.
  let originalFarmAnimalsInit = null; // Preserves the existing Nursery/FarmAnimals wrapper chain while capturing deps.
  let originalGrowBaby = null; // Preserves LivestockNursery's ordinary move-into-open-barn maturation path.
  let installed = false; // Makes parser/runtime bridge installs idempotent.
  let mostRecentChange = 'Outdoor Nursery maturation compatibility loaded.'; // Mobile-copyable diagnostic for the latest growth fallback.

  function isBarnCapacityFailure(result) {
    if (result?.ok !== false) return false;
    const message = String(result?.message || '');
    return /No adult barn space is available/i.test(message) || /No adult barn has an open stall/i.test(message);
  }

  function promoteOutdoors(livestockId) {
    if (animalDeps?.hasFarmPermission?.('livestock') === false) {
      return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
    }
    const list = animalDeps?.loadWorldLivestock?.();
    if (!Array.isArray(list)) return { ok: false, message: 'Farm livestock data is unavailable.' };
    const entry = list.find(item => String(item?.id) === String(livestockId));
    if (!entry || !window.LivestockNursery?.isBaby?.(entry)) {
      return { ok: false, message: 'That Nursery baby was not found.' };
    }

    entry.lifeStage = 'adult';
    entry.barnId = null;
    entry.troughIndex = null;
    entry.assignedVatId = null;
    animalDeps.saveWorldLivestock?.(list);

    // Exterior adults already use LivestockNursery's respawn wrapper, which
    // relocates invalid/missing coordinates near the Nursery when needed. Do
    // this only while the farm exterior is actually live; other areas will
    // naturally materialize the saved outdoor adult on the next farm load.
    if (animalDeps?.getCurrentArea?.() === 'farm') {
      try { window.FarmAnimals?.respawnWorldLivestock?.(); }
      catch (error) { console.warn('[NurseryOutdoorGrowth] outdoor adult respawn failed:', error); }
    }
    window.LivestockNursery?.rerollSwarm?.();
    mostRecentChange = `Grew Nursery baby ${entry.id} outdoors because no adult barn stall was free.`;
    return {
      ok: true,
      entry,
      outdoors: true,
      message: `${entry.name || 'The animal'} grew up and is living outdoors until you assign it to a barn.`,
    };
  }

  function wrapFarmAnimals() {
    const api = window.FarmAnimals;
    if (!api?.init) return false;
    if (api.init.__nurseryOutdoorGrowthDepsCapture) return true;
    originalFarmAnimalsInit = api.init;
    const wrapped = function nurseryOutdoorGrowthFarmAnimalsInit(injectedDeps, ...args) {
      animalDeps = injectedDeps || null;
      return originalFarmAnimalsInit.call(this, injectedDeps, ...args);
    };
    Object.defineProperty(wrapped, '__nurseryOutdoorGrowthDepsCapture', { value: true });
    api.init = wrapped;
    return true;
  }

  function wrapNurseryGrow() {
    const nursery = window.LivestockNursery;
    if (!nursery?.growBaby) return false;
    if (nursery.growBaby.__nurseryOutdoorGrowth) return true;
    originalGrowBaby = nursery.growBaby;
    const wrapped = function nurseryGrowWithOutdoorFallback(livestockId, ...args) {
      const result = originalGrowBaby.call(this, livestockId, ...args);
      if (!isBarnCapacityFailure(result)) return result;
      return promoteOutdoors(livestockId);
    };
    Object.defineProperty(wrapped, '__nurseryOutdoorGrowth', { value: true });
    nursery.growBaby = wrapped;
    return true;
  }

  function debugSnapshot() {
    return {
      installed,
      depsReady: !!animalDeps,
      growWrapped: !!window.LivestockNursery?.growBaby?.__nurseryOutdoorGrowth,
      mostRecentChange,
      adults: Number(window.LivestockNursery?.adultCount?.()) || 0,
      barnCapacity: Number(window.LivestockNursery?.adultCapacity?.()) || 0,
    };
  }

  function install() {
    wrapFarmAnimals();
    wrapNurseryGrow();
    installed = true;
    return true;
  }

  window.LivestockNurseryOutdoorGrowth = { install, debugSnapshot };
  window.__livestockNurseryOutdoorGrowthDebug = { snapshot: debugSnapshot };
  install();
})();