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
  const NPC_SCHEDULE_OVERRIDES_PATH = 'config/npcs/schedule-overrides.json'; // Runtime-authored schedule corrections kept out of game.js and the giant NPC database.
  const NPC_SCHEDULE_WEEKDAYS = ['Anan', 'Hronu', 'Kruru', 'Muunu', 'Naru', 'Tothu', 'Uung']; // Used to expand presence-dependent schedule choices deterministically at load time.

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

  function _scheduleTimeMinutes(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const hours = Number(match[1]); // Used to convert an authored HH:MM schedule time to minutes after midnight.
    const minutes = Number(match[2]); // Used with hours to compare schedule windows numerically.
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function _scheduleTimeString(minutes) {
    const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440; // Used to serialize generated schedule boundaries back to HH:MM.
    return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
  }

  function _ruleRunsOnDay(rule, day) {
    if (rule?.day) return rule.day === day;
    if (Array.isArray(rule?.days)) return rule.days.includes(day);
    return true;
  }

  function _ruleActiveAt(rule, day, minute) {
    if (!rule || rule.contentIncomplete || !_ruleRunsOnDay(rule, day)) return false;
    const start = _scheduleTimeMinutes(rule.start ?? rule.from); // Used as the inclusive start of this authored schedule window.
    const end = _scheduleTimeMinutes(rule.end ?? rule.to); // Used as the exclusive end of this authored schedule window.
    if (start == null || end == null || start === end) return false;
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
  }

  function _ruleTargetMap(rule, hooks) {
    return rule?.mapId || rule?.area || hooks?.defaultMapId || '';
  }

  function _activeScheduleRule(npc, day, minute) {
    const rules = npc?.scheduleHooks?.rules || []; // Used in authored priority order, matching game.js's first-active-rule behavior.
    return rules.find(rule => _ruleActiveAt(rule, day, minute)) || null;
  }

  function _matchingStationRule(rule, stationId) {
    return !!rule && (rule.stationId === stationId || rule.sourceStationId === stationId);
  }

  function _applyStationRedirect(merged, redirect) {
    const npc = merged.npcs.find(entry => entry.id === redirect.npcId); // Used to scope the station redirect to one NPC instead of globally rewriting shared station ids.
    const hooks = npc?.scheduleHooks;
    if (!hooks || !redirect.fromStationId || !redirect.toStationId) return;
    for (const rule of hooks.rules || []) {
      if (!_matchingStationRule(rule, redirect.fromStationId)) continue;
      if (!rule.sourceStationId) rule.sourceStationId = redirect.fromStationId;
      rule.stationId = redirect.toStationId;
      if (redirect.mapId) rule.mapId = redirect.mapId;
      delete rule.c;
      delete rule.r;
      delete rule.position;
    }
    if (hooks.defaultStationId === redirect.fromStationId || hooks.defaultStationId === redirect.toStationId) {
      hooks.defaultStationId = redirect.toStationId;
    }
  }

  function _applyPositionRedirect(merged, redirect) {
    const npc = merged.npcs.find(entry => entry.id === redirect.npcId); // Used to move one NPC's station-backed activity without rewriting the large town map file.
    const hooks = npc?.scheduleHooks;
    if (!hooks || !redirect.fromStationId || !Number.isFinite(redirect.c) || !Number.isFinite(redirect.r)) return;
    for (const rule of hooks.rules || []) {
      if (!_matchingStationRule(rule, redirect.fromStationId)) continue;
      if (!rule.sourceStationId) rule.sourceStationId = redirect.fromStationId;
      delete rule.stationId;
      rule.c = redirect.c;
      rule.r = redirect.r;
      if (redirect.mapId) rule.mapId = redirect.mapId;
    }
  }

  function _presenceBoundaries(choice, npcById, day) {
    const start = _scheduleTimeMinutes(choice.from); // Used as the beginning of the conditional social window.
    const end = _scheduleTimeMinutes(choice.to); // Used as the end of the conditional social window.
    if (start == null || end == null || start >= end) return [];
    const boundaries = new Set([start, end]); // Used to split only where a watched NPC could change schedule target.
    for (const npcId of choice.whenAnyNpcIds || []) {
      const watched = npcById.get(npcId);
      for (const rule of watched?.scheduleHooks?.rules || []) {
        if (!_ruleRunsOnDay(rule, day) || rule.contentIncomplete) continue;
        const ruleStart = _scheduleTimeMinutes(rule.start ?? rule.from);
        const ruleEnd = _scheduleTimeMinutes(rule.end ?? rule.to);
        if (ruleStart != null && ruleStart > start && ruleStart < end) boundaries.add(ruleStart);
        if (ruleEnd != null && ruleEnd > start && ruleEnd < end) boundaries.add(ruleEnd);
      }
    }
    return [...boundaries].sort((a, b) => a - b);
  }

  function _makePresenceRule(choice, day, from, to, visiting) {
    const target = visiting ? choice.whenPresent : choice.fallback; // Used to choose the family visit seat or the ordinary avoidance seat for this segment.
    return {
      day,
      from: _scheduleTimeString(from),
      to: _scheduleTimeString(to),
      mapId: target.mapId,
      stationId: target.stationId,
      activity: target.activity || '',
      sourceStationId: choice.replaceStationId,
      generatedScheduleOverride: choice.id,
    };
  }

  function _applyPresenceChoice(merged, choice) {
    const npcById = new Map(merged.npcs.map(npc => [npc.id, npc])); // Used both for the target NPC and the family members whose schedules decide the destination.
    const npc = npcById.get(choice.npcId);
    const hooks = npc?.scheduleHooks;
    if (!hooks || !choice.id || !choice.replaceStationId || !choice.whenPresent || !choice.fallback) return;
    const rules = hooks.rules || [];
    let insertionIndex = rules.findIndex(rule => _matchingStationRule(rule, choice.replaceStationId) || rule.generatedScheduleOverride === choice.id); // Used to preserve the original rule priority relative to day-off rules.
    if (insertionIndex < 0) return;
    hooks.rules = rules.filter(rule => !_matchingStationRule(rule, choice.replaceStationId) && rule.generatedScheduleOverride !== choice.id);
    insertionIndex = Math.min(insertionIndex, hooks.rules.length);

    const generated = [];
    for (const day of NPC_SCHEDULE_WEEKDAYS) {
      const boundaries = _presenceBoundaries(choice, npcById, day);
      for (let i = 0; i + 1 < boundaries.length; i++) {
        const from = boundaries[i];
        const to = boundaries[i + 1];
        if (to <= from) continue;
        const probeMinute = from + (to - from) / 2; // Used to inspect the stable schedule state within this boundary-delimited segment.
        const visiting = (choice.whenAnyNpcIds || []).some(npcId => {
          const watched = npcById.get(npcId);
          const active = _activeScheduleRule(watched, day, probeMinute);
          return !!active && _ruleTargetMap(active, watched?.scheduleHooks) === choice.whenPresent.mapId;
        });
        const next = _makePresenceRule(choice, day, from, to, visiting);
        const prev = generated[generated.length - 1];
        if (prev && prev.day === next.day && prev.to === next.from && prev.mapId === next.mapId
          && prev.stationId === next.stationId && prev.activity === next.activity) {
          prev.to = next.to;
        } else {
          generated.push(next);
        }
      }
    }
    hooks.rules.splice(insertionIndex, 0, ...generated);
  }

  // Applies small, reviewable schedule corrections after loading either the
  // repo NPC database or a local editor override. This keeps map movement and
  // relationship-aware routine policy out of game.js while avoiding direct
  // hand-edits to the very large NPC database for every town-layout tweak.
  function applyNpcScheduleOverrides(npcDatabase, scheduleOverrides) {
    if (!npcDatabase || !Array.isArray(npcDatabase.npcs) || !scheduleOverrides) return npcDatabase;
    const merged = JSON.parse(JSON.stringify(npcDatabase)); // Used as a non-mutating NPC database copy for composed runtime schedules.
    for (const redirect of scheduleOverrides.stationRedirects || []) _applyStationRedirect(merged, redirect);
    for (const redirect of scheduleOverrides.positionRedirects || []) _applyPositionRedirect(merged, redirect);
    for (const choice of scheduleOverrides.presenceChoices || []) _applyPresenceChoice(merged, choice);
    return merged;
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
    let composed = data; // Used to carry independent schedule and shop composition forward even if either optional source fails.
    try {
      const resp = await fetch(NPC_SCHEDULE_OVERRIDES_PATH); // Used to load small repo-authored schedule corrections independently of local database selection.
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      composed = applyNpcScheduleOverrides(composed, await resp.json());
    } catch (error) {
      console.warn('[LocalDBOverrides] Could not compose NPC schedule overrides:', error);
    }
    try {
      const shopStock = await _loadRawDatabase('shopStock'); // Used to compose shopkeeper access trees into the loaded NPC database.
      composed = applyShopDialogueAccess(composed, shopStock);
    } catch (error) {
      console.warn('[LocalDBOverrides] Could not compose Shop or Chat dialogue trees:', error);
    }
    return composed;
  }

  window.LocalDBOverrides = {
    DATABASES,
    getSourceMode, setSourceMode,
    hasOverride, getOverride, setOverride, clearOverride,
    listStatuses, loadDatabase,
    applyShopDialogueAccess,
    applyNpcScheduleOverrides,
  };
})();
