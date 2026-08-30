(() => {
  'use strict';

  const OVERRIDES_URL = './config/npcs/player-nickname-overrides.json';

  // Apply reviewed player-address replacements without rewriting the very
  // large starter NPC database. Pool ids are stable dialogue-editor ids.
  async function applyToDatabase(database) {
    if (!database || !Array.isArray(database.npcs)) return database;

    let config;
    try {
      const response = await fetch(OVERRIDES_URL, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      config = await response.json();
    } catch (error) {
      console.warn('[NpcPlayerNicknameOverrides] Could not load nickname overrides:', error);
      return database;
    }

    const pools = config?.pools;
    if (!pools || typeof pools !== 'object') return database;

    for (const npc of database.npcs) {
      if (!Array.isArray(npc?.phrasePools)) continue;
      for (const pool of npc.phrasePools) {
        const replacementTexts = pools[pool?.id];
        if (!Array.isArray(replacementTexts) || !replacementTexts.length) continue;

        const oldEntries = Array.isArray(pool.entries) ? pool.entries : [];
        const template = oldEntries[0] || {};
        pool.entries = replacementTexts.map((text, index) => {
          const oldEntry = oldEntries[index] || template;
          return {
            ...oldEntry,
            id: oldEntry.id || `${pool.id}_entry_${index + 1}`,
            text: String(text),
          };
        });
      }
    }

    return database;
  }

  window.NpcPlayerNicknameOverrides = Object.freeze({ applyToDatabase });
})();
