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

  let _runtimeSuppressedNpcIds = []; // Used by runtime/debug inspection to report NPC records intentionally excluded from live spawning.

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

  // Loads one database without any cross-database post-processing. Used by
  // loadDatabase() itself so NPC/shop composition cannot recurse.
  async function _loadRawDatabase(id) {
    const def = dbById(id); // Used to resolve the repo path for this database id.
    if (!def) throw new Error('Unknown database id: ' + id);
    if (getSourceMode() === 'local') {
      const override = getOverride(id); // Used as the opted-in local source when one exists.
      if (override) return override;
    }
    const resp = await fetch(def.repoPath); // Used to fetch the repository source when no local override applies.
    if (!resp.ok) throw new Error('Failed to fetch ' + def.repoPath + ' (' + resp.status + ')');
    return resp.json();
  }

  function _dialogueConditionsForMaps(mapIds) {
    return {
      weekdays: [], seasons: [], weather: [], timesOfDay: [], encounter: [],
      maps: Array.isArray(mapIds) ? [...mapIds] : [], stations: [], playerSpecies: [],
      relationship: { min: null, max: null },
    };
  }

  function _safeDialogueId(value) {
    return String(value || 'shop').replace(/[^a-zA-Z0-9_]+/g, '_');
  }

  // Builds a runtime-compatible Shop or Chat tree. The Access Shop node is
  // stored as a normal choice node plus editorType metadata, so old runtime
  // builds still understand it. The parent Shop choice also carries openShop
  // directly, making access a single click while retaining the visual graph edge.
  function _buildShopOrChatTree(poolId, shop, sellerId) {
    const idStem = `${_safeDialogueId(poolId)}_${_safeDialogueId(sellerId)}`; // Used to keep generated tree/node ids deterministic per seller and pool.
    const choiceNodeId = `n_shop_or_chat_${idStem}`; // Used as the generated tree's entry choice node.
    const accessNodeId = `n_access_shop_${idStem}`; // Used as the visible Access Shop graph node and fallback runtime target.
    const access = shop?.dialogueAccess || {}; // Used to gate fixed shopkeepers to their business map.
    const businessMaps = access.roaming ? [] : (access.businessMaps || []); // Used as map conditions; roaming merchants intentionally remain unrestricted.
    return {
      id: `tree_shop_or_chat_${idStem}`,
      label: 'Shop or Chat',
      trigger: 'interact',
      priority: 50,
      entryNode: choiceNodeId,
      generatedFromShopAccess: true,
      shopPool: poolId,
      conditions: _dialogueConditionsForMaps(businessMaps),
      excludeConditions: _dialogueConditionsForMaps([]),
      nodes: [
        {
          id: choiceNodeId,
          type: 'choice',
          choices: [
            {
              label: 'Shop',
              next: accessNodeId,
              actions: [{ type: 'openShop', pool: poolId, sourceNodeId: accessNodeId }],
            },
            {
              label: 'Chat',
              actions: [{ type: 'startChat' }],
            },
          ],
          tags: [],
        },
        {
          id: accessNodeId,
          type: 'choice',
          editorType: 'accessShop',
          shopPool: poolId,
          choices: [{ label: 'Access shop', actions: [{ type: 'openShop', pool: poolId }] }],
          tags: [],
        },
      ],
    };
  }

  // Shop Stock owns the seller/pool/business relationship. Compose its
  // deterministic authoring trees into the NPC database at load time instead
  // of duplicating that relationship by hand in a second giant JSON file.
  function applyShopDialogueAccess(npcDatabase, shopStock) {
    if (!npcDatabase || !Array.isArray(npcDatabase.npcs)) return npcDatabase;
    const merged = JSON.parse(JSON.stringify(npcDatabase)); // Used as a non-mutating NPC database copy returned to the game/editor.
    const npcById = new Map(merged.npcs.map(npc => [npc.id, npc])); // Used to resolve Shop Stock seller ids to NPC records efficiently.
    const shops = shopStock?.shops || {}; // Used as the authoritative set of sale pools and dialogue-access metadata.

    for (const [poolId, shop] of Object.entries(shops)) {
      const access = shop?.dialogueAccess; // Used to decide whether this shop participates in NPC dialogue access.
      if (!access || !Array.isArray(access.sellerIds)) continue;
      if (!access.roaming && !(access.businessMaps || []).length) continue;
      for (const sellerId of access.sellerIds) {
        const npc = npcById.get(sellerId); // Used as the destination for this seller's generated Shop or Chat tree.
        if (!npc) {
          console.warn(`[LocalDBOverrides] Shop seller ${sellerId} for ${poolId} is missing from the NPC database.`);
          continue;
        }
        if (!Array.isArray(npc.dialogueTrees)) npc.dialogueTrees = [];
        const tree = _buildShopOrChatTree(poolId, shop, sellerId); // Used as the deterministic generated tree for this seller/pool pair.
        if (!npc.dialogueTrees.some(existing => existing.id === tree.id)) npc.dialogueTrees.push(tree);
      }
    }
    return merged;
  }

  // Lifecycle is authored in the NPC record itself rather than a second
  // runtime-only denylist. Existing deceased records predate a dedicated
  // status field, so accept both explicit flags/status and the current
  // role/tag/homeId convention (e.g. "deceased snow-watcher" and
  // "hatayap_clan_deceased"). Deliberately do NOT scan bio/lore text: a
  // living widow/widower can mention a deceased spouse without being dead.
  function isNpcMarkedDeceased(npc) {
    if (!npc || typeof npc !== 'object') return false;
    if (npc.isDeceased === true || npc.spawnEnabled === false || npc.spawn === false) return true;
    const status = String(npc.lifecycleStatus ?? npc.lifeStatus ?? npc.status ?? '').trim().toLowerCase(); // Used for newer/explicit lifecycle fields if the schema gains them.
    if (status === 'deceased' || status === 'dead') return true;
    const authoredSignals = [npc.role, npc.homeId, ...(Array.isArray(npc.tags) ? npc.tags : [])]; // Used to recognize the database's existing deceased naming convention without reading prose fields.
    return authoredSignals.some(value => /(^|[^a-z])(deceased|dead)([^a-z]|$)/i.test(String(value || '')));
  }

  // Editors must continue to see deceased people for family history, dialogue,
  // lore, and authoring. Only the live game gets the spawnable projection of
  // the database. Filtering at this shared runtime database boundary is more
  // durable than the old workaround of merely deleting fallback schedule
  // positions: no global event/schedule fallback can instantiate a record the
  // runtime never receives in its active NPC list.
  function filterRuntimeNpcDatabase(npcDatabase) {
    const isToolPage = typeof location !== 'undefined' && /\/tools\//.test(location.pathname); // Used to keep editor/database views complete while filtering only the live game.
    if (isToolPage || !npcDatabase || !Array.isArray(npcDatabase.npcs)) {
      _runtimeSuppressedNpcIds = [];
      return npcDatabase;
    }
    const suppressed = npcDatabase.npcs.filter(isNpcMarkedDeceased); // Used for both the filtered list and an inspectable/debuggable suppression summary.
    _runtimeSuppressedNpcIds = suppressed.map(npc => npc.id || npc.name || '<unnamed>');
    if (!_runtimeSuppressedNpcIds.length) return npcDatabase;

    const message = `[NPC lifecycle] Suppressed ${_runtimeSuppressedNpcIds.length} deceased NPC(s): ${_runtimeSuppressedNpcIds.join(', ')}`; // Used by the in-game debug logger when globally exposed, with console as a fallback.
    if (typeof window.debugLog === 'function') window.debugLog(message, 'schedule');
    else console.info(message);
    return { ...npcDatabase, npcs: npcDatabase.npcs.filter(npc => !isNpcMarkedDeceased(npc)) };
  }

  function getRuntimeSuppressedNpcIds() {
    return [..._runtimeSuppressedNpcIds];
  }

  // What game.js/combat-config-loader.js actually call at boot in place of a
  // bare fetch(repoPath): local override wins only when the player has opted
  // into 'local' source mode AND actually saved one for this id; otherwise
  // (repo mode, or local mode with nothing saved yet) falls through to a
  // normal fetch of the real file, so a fresh browser profile with no
  // overrides behaves identically to before this system existed.
  async function loadDatabase(id) {
    const data = await _loadRawDatabase(id); // Used as the selected raw local/repo database before optional composition.
    if (id !== 'npcDatabase') return data;
    let composed = data; // Used as the NPC database after optional Shop-or-Chat composition and before live-runtime lifecycle filtering.
    try {
      const shopStock = await _loadRawDatabase('shopStock'); // Used to compose shopkeeper access trees into the loaded NPC database.
      composed = applyShopDialogueAccess(data, shopStock);
    } catch (error) {
      console.warn('[LocalDBOverrides] Could not compose Shop or Chat dialogue trees:', error);
    }
    return filterRuntimeNpcDatabase(composed);
  }

  window.LocalDBOverrides = {
    DATABASES,
    getSourceMode, setSourceMode,
    hasOverride, getOverride, setOverride, clearOverride,
    listStatuses, loadDatabase,
    applyShopDialogueAccess,
    isNpcMarkedDeceased, filterRuntimeNpcDatabase, getRuntimeSuppressedNpcIds,
  };
})();
