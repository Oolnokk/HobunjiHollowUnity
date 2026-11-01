// Furniture-bound NPC wardrobes. No dedicated action-arch buttons or aim approximation:
// FurnitureTableSystem owns the real camera hit, prompt anchor and obj_* dispatch.
(() => {
  'use strict';
  if (Number(window.NpcFurnitureWardrobes?.version) >= 5) return;

  const DEFAULT_CONFIG = Object.freeze({
    metadataKey: 'npcWardrobeFor',
    placeholderEnabled: true,
    placeholderRegistryUrl: 'config/npcs/placeholder-wardrobes.json',
    placeholderNpcDatabaseUrl: 'config/npcs/hobunji-starter-npc-database.json',
    targetRadiusTiles: 0.82,
  }); // Existing authored map metadata and generated registry remain the storage authority.
  const rootConfig = window.SCRATCHBONES_CONFIG = window.SCRATCHBONES_CONFIG || {}; // Shared gameplay configuration holder.
  rootConfig.game = rootConfig.game || {};
  const config = rootConfig.game.npcWardrobes = { ...DEFAULT_CONFIG, ...(rootConfig.game.npcWardrobes || {}) };
  const areaBindings = new Map(); // Loaded map-area furniture IDs -> NPC owner, used by the live placement targeter.
  const pendingAreas = new Map(); // Deduplicates async interior JSON/registry requests.
  const mapCache = new Map(); // Reuses per-area authored furniture reads.
  let npcDatabasePromise = null; // Runtime-effective NPCs, including local database removals.
  let registryPromise = null; // One shared generated placeholder registry.
  let lastError = null; // Copyable mobile diagnostic for failed data loads.
  let lastOpened = null; // Mobile diagnostic showing the exact furniture/character opened.

  const safeId = value => String(value || '').trim();
  const isInteriorMap = area => typeof area === 'string' && /^map_i_/.test(area);
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function loadMap(area) {
    if (!isInteriorMap(area)) return Promise.resolve(null);
    if (!mapCache.has(area)) {
      mapCache.set(area, fetch('config/maps/' + encodeURIComponent(area) + '.json', { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error(area + ': HTTP ' + response.status);
          return response.json();
        }).catch(error => { lastError = String(error?.message || error); return null; }));
    }
    return mapCache.get(area);
  }

  function loadNpcDatabase() {
    if (!npcDatabasePromise) {
      const request = window.LocalDBOverrides?.loadDatabase
        ? window.LocalDBOverrides.loadDatabase('npcDatabase')
        : fetch(config.placeholderNpcDatabaseUrl, { cache: 'no-store' }).then(response => {
          if (!response.ok) throw new Error('NPC database HTTP ' + response.status);
          return response.json();
        });
      npcDatabasePromise = Promise.resolve(request).catch(error => {
        lastError = String(error?.message || error); return null;
      });
    }
    return npcDatabasePromise;
  }

  function loadPlaceholderRegistry() {
    if (!config.placeholderEnabled) return Promise.resolve(null);
    if (!registryPromise) {
      registryPromise = fetch(config.placeholderRegistryUrl, { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error('NPC wardrobe registry HTTP ' + response.status);
        return response.json();
      }).catch(error => { lastError = String(error?.message || error); return null; });
    }
    return registryPromise;
  }

  function authoredWardrobeBindings(mapData) {
    return (mapData?.furniture || []).filter(piece => safeId(piece?.[config.metadataKey]))
      .map(piece => ({
        id: piece.id || null, itemKey: piece.itemKey || null,
        col: finite(piece.col), row: finite(piece.row),
        npcId: safeId(piece[config.metadataKey]),
        interactionRadiusTiles: Math.max(0.1, finite(piece.npcWardrobeInteractionRadiusTiles, config.targetRadiusTiles)),
        source: 'authored',
      }));
  }

  function placeholderWardrobeBindings(mapData, area, npcDatabase, registry) {
    if (!config.placeholderEnabled || !isInteriorMap(area) || !npcDatabase || !registry?.assignments) return [];
    const activeIds = new Set((npcDatabase.npcs || []).map(npc => safeId(npc?.id)).filter(Boolean)); // Inactive/removed NPCs never reappear via fallbacks.
    const authored = authoredWardrobeBindings(mapData);
    const authoredIds = new Set(authored.map(binding => binding.npcId));
    const furnitureById = new Map((mapData?.furniture || []).filter(piece => piece?.id).map(piece => [String(piece.id), piece]));
    const result = [];
    for (const [npcId, assignment] of Object.entries(registry.assignments)) {
      if (assignment?.area !== area || !activeIds.has(npcId) || authoredIds.has(npcId)) continue;
      const piece = furnitureById.get(safeId(assignment.furnitureId));
      if (!piece || safeId(piece[config.metadataKey])) continue;
      result.push({
        id: piece.id, itemKey: piece.itemKey || assignment.itemKey || null,
        col: finite(piece.col), row: finite(piece.row), npcId,
        interactionRadiusTiles: Math.max(0.1, finite(piece.npcWardrobeInteractionRadiusTiles, config.targetRadiusTiles)),
        source: 'placeholder-registry', placeholderReason: assignment.reason || null,
      });
    }
    return result;
  }

  function wardrobeBindings(mapData, area = null, npcDatabase = null, registry = null) {
    const authored = authoredWardrobeBindings(mapData);
    return !area || !npcDatabase || !registry ? authored
      : [...authored, ...placeholderWardrobeBindings(mapData, area, npcDatabase, registry)];
  }

  function primeArea(area) {
    if (!isInteriorMap(area)) return null; // House lookups run each frame; never allocate a Promise for an unsupported area.
    if (!pendingAreas.has(area)) {
      const request = Promise.all([loadMap(area), loadNpcDatabase(), loadPlaceholderRegistry()]).then(([map, database, registry]) => {
        const bindings = map ? wardrobeBindings(map, area, database, registry) : [];
        const byId = new Map(bindings.filter(binding => binding.id).map(binding => [String(binding.id), binding]));
        areaBindings.set(area, byId);
        window.FurnitureTableSystem?.invalidateFocus?.(); // The next ordinary action refresh discovers newly loaded furniture owners.
        return byId;
      }).catch(error => {
        lastError = String(error?.stack || error?.message || error);
        pendingAreas.delete(area); // A later visit can retry a transient failure.
        return null;
      });
      pendingAreas.set(area, request);
    }
    return pendingAreas.get(area);
  }

  function familyOwners() {
    const owners = [];
    const spouse = window.RomanceSystem?.getSpouse?.();
    if (safeId(spouse?.npcId)) {
      const id = safeId(spouse.npcId);
      owners.push({ id, name: window.RomanceSystem?.helpers?.npcName?.(id) || id, role: 'Spouse' });
    }
    for (const child of window.RomanceFamily?.snapshot?.()?.children || []) {
      const id = safeId(child?.id);
      if (id && !owners.some(owner => owner.id === id)) owners.push({ id, name: child.name || id, role: 'Child' });
    }
    return owners;
  }

  function isFamilyOwner(id) {
    const candidate = safeId(id); // Targeted chest owner checked on every game frame, without a family snapshot allocation.
    if (!candidate) return false;
    if (safeId(window.RomanceSystem?.getSpouse?.()?.npcId) === candidate) return true;
    if (window.RomanceFamily?.isWardrobeChild) return !!window.RomanceFamily.isWardrobeChild(candidate);
    return !!window.RomanceFamily?.snapshot?.()?.children?.some(child => child.id === candidate); // Compatibility with older family adapters.
  }

  function isFamilyStorage(record) {
    return record?.key === 'wardrobe' || record?.key === 'chest'
      || record?.itemKey === 'wardrobeFurniture' || record?.itemKey === 'chestFurniture';
  }

  function ownerForPlacement(area, record) {
    if (!record) return null;
    if (area === 'interior') {
      const ownerId = safeId(record[config.metadataKey]);
      if (!isFamilyStorage(record) || !isFamilyOwner(ownerId)) return null;
      return { npcId: ownerId, source: 'family', furnitureId: safeId(record.id) };
    }
    if (!isInteriorMap(area)) return null;
    const authoredOwner = safeId(record[config.metadataKey]);
    if (authoredOwner) return { npcId: authoredOwner, source: 'authored', furnitureId: safeId(record.id) };
    const assigned = areaBindings.get(area)?.get(safeId(record.id));
    return assigned ? { npcId: assigned.npcId, source: assigned.source, furnitureId: safeId(record.id) } : null;
  }

  function nameForOwner(id) {
    const child = window.RomanceFamily?.wardrobeChildName?.(id); // A dynamic child nickname is read directly, without serializing the family each frame.
    if (child) return child;
    return window.RomanceSystem?.helpers?.npcName?.(id)
      || familyOwners().find(owner => owner.id === id)?.name
      || safeId(id).replace(/[_-]+/g, ' ');
  }

  function openWardrobe(npcId, area = null, furnitureId = null) {
    if (!safeId(npcId) || !window.NpcWardrobe?.openWardrobePanel) return false;
    const binding = areaBindings.get(area)?.get(safeId(furnitureId)); // The live furniture binding distinguishes family-assigned storage from authored NPC wardrobes.
    window.NpcWardrobe.openWardrobePanel(npcId, { area, source: binding?.source || 'authored', furnitureId }); // Only the actual family-assigned spouse furniture receives the special clothing override.
    lastOpened = { npcId, area, furnitureId };
    return true;
  }

  function debugSnapshot() {
    return {
      installed: true, version: 5, targeting: 'FurnitureTableSystem camera ray', floatingPrompts: true,
      legacyNpcButtonInjection: false,
      loadedAreas: [...areaBindings].map(([area, bindings]) => ({ area, count: bindings.size, furniture: [...bindings].map(([id, binding]) => ({ id, npcId: binding.npcId, source: binding.source })) })),
      loadingAreas: [...pendingAreas.keys()], familyOwners: familyOwners(), lastOpened, error: lastError,
    };
  }

  window.NpcFurnitureWardrobes = Object.freeze({
    installed: true, version: 5, eventDriven: true, config, loadMap, loadNpcDatabase, loadPlaceholderRegistry,
    authoredWardrobeBindings, placeholderWardrobeBindings, wardrobeBindings,
    primeArea, ownerForPlacement, familyOwners, isFamilyOwner, isFamilyStorage,
    nameForOwner, openWardrobe, debugSnapshot,
  });
  window.__npcFurnitureWardrobeDebug = debugSnapshot; // Mobile Pixel Probe / copyable in-page diagnostic.
})();
