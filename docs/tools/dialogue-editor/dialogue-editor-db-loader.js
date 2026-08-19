'use strict';
(() => {
  const localDb = window.LocalDBOverrides;
  if (!localDb) return;

  // Dialogue Editor lives two directories below docs/, while LocalDBOverrides' repo paths
  // are docs-relative. Resolve those paths from this script so nested tools do not fetch
  // docs/tools/dialogue-editor/config/... by mistake.
  const docsRoot = new URL('../../', document.currentScript?.src || location.href);
  const dbPaths = {
    shopStock: 'config/shops/shop-stock.json',
    npcDatabase: 'config/npcs/hobunji-starter-npc-database.json'
  };
  const scheduleOverridesPath = 'config/npcs/schedule-overrides.json';
  const originalLoadDatabase = localDb.loadDatabase.bind(localDb);
  const docsUrl = path => new URL(path, docsRoot).href;

  async function loadRaw(id) {
    if (!dbPaths[id]) return originalLoadDatabase(id);
    if (localDb.getSourceMode?.() === 'local' && localDb.hasOverride?.(id)) {
      return localDb.getOverride(id);
    }
    const response = await fetch(docsUrl(dbPaths[id]));
    if (!response.ok) throw new Error(`Failed to fetch ${dbPaths[id]} (${response.status})`);
    return response.json();
  }

  localDb.loadDatabase = async function loadDialogueEditorDatabase(id) {
    let data = await loadRaw(id);
    if (id !== 'npcDatabase') return data;

    try {
      const response = await fetch(docsUrl(scheduleOverridesPath));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = localDb.applyNpcScheduleOverrides(data, await response.json());
    } catch (error) {
      console.warn('[DialogueEditor] Could not compose NPC schedule overrides:', error);
    }

    try {
      const shopStock = await loadRaw('shopStock');
      data = localDb.applyShopDialogueAccess(data, shopStock);
    } catch (error) {
      console.warn('[DialogueEditor] Could not compose Shop or Chat dialogue trees:', error);
    }
    return data;
  };
})();
