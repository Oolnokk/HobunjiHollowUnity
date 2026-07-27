// Local Database Overrides — lets docs/tools/ editors (attack-animation-
// editor, loot-shop-editor) save an edited copy of a repo-tracked config JSON
// into localStorage and have the running game load THAT instead of the real
// file on disk, so tuning changes can be playtested before ever touching the
// repo. Purely additive: the repo's own JSON files stay the actual source of
// truth loaded by default (source mode 'repo') and nothing here writes to
// them — an override only takes effect once the player flips the "Database
// Source" toggle on the onboarding save-select screen (see onboarding.js's
// _dbSourceSectionHtml) to 'local', mirroring how docs/js/local-save-folder.js
// mirrors save data out to disk without being the primary read/write path.
//
// Each override is its own localStorage key (not one combined blob) so an
// editor can save/clear one database without disturbing the others, and so
// the onboarding UI can show a real per-database "last saved" timestamp.
(() => {
  "use strict";
  const SOURCE_MODE_KEY = 'hobunji_db_source_mode_v1'; // 'repo' | 'local'
  const OVERRIDE_KEY_PREFIX = 'hobunji_local_db_override_v1_';

  // The set of repo-tracked JSON databases this system knows how to
  // override. `repoPath` is relative to docs/ (same base every other fetch
  // in game.js/game tools already uses).
  //
  // Most of these are simple single-file databases: loadDatabase(id) below
  // returns either the whole saved override or the whole fetched repoPath
  // file, no further processing needed. Two are special-cased by their own
  // caller instead of going through loadDatabase (repoPath is still listed
  // here for documentation/UI purposes):
  //   - 'townWorkspace': game.js's _loadTownFromWorkspace() still does its
  //     own file-index-takes-priority merge afterward either way (same as
  //     it always has for the "Open Game" one-shot handoff), so the override
  //     just replaces the initial fetch of the workspace, same as any other
  //     single-file database — no special case actually needed there.
  //   - 'locales': the game reads config/locales/index.json then fetches
  //     each entry's own file separately, filtered by category, across TWO
  //     independent call sites (loadStampableLocaleDefs/
  //     loadBanditCampLocaleDefs in game.js) -- an override instead stores
  //     the full list of locale documents themselves (locale-editor's
  //     in-memory workspace, already-fetched content, not index stubs), so
  //     those two call sites read window.LocalDBOverrides.getOverride('locales')
  //     directly and filter/skip the index+per-file fetch themselves rather
  //     than calling loadDatabase().
  const DATABASES = [
    { id: 'attackValues',  label: 'Attack Values',      repoPath: 'config/combat/attack-values.json' },
    { id: 'lootPools',     label: 'Loot Pools',          repoPath: 'config/loot/loot-pools.json' },
    { id: 'shopStock',     label: 'Shop Stock',          repoPath: 'config/shops/shop-stock.json' },
    { id: 'npcDatabase',   label: 'NPC Database',        repoPath: 'config/npcs/hobunji-starter-npc-database.json' },
    { id: 'townWorkspace', label: 'Town / Map Data',     repoPath: 'config/town-workspace-v1.json' },
    { id: 'locales',       label: 'Locales',             repoPath: 'config/locales/index.json' },
  ];

  function dbById(id) { return DATABASES.find(d => d.id === id) || null; }
  function overrideKey(id) { return OVERRIDE_KEY_PREFIX + id; }

  function getSourceMode() {
    return localStorage.getItem(SOURCE_MODE_KEY) === 'local' ? 'local' : 'repo';
  }
  function setSourceMode(mode) {
    localStorage.setItem(SOURCE_MODE_KEY, mode === 'local' ? 'local' : 'repo');
  }

  function _readEnvelope(id) {
    const raw = localStorage.getItem(overrideKey(id));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function hasOverride(id) { return !!_readEnvelope(id); }
  function getOverride(id) { return _readEnvelope(id)?.data ?? null; }

  function setOverride(id, dataObj) {
    if (!dbById(id)) throw new Error('Unknown database id: ' + id);
    localStorage.setItem(overrideKey(id), JSON.stringify({ savedAt: Date.now(), data: dataObj }));
  }
  function clearOverride(id) { localStorage.removeItem(overrideKey(id)); }

  // For the onboarding "Database Source" panel — one row per known database,
  // regardless of whether it has an override yet.
  function listStatuses() {
    return DATABASES.map(d => {
      const env = _readEnvelope(d.id);
      return { id: d.id, label: d.label, hasOverride: !!env, savedAt: env?.savedAt || null };
    });
  }

  // What game.js/combat-config-loader.js actually call at boot in place of a
  // bare fetch(repoPath): local override wins only when the player has opted
  // into 'local' source mode AND actually saved one for this id; otherwise
  // (repo mode, or local mode with nothing saved yet) falls through to a
  // normal fetch of the real file, so a fresh browser profile with no
  // overrides behaves identically to before this system existed.
  async function loadDatabase(id) {
    const def = dbById(id);
    if (!def) throw new Error('Unknown database id: ' + id);
    if (getSourceMode() === 'local') {
      const override = getOverride(id);
      if (override) return override;
    }
    const resp = await fetch(def.repoPath);
    if (!resp.ok) throw new Error('Failed to fetch ' + def.repoPath + ' (' + resp.status + ')');
    return resp.json();
  }

  window.LocalDBOverrides = {
    DATABASES,
    getSourceMode, setSourceMode,
    hasOverride, getOverride, setOverride, clearOverride,
    listStatuses, loadDatabase,
  };
})();
