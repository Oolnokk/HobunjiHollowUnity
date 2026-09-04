// Hobunji Save Snapshot — portable browser-save adapter used by cloud persistence.
// It deliberately mirrors the existing local-folder save boundary without owning gameplay saves.
(() => {
  'use strict';

  const SAVE_META_KEY = 'hobunjiSaveMeta';
  const FARM_LAYOUT_KEY_PREFIX = 'hobunji_farm_layout_v3:';
  const SNAPSHOT_VERSION = 1;

  function farmLayoutKey(worldId) {
    return FARM_LAYOUT_KEY_PREFIX + worldId;
  }

  function parseJson(raw, label) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`${label} is unreadable: ${String(error?.message || error)}`);
    }
  }

  function validate(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('Save snapshot is missing.');
    if (!snapshot.meta || typeof snapshot.meta !== 'object') throw new Error('Save snapshot has no meta object.');
    if (!Array.isArray(snapshot.meta.characters)) throw new Error('Save snapshot has no character list.');
    if (!Array.isArray(snapshot.meta.worlds)) throw new Error('Save snapshot has no world list.');
    if (!snapshot.farmLayouts || typeof snapshot.farmLayouts !== 'object' || Array.isArray(snapshot.farmLayouts)) {
      throw new Error('Save snapshot has invalid farm layouts.');
    }
    return snapshot;
  }

  function capture({ strict = true } = {}) {
    const metaRaw = localStorage.getItem(SAVE_META_KEY);
    if (metaRaw == null) throw new Error('No browser save is available.');
    const meta = parseJson(metaRaw, 'Browser save metadata');
    const farmLayouts = {};

    for (const world of (meta?.worlds || [])) {
      if (!world?.id) continue;
      const raw = localStorage.getItem(farmLayoutKey(world.id));
      if (raw == null) continue;
      try {
        farmLayouts[world.id] = JSON.parse(raw);
      } catch (error) {
        if (strict) {
          throw new Error(`Farm layout for world "${world.label || world.id}" is unreadable: ${String(error?.message || error)}`);
        }
      }
    }

    return validate({
      snapshotVersion: SNAPSHOT_VERSION,
      meta,
      farmLayouts,
    });
  }

  function fingerprint(snapshot = null) {
    const value = snapshot || capture({ strict: false });
    const worldIds = (value.meta?.worlds || [])
      .map(world => String(world?.id || ''))
      .filter(Boolean)
      .sort();
    const parts = [JSON.stringify(value.meta || null)];
    for (const worldId of worldIds) {
      parts.push(worldId, JSON.stringify(value.farmLayouts?.[worldId] ?? null));
    }
    return parts.join('\u001f');
  }

  function apply(snapshot) {
    validate(snapshot);
    const validWorldIds = new Set((snapshot.meta.worlds || [])
      .map(world => String(world?.id || ''))
      .filter(Boolean));

    localStorage.setItem(SAVE_META_KEY, JSON.stringify(snapshot.meta));

    // Cloud snapshots are full snapshots, so remove obsolete farm-layout entries
    // before restoring the layouts belonging to the imported worlds.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith(FARM_LAYOUT_KEY_PREFIX)) continue;
      const worldId = key.slice(FARM_LAYOUT_KEY_PREFIX.length);
      if (!validWorldIds.has(worldId)) localStorage.removeItem(key);
    }

    for (const [worldId, layout] of Object.entries(snapshot.farmLayouts || {})) {
      if (!validWorldIds.has(String(worldId))) continue;
      localStorage.setItem(farmLayoutKey(worldId), JSON.stringify(layout));
    }

    return summary(snapshot);
  }

  function summary(snapshot = null) {
    const value = snapshot || capture({ strict: false });
    const validWorldIds = new Set((value.meta?.worlds || [])
      .map(world => String(world?.id || ''))
      .filter(Boolean));
    const farmLayoutCount = Object.keys(value.farmLayouts || {})
      .filter(worldId => validWorldIds.has(String(worldId))).length;
    return {
      snapshotVersion: Number(value.snapshotVersion) || SNAPSHOT_VERSION,
      characterCount: (value.meta?.characters || []).length,
      worldCount: (value.meta?.worlds || []).length,
      farmLayoutCount,
    };
  }

  window.HobunjiSaveSnapshot = {
    SAVE_META_KEY,
    FARM_LAYOUT_KEY_PREFIX,
    SNAPSHOT_VERSION,
    capture,
    validate,
    apply,
    fingerprint,
    summary,
  };
})();
