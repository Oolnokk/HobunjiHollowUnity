(() => {
  'use strict';

  const CONFIG_URL = 'config/porakaneki-camp.json'; // Used to keep kill/reputation tuning beside the existing Porakaneki settings.
  const PORAKANEKI_CHIEF_ID = 'porakaneki_chief'; // Used for Porakaneki-side kill penalties.
  const LEGACY_OMGURKU_CHIEF_ID = 'baruhi_chief'; // Used only to migrate old saves after the faction rename.
  const OMGURKU_CHIEF_ID = 'omgurku_chief'; // Used for the rival-faction reward on every Porakaneki kill.
  const FAVOR_MIN = -5; // Used to preserve the authored relationship lower bound.
  const FAVOR_MAX = 10; // Used to preserve the authored relationship upper bound.
  const priorEntityState = new Map(); // Used to identify which side started combat before a later death.
  const campAggressionOrigin = new Map(); // Used to keep one fight's initiator classification across the camp retaliation window.
  const countedDeaths = new WeakSet(); // Used to prevent duplicate reputation changes for one dead hunter.
  const recentEvents = []; // Used by the mobile-friendly copyable debug snapshot.

  let tuning = {
    selfDefenseKillPenalty: -1,
    murderKillPenalty: -3,
    rivalNpcId: OMGURKU_CHIEF_ID,
    rivalKillFavor: 1,
  }; // Replaced from porakaneki-camp.json when available.
  let banditRulesInstalled = false; // Used by the dependency retry loop below.
  let combatGuardInstalled = false; // Used by the dependency retry loop below.
  let dialogueMigrationInstalled = false; // Used by the dependency retry loop below.

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const record = message => {
    recentEvents.push(String(message));
    if (recentEvents.length > 20) recentEvents.shift();
    window.__farmLog?.(`[porakaneki-faction] ${message}`, 'wildlife');
  };

  function caseAwareReplace(match, lower, title, upper) {
    if (match === match.toUpperCase()) return upper;
    if (match[0] === match[0].toUpperCase()) return title;
    return lower;
  }

  function canonicalizeString(value) {
    return String(value)
      .replace(/bushdog people/gi, match => caseAwareReplace(match, 'sheep people', 'Sheep people', 'SHEEP PEOPLE'))
      .replace(/baruhi/gi, match => caseAwareReplace(match, 'omgurku', 'Omgurku', 'OMGURKU'));
  }

  function canonicalizeNpcDatabaseInPlace(value, seen = new WeakSet()) {
    if (typeof value === 'string') return canonicalizeString(value);
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) value[i] = canonicalizeNpcDatabaseInPlace(value[i], seen);
      return value;
    }
    for (const key of Object.keys(value)) {
      const nextKey = canonicalizeString(key);
      const nextValue = canonicalizeNpcDatabaseInPlace(value[key], seen);
      if (nextKey !== key) delete value[key];
      value[nextKey] = nextValue;
    }
    return value;
  }

  function isNpcDatabaseRequest(input) {
    const raw = typeof input === 'string' ? input : input?.url;
    if (!raw) return false;
    try { return new URL(raw, document.baseURI).pathname.endsWith('/config/npcs/hobunji-starter-npc-database.json'); }
    catch { return String(raw).replace(/\\/g, '/').endsWith('config/npcs/hobunji-starter-npc-database.json'); }
  }

  function installNpcDatabaseCanon() {
    const localDb = window.LocalDBOverrides;
    if (localDb && !localDb.__omgurkuCanonWrapped) {
      const getOverride = localDb.getOverride?.bind(localDb); // Used to canonicalize locally-authored NPC database overrides too.
      const loadDatabase = localDb.loadDatabase?.bind(localDb); // Used to canonicalize normal repo/local database loads.
      if (getOverride) localDb.getOverride = (id, ...args) => id === 'npcDatabase' ? canonicalizeNpcDatabaseInPlace(getOverride(id, ...args)) : getOverride(id, ...args);
      if (loadDatabase) localDb.loadDatabase = async (id, ...args) => {
        const data = await loadDatabase(id, ...args);
        return id === 'npcDatabase' ? canonicalizeNpcDatabaseInPlace(data) : data;
      };
      localDb.__omgurkuCanonWrapped = true;
    }

    const priorFetch = window.fetch; // Used to canonicalize direct NPC-database fetches that bypass LocalDBOverrides.loadDatabase.
    if (typeof priorFetch !== 'function' || priorFetch.__omgurkuNpcCanonWrapped) return;
    const wrappedFetch = async function omgurkuCanonicalFetch(input, init) {
      const response = await priorFetch.call(this, input, init);
      if (!isNpcDatabaseRequest(input) || !response?.ok || typeof Response === 'undefined') return response;
      try {
        const data = canonicalizeNpcDatabaseInPlace(await response.clone().json());
        const headers = typeof Headers !== 'undefined' ? new Headers(response.headers) : undefined;
        headers?.delete?.('content-length');
        headers?.set?.('content-type', 'application/json');
        return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers });
      } catch (error) {
        console.warn('[PorakanekiFactionRules] NPC canon failed:', error);
        return response;
      }
    };
    wrappedFetch.__omgurkuNpcCanonWrapped = true;
    wrappedFetch.__omgurkuNpcCanonOriginal = priorFetch;
    window.fetch = wrappedFetch;
  }

  function mergeLegacyRelationshipState(dialogue = window.DialogueContent) {
    const states = dialogue?.npcDlgState;
    const legacy = states?.get?.(LEGACY_OMGURKU_CHIEF_ID);
    if (!legacy) return false;
    const current = states.get(OMGURKU_CHIEF_ID);
    if (!current) states.set(OMGURKU_CHIEF_ID, legacy);
    else {
      if ((Number(current.favor) || 0) === 0 && Number.isFinite(Number(legacy.favor))) current.favor = Number(legacy.favor);
      current.memory = [...(legacy.memory || []), ...(current.memory || [])];
      current.heardTrees = [...new Set([...(legacy.heardTrees || []), ...(current.heardTrees || [])])];
      current.heardPoolEntries = [...new Set([...(legacy.heardPoolEntries || []), ...(current.heardPoolEntries || [])])];
      current.visitedSeqSlots = { ...(legacy.visitedSeqSlots || {}), ...(current.visitedSeqSlots || {}) };
      current.localNickname ||= legacy.localNickname || null;
    }
    states.delete?.(LEGACY_OMGURKU_CHIEF_ID);
    record('migrated legacy baruhi_chief relationship state to omgurku_chief');
    return true;
  }

  function installDialogueMigration(dialogue = window.DialogueContent) {
    if (!dialogue) return false;
    if (dialogue.__omgurkuRelationshipMigrationWrapped) { dialogueMigrationInstalled = true; return true; }
    const loadNpcRelationships = dialogue.loadNpcRelationships?.bind(dialogue); // Used to migrate the old id after every save relationship load.
    if (loadNpcRelationships) dialogue.loadNpcRelationships = function omgurkuRelationshipLoad(...args) {
      const result = loadNpcRelationships(...args);
      mergeLegacyRelationshipState(dialogue);
      return result;
    };
    mergeLegacyRelationshipState(dialogue);
    dialogue.__omgurkuRelationshipMigrationWrapped = true;
    dialogueMigrationInstalled = true;
    return true;
  }

  function factionState(npcId) {
    return window.DialogueContent?.getNpcDlgState?.(npcId) || window.DialogueContent?.npcDlgState?.get?.(npcId) || null;
  }
  function favorOf(npcId) { return Number(factionState(npcId)?.favor) || 0; }

  function adjustFactionFavorExact(npcId, amount, reason, label) {
    const state = factionState(npcId);
    if (!state || !Number.isFinite(Number(amount)) || Number(amount) === 0) return 0;
    const current = Number(state.favor) || 0;
    const next = clamp(current + Number(amount), FAVOR_MIN, FAVOR_MAX);
    const applied = Math.round((next - current) * 10) / 10;
    if (!applied) return 0;
    state.favor = next;
    window.DialogueContent?.recordNpcMemory?.(npcId, reason);
    window.WorldPopupText?.queueReward?.('favor', `${applied > 0 ? '+' : '-'}${Math.abs(applied)} ${label} Favor`);
    return applied;
  }

  function porakanekiEntities() {
    const hostiles = window.Combat?.deps?.hostileObjects;
    return hostiles ? [...hostiles].filter(entity => entity?.isPorakanekiHunter === true) : [];
  }

  function syncCompanionTargetability(entity) {
    if (!entity?.def) return;
    if (!entity._porakanekiFactionDefOverlay) {
      const baseDef = entity.def; // Used as a prototype so one hunter's neutral/hostile flag cannot leak into a shared definition.
      entity.def = Object.create(baseDef);
      entity._porakanekiFactionDefOverlay = true;
    }
    entity.def.hostile = entity._porakanekiPlannerControlled !== true;
  }

  function installCompanionMeleeGuard(combat = window.Combat) {
    if (!combat || typeof combat.meleeHit !== 'function') return false;
    if (combat.meleeHit.__porakanekiNeutralGuard) { combatGuardInstalled = true; return true; }
    const meleeHit = combat.meleeHit; // Used to preserve the shared collider after the neutral-companion guard.
    const guarded = function porakanekiNeutralMeleeGuard(attacker, target, ...args) {
      if (attacker?.isCompanion && target?.isPorakanekiHunter && target?._porakanekiPlannerControlled === true) return false;
      return meleeHit.call(this, attacker, target, ...args);
    };
    guarded.__porakanekiNeutralGuard = true;
    guarded.__porakanekiNeutralGuardOriginal = meleeHit;
    combat.meleeHit = guarded;
    combatGuardInstalled = true;
    return true;
  }

  const campIdFor = entity => String(entity?.porakanekiCampId || entity?.id || 'unknown');

  function classifyCampOrigins(entities, attackOnSight) {
    const liveByCamp = new Map(); // Used to clear stale origin state after the whole camp returns to neutral.

    // Damage to a still-neutral hunter is authoritative evidence that the
    // player side started this fight. Do this pass first, including hunters
    // killed in one hit, so the victim cannot be skipped while a surviving
    // campmate's neutral->hostile retaliation gets mistaken for first blood.
    for (const entity of entities) {
      const previous = priorEntityState.get(entity);
      if (!previous || !(Number(entity.health) < previous.health) || previous.plannerControlled !== true) continue;
      const campId = campIdFor(entity);
      if (!campAggressionOrigin.has(campId)) {
        campAggressionOrigin.set(campId, 'player');
        record(`${campId}: player initiated combat`);
      }
    }

    for (const entity of entities) {
      if (!(entity?.health > 0)) continue;
      const campId = campIdFor(entity);
      if (!liveByCamp.has(campId)) liveByCamp.set(campId, []);
      liveByCamp.get(campId).push(entity);
      const previous = priorEntityState.get(entity);
      if (previous && previous.plannerControlled === true && entity._porakanekiPlannerControlled !== true && !campAggressionOrigin.has(campId)) {
        campAggressionOrigin.set(campId, 'porakaneki');
        record(`${campId}: Porakaneki initiated combat`);
      } else if (!previous && entity._porakanekiPlannerControlled !== true && attackOnSight && !campAggressionOrigin.has(campId)) {
        campAggressionOrigin.set(campId, 'porakaneki');
        record(`${campId}: Porakaneki attack-on-sight combat`);
      }
    }
    for (const [campId, members] of liveByCamp) if (members.every(entity => entity._porakanekiPlannerControlled === true)) campAggressionOrigin.delete(campId);
  }

  function processDeaths(entities, favorBefore) {
    const deaths = [];
    for (const entity of entities) {
      const previous = priorEntityState.get(entity);
      if (!previous || previous.health <= 0 || Number(entity.health) > 0 || countedDeaths.has(entity)) continue;
      countedDeaths.add(entity);
      const campId = campIdFor(entity);
      const origin = campAggressionOrigin.get(campId) || (previous.plannerControlled === true ? 'player' : 'porakaneki');
      deaths.push({ campId, selfDefense: origin === 'porakaneki' });
    }
    if (!deaths.length) return;

    const desiredPorakanekiDelta = deaths.reduce((sum, death) => sum + (death.selfDefense ? tuning.selfDefenseKillPenalty : tuning.murderKillPenalty), 0);
    const nativePorakanekiDelta = favorOf(PORAKANEKI_CHIEF_ID) - favorBefore;
    const correction = desiredPorakanekiDelta - nativePorakanekiDelta;
    if (correction) adjustFactionFavorExact(PORAKANEKI_CHIEF_ID, correction, 'porakaneki_kill_classification_correction', 'Porakaneki');

    for (const death of deaths) {
      adjustFactionFavorExact(tuning.rivalNpcId, tuning.rivalKillFavor, `porakaneki_kill_${death.selfDefense ? 'self_defense' : 'murder'}`, 'Omgurku');
      record(`${death.campId}: kill=${death.selfDefense ? 'self-defense' : 'murder'} Porakaneki=${death.selfDefense ? tuning.selfDefenseKillPenalty : tuning.murderKillPenalty} Omgurku=+${tuning.rivalKillFavor}`);
    }
  }

  function refreshEntityState(entities) {
    const present = new Set(entities); // Used to prune hunters that the Porakaneki LOD runtime tore down.
    for (const entity of entities) {
      syncCompanionTargetability(entity);
      priorEntityState.set(entity, { health: Number(entity.health) || 0, plannerControlled: entity._porakanekiPlannerControlled === true });
    }
    for (const entity of [...priorEntityState.keys()]) if (!present.has(entity)) priorEntityState.delete(entity);
  }

  function installBanditRules(api = window.BanditCamps) {
    if (!api || typeof api.updateCampBanners !== 'function') return false;
    if (api.updateCampBanners.__porakanekiFactionRulesWrapped) { banditRulesInstalled = true; return true; }
    const updateCampBanners = api.updateCampBanners.bind(api); // Used as the existing Porakaneki/Bandit tick inside the reputation classifier wrapper.
    const wrapped = function porakanekiFactionRulesTick(dt, ...args) {
      const favorBefore = favorOf(PORAKANEKI_CHIEF_ID);
      const result = updateCampBanners(dt, ...args);
      const entities = porakanekiEntities();
      const attackOnSight = !!window.PorakanekiCamps?.debugSnapshot?.().attackOnSight;
      classifyCampOrigins(entities, attackOnSight);
      processDeaths(entities, favorBefore);
      refreshEntityState(entities);
      return result;
    };
    wrapped.__porakanekiFactionRulesWrapped = true;
    wrapped.__porakanekiFactionRulesOriginal = updateCampBanners;
    api.updateCampBanners = wrapped;
    banditRulesInstalled = true;
    return true;
  }

  async function loadTuning() {
    try {
      const response = await fetch(CONFIG_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reputation = (await response.json())?.reputation || {};
      tuning = {
        selfDefenseKillPenalty: Number.isFinite(Number(reputation.selfDefenseKillPenalty))
          ? Number(reputation.selfDefenseKillPenalty)
          : (Number.isFinite(Number(reputation.killPenalty)) && Number(reputation.killPenalty) !== 0 ? Number(reputation.killPenalty) : tuning.selfDefenseKillPenalty),
        murderKillPenalty: Number.isFinite(Number(reputation.murderKillPenalty)) ? Number(reputation.murderKillPenalty) : tuning.murderKillPenalty,
        rivalNpcId: String(reputation.rivalNpcId || tuning.rivalNpcId),
        rivalKillFavor: Number.isFinite(Number(reputation.rivalKillFavor)) ? Number(reputation.rivalKillFavor) : tuning.rivalKillFavor,
      };
    } catch (error) { console.warn('[PorakanekiFactionRules] reputation config failed; using defaults:', error); }
  }

  function installAvailableHooks() {
    installNpcDatabaseCanon();
    installDialogueMigration();
    installCompanionMeleeGuard();
    installBanditRules();
    return banditRulesInstalled && combatGuardInstalled && dialogueMigrationInstalled;
  }

  const installer = setInterval(() => { if (installAvailableHooks()) clearInterval(installer); }, 50); // Retries parser-time dependencies without replacing their namespace setters.
  installAvailableHooks();
  loadTuning();

  window.PorakanekiFactionRules = Object.freeze({
    version: 1,
    canonicalizeNpcDatabaseInPlace,
    migrateLegacyRelationshipState: mergeLegacyRelationshipState,
    syncNow: () => refreshEntityState(porakanekiEntities()),
    debugSnapshot: () => ({
      tuning: { ...tuning },
      hooks: { banditRulesInstalled, combatGuardInstalled, dialogueMigrationInstalled },
      materializedHunters: porakanekiEntities().length,
      neutralHunters: porakanekiEntities().filter(entity => entity._porakanekiPlannerControlled === true).length,
      campAggressionOrigin: Object.fromEntries(campAggressionOrigin),
      recentEvents: [...recentEvents],
    }),
    formatDebug: () => {
      const d = window.PorakanekiFactionRules.debugSnapshot();
      return `Porakaneki faction rules: hooks=${JSON.stringify(d.hooks)} hunters=${d.materializedHunters} neutral=${d.neutralHunters} origins=${JSON.stringify(d.campAggressionOrigin)} tuning=${JSON.stringify(d.tuning)} recent=${d.recentEvents.join(' | ')}`;
    },
    __test: Object.freeze({ canonicalizeString }),
  });
})();
