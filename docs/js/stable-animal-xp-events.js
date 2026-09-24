(() => {
  'use strict';

  // Role-specific training XP bridge. StableAnimalProgression owns the saved
  // XP/level curve; this module only translates existing gameplay events into
  // awards and routes the resulting animal XP into the same centered reward
  // list used by skill/mastery XP.
  const XP = Object.freeze({
    enemyDefeat: 4,
    denMotherBonus: 16,
    buriedTreasure: 12,
    banditCampClear: 20,
    nestTheft: 10,
    locationDiscovery: 12,
    questComplete: 20,
    rapportPerPoint: 1,
    rapportAwardCap: 12,
    mountTravelTilesPerXp: 6,
    mountTravelMinTiles: 3,
    mountTravelHourlyCap: 20,
  });
  const ROLE_LABELS = Object.freeze({
    companion: 'Companion',
    mount: 'Mount',
    shoulderPet: 'Shoulder Pet',
  });
  const DEBUG_HISTORY_LIMIT = 24;

  let installed = false;
  let pollTimer = null;
  let wildTreasureDeps = null;
  let lastMountTravelSample = null;
  const treasureDugState = new Map();
  const campClearState = new WeakMap();
  const debug = {
    installed: false,
    hooks: {},
    lastAward: null,
    awards: [],
    mountTravel: null,
    lastError: null,
  };

  function progression() { return window.StableAnimalProgression || null; }
  function combatDeps() { return window.Combat?.deps || null; }
  function activeEntry(role) { return progression()?.activeEntryForRole?.(role) || null; }

  function liveRoleActor(role) {
    if (role === 'mount') {
      const ride = window.Mounts?.rideEntity;
      return ride?.health > 0 ? ride : null;
    }
    const deps = combatDeps();
    const player = deps?.player;
    if (!player) return null;
    const area = deps.getCurrentArea?.();
    for (const actor of deps.companionObjects || []) {
      if (!actor || actor.health <= 0 || actor.stableRole !== role) continue;
      if ((actor.master || player) !== player) continue;
      if (area && actor.areaId && actor.areaId !== area) continue;
      if (actor.avatarRef?.group?.visible === false) continue;
      return actor;
    }
    return null;
  }

  function activePresentEntry(role) {
    const entry = activeEntry(role);
    return entry && liveRoleActor(role) ? entry : null;
  }

  function animalName(entry) {
    return entry?.name || window.CREATURE_DB?.[entry?.kind]?.label || entry?.kind || 'Animal';
  }

  function queueAnimalXpPopup(role, entry, amount) {
    if (!(amount > 0)) return;
    const text = `+${amount} ${animalName(entry)} ${ROLE_LABELS[role] || 'Animal'} XP`;
    if (window.WorldPopupText?.queueReward) window.WorldPopupText.queueReward('skillXp', text);
    else window.WorldPopupText?.showChange?.('skillXp', amount, { text });
  }

  function rememberAward(record) {
    debug.lastAward = record;
    debug.awards.push(record);
    if (debug.awards.length > DEBUG_HISTORY_LIMIT) debug.awards.splice(0, debug.awards.length - DEBUG_HISTORY_LIMIT);
    window.__farmLog?.(`[stable-xp] ${record.role} ${record.name} +${record.amount} (${record.source})`, 'farm');
  }

  function awardRole(role, rawAmount, source) {
    const entry = activePresentEntry(role);
    const api = progression();
    const amount = Math.max(0, Math.round(Number(rawAmount) || 0));
    if (!entry || !api?.awardXp || !amount) return { ok: false, amount: 0, reason: entry ? 'progression-unavailable' : 'role-not-present' };
    const result = api.awardXp(entry, amount, source) || { ok: false, amount: 0 };
    const applied = Math.max(0, Number(result.amount) || 0);
    if (applied > 0) {
      queueAnimalXpPopup(role, entry, applied);
      rememberAward({
        at: Date.now(), role, id: entry.id || null, name: animalName(entry),
        amount: applied, source: String(source || 'event'), levels: Number(result.levels) || 0,
      });
    }
    return result;
  }

  function hostileCollectionContains(target) {
    const hostiles = combatDeps()?.hostileObjects;
    if (!hostiles || !target) return false;
    if (typeof hostiles.has === 'function') return hostiles.has(target);
    if (Array.isArray(hostiles)) return hostiles.includes(target);
    try { return [...hostiles].includes(target); } catch (_) { return false; }
  }

  function denMotherTarget(target) {
    const fields = [target?.kind, target?.id, target?.name, target?.def?.id, target?.def?.key, target?.def?.label]
      .filter(Boolean).map(value => String(value).toLowerCase().replace(/[ _]/g, '-'));
    return !!target?.isDenMother || fields.some(value => value.includes('den-mother') || value.includes('denmother'));
  }

  function enemyTarget(target) {
    if (!target || target.isCompanion || target.master === combatDeps()?.player) return false;
    return hostileCollectionContains(target)
      || target.isBandit === true
      || target.hostile === true
      || target.isHostile === true
      || denMotherTarget(target);
  }

  function handleEnemyDefeat(target) {
    if (!enemyTarget(target)) return false;
    const denMother = denMotherTarget(target);
    awardRole('companion', XP.enemyDefeat + (denMother ? XP.denMotherBonus : 0), denMother ? 'defeated den-mother' : 'defeated enemy');
    awardRole('shoulderPet', XP.enemyDefeat, 'defeated enemy');
    queueMicrotaskSafe(scanBanditCamps);
    return true;
  }

  function patchCreatureDeath(api) {
    if (!api || api.__stableAnimalXpEventsWrapped || typeof api.begin !== 'function') return api;
    const original = api.begin;
    api.begin = function stableAnimalXpDeath(target, ...args) {
      handleEnemyDefeat(target);
      return original.call(this, target, ...args);
    };
    api.__stableAnimalXpEventsWrapped = true;
    debug.hooks.creatureDeath = true;
    return api;
  }

  function rapportXpForGain(gained) {
    const points = Math.max(0, Number(gained) || 0);
    return Math.min(XP.rapportAwardCap, Math.max(0, Math.round(points * XP.rapportPerPoint)));
  }

  function patchNpcRapport(api) {
    if (!api || api.__stableAnimalXpEventsWrapped || typeof api.adjust !== 'function') return api;
    const originalAdjust = api.adjust.bind(api);
    const wrapper = Object.create(Object.getPrototypeOf(api) || Object.prototype);
    const descriptors = Object.getOwnPropertyDescriptors(api);
    delete descriptors.adjust;
    Object.defineProperties(wrapper, descriptors);
    Object.defineProperty(wrapper, 'adjust', {
      configurable: true,
      enumerable: true,
      writable: false,
      value(npcId, amount, source, ...rest) {
        const gained = originalAdjust(npcId, amount, source, ...rest);
        const xp = rapportXpForGain(gained);
        if (xp > 0) awardRole('shoulderPet', xp, `rapport:${source || 'social'}`);
        return gained;
      },
    });
    Object.defineProperty(wrapper, '__stableAnimalXpEventsWrapped', { value: true, enumerable: false });
    debug.hooks.rapport = true;
    return wrapper;
  }

  function instrumentQuestDeps(injectedDeps) {
    const current = injectedDeps?.setQuestStatus;
    if (typeof current !== 'function' || current.__stableAnimalXpEventsWrapped) return injectedDeps;
    const wrapped = function stableAnimalXpQuestStatus(taskId, status, progressPatch, ...rest) {
      const before = injectedDeps.getQuestProgress?.()?.[taskId]?.status;
      const result = current.call(this, taskId, status, progressPatch, ...rest);
      if (status === 'completed' && before !== 'completed') awardRole('mount', XP.questComplete, `quest:${taskId}`);
      return result;
    };
    Object.defineProperty(wrapped, '__stableAnimalXpEventsWrapped', { value: true });
    injectedDeps.setQuestStatus = wrapped;
    debug.hooks.questStatus = true;
    return injectedDeps;
  }

  function patchQuestModule(api) {
    if (!api || api.__stableAnimalXpQuestInitWrapped || typeof api.init !== 'function') return api;
    const originalInit = api.init;
    api.init = function stableAnimalXpQuestInit(injectedDeps, ...rest) {
      instrumentQuestDeps(injectedDeps);
      return originalInit.call(this, injectedDeps, ...rest);
    };
    api.__stableAnimalXpQuestInitWrapped = true;
    return api;
  }

  function readSaveMetaRaw() {
    try { return localStorage.getItem('hobunjiSaveMeta'); } catch (_) { return null; }
  }

  function discoveredLocaleKeys(raw = readSaveMetaRaw()) {
    const keys = new Set();
    try {
      const meta = JSON.parse(raw || 'null');
      for (const world of meta?.worlds || []) {
        for (const localeId of Object.keys(world?.discoveredLocales || {})) keys.add(`${world.id || 'world'}:${localeId}`);
      }
    } catch (_) {}
    return keys;
  }

  function patchWildernessMap(api) {
    if (!api || api.__stableAnimalXpEventsWrapped) return api;
    if (typeof api.updateFogAroundPlayer === 'function') {
      const originalFog = api.updateFogAroundPlayer;
      api.updateFogAroundPlayer = function stableAnimalXpFog(...args) {
        // Runs every frame in the wilderness. The full save meta is only
        // parsed when the fog update actually rewrote it -- identical stored
        // strings mean identical discovered-locale sets (nothing added).
        const beforeRaw = readSaveMetaRaw();
        const result = originalFog.apply(this, args);
        const afterRaw = readSaveMetaRaw();
        if (afterRaw === beforeRaw) return result;
        const before = discoveredLocaleKeys(beforeRaw);
        const after = discoveredLocaleKeys(afterRaw);
        let added = 0;
        for (const key of after) if (!before.has(key)) added++;
        if (added) awardRole('mount', XP.locationDiscovery * added, `discovered ${added} location${added === 1 ? '' : 's'}`);
        return result;
      };
      debug.hooks.localeDiscovery = true;
    }
    if (typeof api.rememberDiscoveredThreat === 'function') {
      const originalThreat = api.rememberDiscoveredThreat;
      api.rememberDiscoveredThreat = function stableAnimalXpThreat(threatKey, info, ...rest) {
        const existed = !!api.getDiscoveredThreats?.()?.[threatKey];
        const result = originalThreat.call(this, threatKey, info, ...rest);
        if (threatKey && !existed && api.getDiscoveredThreats?.()?.[threatKey]) {
          awardRole('mount', XP.locationDiscovery, `discovered ${info?.kind === 'den' ? 'den' : 'camp'}`);
        }
        return result;
      };
      debug.hooks.threatDiscovery = true;
    }
    api.__stableAnimalXpEventsWrapped = true;
    return api;
  }

  function treasureKey(mapId, persisted, placement) {
    return `${mapId}:${persisted?.week ?? 'week'}:${placement?.col},${placement?.row}`;
  }

  function scanTreasureDig(mapId) {
    const persisted = wildTreasureDeps?._zoneTreasurePersist?.get?.(mapId);
    const zone = wildTreasureDeps?._zoneScenes?.get?.(mapId);
    const trenchType = wildTreasureDeps?.TileType?.TRENCH;
    if (!persisted || !zone || trenchType == null) return 0;
    let awards = 0;
    for (const placement of persisted.placements || []) {
      const key = treasureKey(mapId, persisted, placement);
      const dug = zone.grid?.[placement.row]?.[placement.col]?.type === trenchType;
      const previous = treasureDugState.get(key);
      treasureDugState.set(key, !!dug);
      if (previous !== false || !dug || placement.found) continue;
      awardRole('companion', XP.buriedTreasure, 'dug up buried treasure');
      awards++;
    }
    return awards;
  }

  function patchWildTreasure(api) {
    if (!api || api.__stableAnimalXpEventsWrapped) return api;
    if (typeof api.init === 'function') {
      const originalInit = api.init;
      api.init = function stableAnimalXpTreasureInit(injectedDeps, ...rest) {
        wildTreasureDeps = injectedDeps;
        debug.hooks.treasureDeps = true;
        return originalInit.call(this, injectedDeps, ...rest);
      };
    }
    if (typeof api.syncZoneInteractivity === 'function') {
      const originalSync = api.syncZoneInteractivity;
      api.syncZoneInteractivity = function stableAnimalXpTreasureSync(mapId, ...rest) {
        const result = originalSync.call(this, mapId, ...rest);
        scanTreasureDig(mapId);
        return result;
      };
      debug.hooks.treasureDig = true;
    }
    api.__stableAnimalXpEventsWrapped = true;
    return api;
  }

  function patchDenNestSystem(api) {
    if (!api || api.__stableAnimalXpEventsWrapped || typeof api.updateNestInteraction !== 'function') return api;
    const originalUpdate = api.updateNestInteraction;
    api.updateNestInteraction = function stableAnimalXpNestUpdate(...args) {
      const nest = api.currentAimedNest?.() || null;
      const before = Number(nest?.remaining);
      const result = originalUpdate.apply(this, args);
      const after = Number(nest?.remaining);
      if (nest && Number.isFinite(before) && Number.isFinite(after) && after < before) {
        const count = Math.max(1, Math.round(before - after));
        awardRole('companion', XP.nestTheft * count, nest.liveBirth ? 'stole den baby' : 'stole den egg');
      }
      return result;
    };
    api.__stableAnimalXpEventsWrapped = true;
    debug.hooks.nestTheft = true;
    return api;
  }

  function scanBanditCamps() {
    const api = window.BanditCamps;
    if (!api?.campInstances || typeof api.isCampCleared !== 'function') return 0;
    let awards = 0;
    for (const recs of api.campInstances.values?.() || []) {
      for (const rec of recs || []) {
        if (!rec || typeof rec !== 'object') continue;
        const cleared = !!api.isCampCleared(rec);
        const previous = campClearState.get(rec);
        campClearState.set(rec, cleared);
        if (previous === false && cleared) {
          awardRole('companion', XP.banditCampClear, 'cleared bandit camp');
          awards++;
        }
      }
    }
    return awards;
  }

  function patchBanditCamps(api) {
    if (!api || api.__stableAnimalXpCampWrapped) return api;
    for (const methodName of ['updateTentInteraction', 'ensureCurrentZoneCamps']) {
      if (typeof api[methodName] !== 'function') continue;
      const original = api[methodName];
      api[methodName] = function stableAnimalXpCampUpdate(...args) {
        const result = original.apply(this, args);
        scanBanditCamps();
        return result;
      };
    }
    api.__stableAnimalXpCampWrapped = true;
    debug.hooks.banditCamps = true;
    queueMicrotaskSafe(scanBanditCamps);
    return api;
  }

  function gameHourSample() {
    const calendar = window.CalendarSystem;
    if (typeof calendar?.isInitialized === 'function' && !calendar.isInitialized()) return null; // Parser-time install polls before game.js CalendarSystem.init; no travel sample exists yet.
    const deps = combatDeps();
    const player = deps?.player;
    const mount = activePresentEntry('mount');
    const rawDay = Number(calendar?.timeDebugSnapshot?.()?.rawDay ?? window.calendar?.day);
    const hour = Number(calendar?.getHour?.());
    if (!player || !mount || !Number.isFinite(rawDay) || !Number.isFinite(hour)) return null;
    return {
      token: `${Math.floor(rawDay)}:${Math.floor(hour)}`,
      day: Math.floor(rawDay), hour: Math.floor(hour),
      mountId: mount.id || null,
      area: deps.getCurrentArea?.() || null,
      x: Number(player.x) || 0,
      y: Number(player.y) || 0,
      tile: Math.max(1, Number(deps.TILE) || 64),
    };
  }

  function checkMountTravel() {
    const sample = gameHourSample();
    if (!sample) { lastMountTravelSample = null; debug.mountTravel = { active: false }; return 0; }
    if (!lastMountTravelSample) {
      lastMountTravelSample = sample;
      debug.mountTravel = { active: true, sample, awarded: 0, reason: 'seed' };
      return 0;
    }
    if (sample.token === lastMountTravelSample.token) return 0;
    const previous = lastMountTravelSample;
    lastMountTravelSample = sample;
    if (previous.mountId !== sample.mountId || previous.area !== sample.area) {
      debug.mountTravel = { active: true, previous, sample, awarded: 0, reason: 'mount-or-area-changed' };
      return 0;
    }
    const distanceTiles = Math.hypot(sample.x - previous.x, sample.y - previous.y) / sample.tile;
    const amount = distanceTiles < XP.mountTravelMinTiles
      ? 0
      : Math.min(XP.mountTravelHourlyCap, Math.floor(distanceTiles / XP.mountTravelTilesPerXp));
    debug.mountTravel = { active: true, previous, sample, distanceTiles, awarded: amount };
    if (amount > 0) awardRole('mount', amount, `hourly travel:${distanceTiles.toFixed(1)} tiles`);
    return amount;
  }

  function patchGlobal(name, patcher) {
    const current = window[name];
    if (current) {
      const replacement = patcher(current) || current;
      if (replacement !== current) window[name] = replacement;
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && descriptor.configurable === false) return;
    const previousGet = descriptor?.get;
    const previousSet = descriptor?.set;
    let pending = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor?.enumerable !== false,
      get() { return previousGet ? previousGet.call(window) : pending; },
      set(value) {
        if (previousSet) previousSet.call(window, value);
        const resolved = previousGet ? previousGet.call(window) : value;
        const replacement = patcher(resolved) || resolved;
        pending = replacement;
        Object.defineProperty(window, name, { configurable: true, enumerable: true, writable: true, value: replacement });
      },
    });
  }

  function queueMicrotaskSafe(fn) {
    if (typeof queueMicrotask === 'function') queueMicrotask(fn);
    else Promise.resolve().then(fn);
  }

  function tick() {
    try {
      checkMountTravel();
      scanBanditCamps();
    } catch (error) {
      debug.lastError = String(error?.stack || error);
      console.warn('[stable-animal-xp-events]', error);
    }
  }

  function install() {
    if (installed) return api;
    installed = true;
    debug.installed = true;
    patchGlobal('CreatureDeath', patchCreatureDeath);
    patchGlobal('NpcRapport', patchNpcRapport);
    patchGlobal('WildernessMap', patchWildernessMap);
    patchGlobal('WildTreasure', patchWildTreasure);
    patchGlobal('DenNestSystem', patchDenNestSystem);
    patchGlobal('BanditCamps', patchBanditCamps);
    for (const name of ['ProceduralTasks', 'BountyBoard', 'DialogueContent', 'TasksPanel']) patchGlobal(name, patchQuestModule);
    if (typeof setInterval === 'function') pollTimer = setInterval(tick, 1000);
    queueMicrotaskSafe(tick);
    return api;
  }

  function getDebug() {
    return {
      ...debug,
      xp: { ...XP },
      active: Object.fromEntries(['companion', 'mount', 'shoulderPet'].map(role => [role, {
        id: activeEntry(role)?.id || null,
        name: animalName(activeEntry(role)),
        present: !!liveRoleActor(role),
      }])),
      treasureTracked: treasureDugState.size,
      timerActive: !!pollTimer,
    };
  }

  const api = {
    install,
    xp: XP,
    awardRole,
    handleEnemyDefeat,
    scanTreasureDig,
    scanBanditCamps,
    checkMountTravel,
    getDebug,
    _test: { enemyTarget, denMotherTarget, rapportXpForGain, instrumentQuestDeps, patchNpcRapport, patchDenNestSystem, patchWildernessMap, gameHourSample },
  };

  window.StableAnimalXpEvents = api;
  window.__stableAnimalXpDebug = getDebug;
})();