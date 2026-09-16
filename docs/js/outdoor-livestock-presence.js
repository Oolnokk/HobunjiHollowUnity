(() => {
  'use strict';
  if (window.OutdoorLivestockPresence) return;

  // Owns only the world-presence transition for adult livestock with no barn.
  // Nursery owns life stages/UI; OutdoorLivestockWelfare owns night/production
  // consequences. This bridge prevents the old core "barnId:null = stasis"
  // contract from deleting an adult that is explicitly meant to live outside.
  let deps = null; // Captured from FarmAnimals.init; used for saved records and live world registries.
  let installed = false; // Prevents duplicate API wrapping when the farm feature bridge runs more than once.
  let originalRespawnWorldLivestock = null; // Used for a single-record native-factory repair without recursing through our wrapper.
  let lastTransitions = []; // Mobile-friendly history of the most recent presence repairs/unassignments.

  function isAdult(entry) {
    if (!entry || entry.lifeStage === 'baby') return false;
    if (entry.lifeStage === 'adult') return true;
    return !Object.prototype.hasOwnProperty.call(entry, 'barnId') || entry.barnId != null;
  }

  function isOutdoorAdult(entry) {
    return isAdult(entry) && entry.barnId == null;
  }

  function currentArea() {
    return deps?.getCurrentArea?.()
      || window.GridTileAccessors?.getCurrentArea?.()
      || window.__hobunjiFurnitureDebug?.getCurrentArea?.()
      || null;
  }

  function findLiveAnimal(livestockId) {
    for (const animal of deps?.animalObjects || []) {
      if (animal?.livestockId === livestockId) return animal;
    }
    return null;
  }

  function realBuiltBarns() {
    return (deps?.getFarmBuildings?.() || []).filter(entry =>
      entry?.kind === 'barn' && entry.stage === 'built' && !entry.nursery && entry.tier !== 'nursery');
  }

  function anyBuiltBarn() {
    return (deps?.getFarmBuildings?.() || []).find(entry => entry?.kind === 'barn' && entry.stage === 'built') || null;
  }

  function openSpotNear(anchor) {
    if (!anchor) return null;
    return window.FarmBuildings?.findOpenTileNear?.(anchor)
      || deps?.findOpenTileNearBarn?.(anchor)
      || null;
  }

  function firstOpenFarmTile() {
    const cols = Math.max(0, Number(deps?.COLS) || 0);
    const rows = Math.max(0, Number(deps?.ROWS) || 0);
    if (!cols || !rows || typeof window.FarmAnimals?.canSpawnAt !== 'function') return null;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (window.FarmAnimals.canSpawnAt(col, row)) return { col, row };
      }
    }
    return null;
  }

  function chooseOutdoorSpot(entry, preferredBarn) {
    const savedCol = Number(entry?.col);
    const savedRow = Number(entry?.row);
    if (Number.isFinite(savedCol) && Number.isFinite(savedRow)
      && window.FarmAnimals?.canSpawnAt?.(savedCol, savedRow)) {
      return { col: savedCol, row: savedRow };
    }
    const preferred = openSpotNear(preferredBarn);
    if (preferred) return preferred;
    for (const barn of realBuiltBarns()) {
      const spot = openSpotNear(barn);
      if (spot) return spot;
    }
    return openSpotNear(anyBuiltBarn()) || firstOpenFarmTile();
  }

  function placeExistingAnimalOutside(animal, entry, preferredBarn) {
    if (!animal) return false;
    const group = animal.avatarRef?.group;
    const hiddenInBarn = animal._barnHome === true || group?.visible === false;
    let col = Number(animal.col);
    let row = Number(animal.row);

    if (hiddenInBarn || !Number.isFinite(col) || !Number.isFinite(row)) {
      const spot = chooseOutdoorSpot(entry, preferredBarn);
      if (!spot) return false;
      col = spot.col;
      row = spot.row;
      animal.col = col;
      animal.row = row;
      animal.targetCol = col;
      animal.targetRow = row;
      animal.wx = col + 0.5;
      animal.wz = row + 0.5;
      animal.homeCol = col;
      animal.homeRow = row;
      animal.wanderTargetCol = null;
      animal.wanderTargetRow = null;
      animal.wanderWaitT = 0;
      animal.wanderPhase = 'pick';
    }

    animal._barnHome = false;
    if (group) group.visible = true;
    entry.col = col;
    entry.row = row;
    deps?.worldObjects?.set?.(col + ',' + row, animal);
    return true;
  }

  function nativeSpawnMissingOutdoorAdult(entry, preferredBarn) {
    if (!entry || !originalRespawnWorldLivestock || currentArea() !== 'farm') return null;
    const existing = findLiveAnimal(entry.id);
    if (existing) return existing;

    const list = deps?.loadWorldLivestock?.() || [];
    const savedLoad = deps.loadWorldLivestock; // Temporarily narrows native respawn to this one record so no housed animal is duplicated.
    const savedSave = deps.saveWorldLivestock; // Prevents the temporary spawn-anchor barn ID from ever entering persistence.
    const savedBarnId = entry.barnId;
    const anchor = preferredBarn || realBuiltBarns()[0] || anyBuiltBarn();
    const directSpot = chooseOutdoorSpot(entry, preferredBarn || anchor);
    if (directSpot) { entry.col = directSpot.col; entry.row = directSpot.row; }

    try {
      deps.loadWorldLivestock = () => [entry];
      deps.saveWorldLivestock = () => {};
      if (anchor) {
        // Core respawn already knows how to build every livestock species when
        // a built barn is present. Borrow that spawn anchor for this call only;
        // the record is restored to outdoors before any save can occur.
        entry.barnId = anchor.id;
      } else {
        // Farms with no barn at all still get the old legacy-roamer factory path.
        delete entry.barnId;
      }
      originalRespawnWorldLivestock.call(window.FarmAnimals);
    } finally {
      entry.barnId = savedBarnId == null ? null : savedBarnId;
      deps.loadWorldLivestock = savedLoad;
      deps.saveWorldLivestock = savedSave;
    }

    const spawned = findLiveAnimal(entry.id);
    if (spawned) {
      entry.col = spawned.col;
      entry.row = spawned.row;
      spawned._barnHome = false;
      if (spawned.avatarRef?.group) spawned.avatarRef.group.visible = true;
      deps.worldObjects?.set?.(spawned.col + ',' + spawned.row, spawned);
      savedSave?.(list);
    }
    return spawned;
  }

  function refreshWelfare() {
    window.OutdoorLivestockWelfare?.refreshStatuses?.();
    window.OutdoorLivestockWelfare?.patchAllLiveAnimals?.();
  }

  function ensureOutdoorAdultPresent(entry, preferredBarn = null, reason = 'repair') {
    if (!isOutdoorAdult(entry) || currentArea() !== 'farm') return null;
    let animal = findLiveAnimal(entry.id);
    let action = 'kept-live';
    if (animal) {
      if (!placeExistingAnimalOutside(animal, entry, preferredBarn)) animal = null;
      else action = animal._barnHome ? 'woke-existing' : 'kept-live';
    }
    if (!animal) {
      animal = nativeSpawnMissingOutdoorAdult(entry, preferredBarn);
      action = animal ? 'respawned-missing' : 'respawn-failed';
    }
    if (animal) deps?.saveWorldLivestock?.(deps.loadWorldLivestock());
    refreshWelfare();
    lastTransitions.push({ id: entry.id, name: entry.name, kind: entry.kind, reason, action, col: animal?.col ?? null, row: animal?.row ?? null });
    if (lastTransitions.length > 12) lastTransitions.splice(0, lastTransitions.length - 12);
    return animal;
  }

  function ensureAllOutdoorAdults(reason = 'scan') {
    if (currentArea() !== 'farm') return 0;
    const list = deps?.loadWorldLivestock?.() || [];
    let repaired = 0;
    for (const entry of list) {
      if (!isOutdoorAdult(entry)) continue;
      const before = !!findLiveAnimal(entry.id);
      const animal = ensureOutdoorAdultPresent(entry, null, reason);
      if (!before && animal) repaired++;
    }
    return repaired;
  }

  function unassignAdultWithoutDespawn(livestockId) {
    if (!deps) return null;
    if (deps.hasFarmPermission?.('livestock') === false) {
      return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
    }
    const list = deps.loadWorldLivestock?.() || [];
    const entry = list.find(item => item.id === livestockId);
    if (!entry) return { ok: false, message: 'Animal not found.' };
    if (!isAdult(entry)) return { ok: false, message: 'Nursery babies can only leave by growing up.' };
    if (entry.barnId == null) {
      ensureOutdoorAdultPresent(entry, null, 'already-outdoors');
      return { ok: true, message: `${entry.name} is already living outdoors.` };
    }

    const oldBarn = (deps.getFarmBuildings?.() || []).find(barn => barn.id === entry.barnId) || null;
    const oldVatId = entry.assignedVatId;
    entry.lifeStage = 'adult';
    entry.barnId = null;
    entry.troughIndex = null;
    entry.assignedVatId = null;
    if (oldVatId) window.FarmAnimals?.clearVatWorkerPose?.(oldVatId);

    const live = findLiveAnimal(entry.id);
    if (live) placeExistingAnimalOutside(live, entry, oldBarn);
    deps.saveWorldLivestock?.(list);
    ensureOutdoorAdultPresent(entry, oldBarn, live ? 'unbarn-preserved' : 'unbarn-repaired');
    return { ok: true, message: `${entry.name} is living outdoors and will lose happiness each night until housed.` };
  }

  function install() {
    const animals = window.FarmAnimals;
    if (installed || !animals) return installed;
    installed = true;

    const originalInit = animals.init; // Nursery has already wrapped this when the farm feature bridge installs us.
    animals.init = function outdoorPresenceInit(injectedDeps, ...rest) {
      deps = injectedDeps;
      const result = originalInit.call(this, injectedDeps, ...rest);
      queueMicrotask(() => ensureAllOutdoorAdults('post-init'));
      return result;
    };

    originalRespawnWorldLivestock = animals.respawnWorldLivestock;
    animals.respawnWorldLivestock = function outdoorPresenceRespawn(...args) {
      const result = originalRespawnWorldLivestock.apply(this, args);
      ensureAllOutdoorAdults('world-respawn');
      return result;
    };

    // Replace Nursery's destructive remove-then-respawn transition. A housed
    // daytime animal is already the correct world entity, so preserve it. A
    // barn-hidden nighttime animal is the same entity made visible outside.
    animals.unassignFromBarn = function outdoorPresenceUnassign(livestockId) {
      return unassignAdultWithoutDespawn(livestockId);
    };

    if (deps) queueMicrotask(() => ensureAllOutdoorAdults('install'));
    return true;
  }

  function debugSnapshot() {
    const records = deps?.loadWorldLivestock?.() || [];
    const outdoor = records.filter(isOutdoorAdult);
    return {
      mostRecentChange: 'Unbarning preserves the existing live animal; missing outdoor adults are repaired with the native species factory instead of destructive remove-then-legacy-respawn.',
      installed,
      currentArea: currentArea(),
      outdoorAdults: outdoor.map(entry => {
        const live = findLiveAnimal(entry.id);
        return {
          id: entry.id,
          name: entry.name,
          kind: entry.kind,
          live: !!live,
          col: live?.col ?? entry.col ?? null,
          row: live?.row ?? entry.row ?? null,
          visible: live?.avatarRef?.group?.visible !== false,
          barnHome: live?._barnHome === true,
        };
      }),
      missingOutdoorAdults: outdoor.filter(entry => !findLiveAnimal(entry.id)).map(entry => ({ id: entry.id, name: entry.name, kind: entry.kind })),
      lastTransitions: [...lastTransitions],
    };
  }

  window.OutdoorLivestockPresence = { install, ensureAllOutdoorAdults, ensureOutdoorAdultPresent, debugSnapshot };
  window.__outdoorLivestockPresenceDebug = { snapshot: debugSnapshot, repair: () => ensureAllOutdoorAdults('manual-debug-repair') };
})();