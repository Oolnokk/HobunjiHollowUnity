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
  const LEGACY_NONSPAWN_NPC_IDS = new Set([
    'talisman_hatayap',
    'bowstring_hatayap',
    'hammerhead_tuhupnuk',
  ]); // Used to keep historically deceased/banished records out of the live scheduler even when an old local override lacks lifecycle metadata.

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
    if (LEGACY_NONSPAWN_NPC_IDS.has(String(npc.id || ''))) return true;
    if (npc.isDeceased === true || npc.spawnEnabled === false || npc.spawn === false) return true;
    const status = String(npc.lifecycleStatus ?? npc.lifeStatus ?? npc.status ?? '').trim().toLowerCase(); // Used for newer/explicit lifecycle fields if the schema gains them.
    if (status === 'deceased' || status === 'dead' || status === 'banished') return true;
    const authoredSignals = [npc.role, npc.homeId, ...(Array.isArray(npc.tags) ? npc.tags : [])]; // Used to recognize the database's existing deceased/banished naming convention without reading prose fields.
    return authoredSignals.some(value => /(^|[^a-z])(deceased|dead|banished)([^a-z]|$)/i.test(String(value || '')));
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

    const message = `[schedule] [NPC lifecycle] Suppressed ${_runtimeSuppressedNpcIds.length} nonspawn NPC(s): ${_runtimeSuppressedNpcIds.join(', ')}`; // Used by the in-game schedule filter and console fallback.
    if (typeof window.__farmLog === 'function') window.__farmLog(message, 'info');
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

  // Live-game compatibility hooks belong on this guaranteed-loaded script path
  // rather than config/config.js. index.html loads this module synchronously
  // before AudioSystem/Music, so their first assignment can be wrapped without
  // timers or script-order races. Tool pages are intentionally untouched.
  const _runtimeToolPage = typeof location !== 'undefined' && /\/tools\//.test(location.pathname);
  if (_runtimeToolPage) return;

  function runtimeAudioLog(message, level = 'audio') {
    if (typeof window.__farmLog === 'function') window.__farmLog(message, level);
    else console.info(message);
  }

  const HARDSTEP_PLACEHOLDER_URLS = [
    'assets/audio/sfx/footsteps/sfx_footstep_hardstep1.mp3',
    'assets/audio/sfx/footsteps/sfx_footstep_hardstep2.mp3',
    'assets/audio/sfx/footsteps/sfx_footstep_hardstep3.mp3',
  ]; // Used only for paths/ramps and authored building floors; the files intentionally do not exist yet.
  let _runtimeHardStepPlayed = false; // Used to report the first hardstep placeholder request through the Audio debug filter.
  let _runtimeFootstepCadence = false; // Used to report the first cadence trigger through the Audio debug filter.

  function isHardstepPlaceholderSurface(area, tile) {
    const areaId = String(area || ''); // Used to recognize the current interior-area naming convention without needing AudioSystem's private deps.
    const tileType = String(tile?.type ?? '').toLowerCase(); // Used to recognize map-authored path/ramp values; town workspace stores these as strings.
    return areaId === 'interior' || /^map_i_/i.test(areaId)
      || tileType === 'path' || tileType === 'ramp';
  }

  function playHardstepPlaceholder(audioSystem, volumeScale = 1, heavy = false) {
    const audioCfg = audioSystem.gameAudioConfig?.() || {}; // Used to preserve the existing global SFX/footstep volume controls when the placeholder files are eventually added.
    if (audioCfg.enabled === false) return;
    const footstepCfg = audioCfg.footsteps || {}; // Used to preserve the existing footstep enabled/volume controls.
    if (footstepCfg.enabled === false) return;
    const baseVolume = Math.max(0, Math.min(1, Number(footstepCfg.volume) || 0.65)); // Used to approximate the current gravel-path mix without procedural synthesis.
    const sfxVolume = Math.max(0, Number(audioCfg.sfxVolume) || 1);
    const volume = Math.min(1, baseVolume * sfxVolume * Math.max(0, Number(volumeScale) || 0) * 0.54 * (heavy ? 2 : 1));
    if (volume <= 0.002) return;
    const url = HARDSTEP_PLACEHOLDER_URLS[Math.floor(Math.random() * HARDSTEP_PLACEHOLDER_URLS.length)]; // Used to rotate evenly enough among the three future hardstep recordings.
    const snd = new Audio(url);
    snd.volume = volume;
    snd.playbackRate = heavy ? (0.60 + Math.random() * 0.10) : (0.92 + Math.random() * 0.16);
    snd.play().catch(() => {}); // Missing placeholder files are intentionally silent; there is no synth or gravel fallback.
  }

  function wrapRuntimeAudioSystem(audioSystem) {
    if (!audioSystem || audioSystem.__hobunjiDirectHardStepWrapped) return audioSystem;
    if (typeof audioSystem.playFootstepSfx !== 'function' || typeof audioSystem.footstepSurfaceKey !== 'function') return audioSystem;
    const originalPlayFootstepSfx = audioSystem.playFootstepSfx;
    audioSystem.playFootstepSfx = function (area, tile, volumeScale = 1, pan = 0, opts = {}) {
      if (!isHardstepPlaceholderSurface(area, tile)) {
        return originalPlayFootstepSfx.call(this, area, tile, volumeScale, pan, opts);
      }
      if (!_runtimeHardStepPlayed) {
        _runtimeHardStepPlayed = true;
        runtimeAudioLog(`[footsteps] hardstep placeholder route fired area=${area} tileType=${tile?.type ?? 'none'}; no fallback.`);
      }
      return playHardstepPlaceholder(audioSystem, volumeScale, !!opts.heavy);
    };
    const originalAdvance = audioSystem.footstepAdvance;
    if (typeof originalAdvance === 'function') {
      audioSystem.footstepAdvance = function (state, distPx, stridePx) {
        const fires = originalAdvance.call(this, state, distPx, stridePx);
        if (fires && !_runtimeFootstepCadence) {
          _runtimeFootstepCadence = true;
          const resolvedStride = stridePx ?? audioSystem.FOOTSTEP_PLAYER_STRIDE_PX; // Used so diagnostics report AudioSystem's default instead of NaN when callers omit the optional stride argument.
          runtimeAudioLog(`[footsteps] cadence fired dist=${Number(distPx).toFixed(2)} stride=${Number(resolvedStride).toFixed(2)}.`);
        }
        return fires;
      };
    }
    // Keep the legacy marker too: config.js's older delayed compatibility probe
    // checks it and must not install its procedural-gravel wrapper on top of this route.
    Object.defineProperty(audioSystem, '__hobunjiDirectHardStepWrapped', { value: true, configurable: true });
    runtimeAudioLog('[footsteps] Path/floor hardstep placeholder route installed; procedural hard-step fallback disabled for those surfaces.');
    return audioSystem;
  }

  function interceptRuntimeGlobal(name, wrapper) {
    const existing = window[name]; // Used when a future script-order change defines the system before this module.
    if (existing) { wrapper(existing); return; }
    let assignedValue; // Used until the owning script performs its normal window.<System> assignment.
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get() { return assignedValue; },
        set(value) {
          assignedValue = wrapper(value) || value;
          Object.defineProperty(window, name, { configurable: true, enumerable: true, writable: true, value: assignedValue });
        },
      });
    } catch (_) {}
  }

  interceptRuntimeGlobal('AudioSystem', wrapRuntimeAudioSystem);

  const INDOOR_OUTDOOR_BGS_SCALE = 0.18;
  let _runtimeMusicDeps = null; // Used to identify building interiors in Music's own injected area helpers.
  let _runtimeIndoorBgsArea = ''; // Used to keep the BGS diagnostic one-shot per entered building.

  function withIndoorOutdoorBgsProfile(callback) {
    const musicDeps = _runtimeMusicDeps;
    const actualArea = musicDeps?.getCurrentArea?.();
    const indoors = actualArea === 'interior' || !!(musicDeps && musicDeps._isBuildingArea?.(actualArea));
    if (!indoors) { _runtimeIndoorBgsArea = ''; return callback(); }
    const audioCfg = window.AudioSystem?.gameAudioConfig?.();
    const bgs = audioCfg?.bgs;
    if (!bgs || typeof musicDeps.getCurrentArea !== 'function') return callback();

    const originalGetCurrentArea = musicDeps.getCurrentArea;
    const defaults = {
      birdsVolume: 0.25, nightbugsVolume: 0.23, wind1Volume: 0.20, wind2Volume: 0.18,
      gentlerainVolume: 0.45, midrainVolume: 0.55, heavyrainVolume: 0.65,
    };
    const saved = new Map();
    try {
      for (const [key, fallback] of Object.entries(defaults)) {
        saved.set(key, { had: Object.prototype.hasOwnProperty.call(bgs, key), value: bgs[key] });
        bgs[key] = Math.max(0, Number(bgs[key] ?? fallback) || 0) * INDOOR_OUTDOOR_BGS_SCALE;
      }
      musicDeps.getCurrentArea = () => 'farm';
      if (_runtimeIndoorBgsArea !== actualArea) {
        _runtimeIndoorBgsArea = actualArea;
        runtimeAudioLog(`[bgs] Indoor outdoor-BGS bleed active area=${actualArea} scale=${INDOOR_OUTDOOR_BGS_SCALE}`, 'bgs');
      }
      return callback();
    } finally {
      musicDeps.getCurrentArea = originalGetCurrentArea;
      for (const [key, state] of saved) {
        if (state.had) bgs[key] = state.value;
        else delete bgs[key];
      }
    }
  }

  function wrapRuntimeMusic(musicSystem) {
    if (!musicSystem || musicSystem.__hobunjiIndoorBgsWrapped) return musicSystem;
    const originalInit = musicSystem.init;
    if (typeof originalInit === 'function') {
      musicSystem.init = function (injectedDeps) {
        _runtimeMusicDeps = injectedDeps;
        return originalInit.call(this, injectedDeps);
      };
    }
    const originalExterior = musicSystem.updateExteriorBgs;
    if (typeof originalExterior === 'function') {
      musicSystem.updateExteriorBgs = function (...args) {
        return withIndoorOutdoorBgsProfile(() => originalExterior.apply(this, args));
      };
    }
    const originalRain = musicSystem.updateRainAudio;
    if (typeof originalRain === 'function') {
      musicSystem.updateRainAudio = function (...args) {
        return withIndoorOutdoorBgsProfile(() => originalRain.apply(this, args));
      };
    }
    Object.defineProperty(musicSystem, '__hobunjiIndoorBgsWrapped', { value: true, configurable: true });
    runtimeAudioLog('[bgs] Indoor outdoor-BGS hook installed from local-db-overrides.js.', 'bgs');
    return musicSystem;
  }

  interceptRuntimeGlobal('Music', wrapRuntimeMusic);
  runtimeAudioLog('[runtime patches] guaranteed-loaded lifecycle/audio hooks armed from local-db-overrides.js.');
})();
