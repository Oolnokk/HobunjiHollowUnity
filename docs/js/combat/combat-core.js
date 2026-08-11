// Combat core — shared windup→strike action pipeline for the weapon tool.
//
// game.js is one big closure-private IIFE, so this module can't reach into
// its internals directly. Instead game.js calls Combat.init(deps) once,
// near the end of its own setup, handing over live references (objects) and
// getter functions (for things that change, like the current area) that the
// rest of this file is built on. Everything below is namespaced on
// window.Combat so later combat-* modules (combo, quick attacks, holds,
// telegraph, loadout) can register into the same pipeline without any of
// them needing to know about game.js's internals either.
(() => {
  "use strict";

  let deps = null;

  const weaponHitResolvers = new Map();

  function registerWeaponAction(actionId, resolverFn) {
    weaponHitResolvers.set(actionId, resolverFn);
  }

  function unregisterWeaponAction(actionId) {
    weaponHitResolvers.delete(actionId);
  }

  function resolveWeaponHit(actionId, fallbackFn) {
    const resolver = weaponHitResolvers.get(actionId);
    if (resolver) return resolver({ actionId, deps });
    return fallbackFn(actionId);
  }

  const activeStaged = new Set();

  function beginStagedAction(opts) {
    const action = {
      windupS: Math.max(0, opts.windupS || 0),
      strikeS: Math.max(0, opts.strikeS || 0),
      recoverS: Math.max(0, opts.recoverS || 0),
      onStrike: opts.onStrike || null,
      onComplete: opts.onComplete || null,
      onCancel: opts.onCancel || null,
      data: opts.data || null,
      t: 0,
      phase: 'windup',
      strikeFired: false,
      cancelled: false,
    };
    action.totalS = action.windupS + action.strikeS + action.recoverS;
    action.cancel = () => {
      if (action.cancelled || action.phase === 'done') return;
      action.cancelled = true;
      action.phase = 'done';
      activeStaged.delete(action);
      if (action.onCancel) action.onCancel(action);
    };
    activeStaged.add(action);
    if (action.totalS <= 0) {
      fireStagedStrike(action);
      finishStagedAction(action);
    }
    return action;
  }

  function fireStagedStrike(action) {
    if (action.strikeFired) return;
    action.strikeFired = true;
    deps?.playWeaponSlashSfx?.(action.data?.sfxPitch);
    if (action.onStrike) action.onStrike(action);
  }

  function finishStagedAction(action) {
    if (action.phase === 'done') return;
    action.phase = 'done';
    activeStaged.delete(action);
    if (action.onComplete) action.onComplete(action);
  }

  function updateStagedAction(action, dt) {
    if (action.cancelled || action.phase === 'done') return;
    action.t += dt;
    const strikeAt = action.windupS;
    if (!action.strikeFired && action.t >= strikeAt) fireStagedStrike(action);
    if (action.t >= action.totalS) finishStagedAction(action);
  }

  function update(dt) {
    for (const action of Array.from(activeStaged)) updateStagedAction(action, dt);
  }

  function cancelAllStaged() {
    for (const action of Array.from(activeStaged)) {
      if (action.data?.isBandit) continue;
      action.cancel();
    }
  }

  function init(injectedDeps) {
    deps = injectedDeps;
  }

  function isStaggered(entity) {
    if (entity?.prone) return true;
    return !!(entity?.staggered?.active && performance.now() < entity.staggered.endsAt);
  }

  function beginStagger(entity, direction, durationS) {
    if (!entity || !(durationS > 0)) return;
    entity.staggered = { active: true, direction, endsAt: performance.now() + durationS * 1000 };
  }

  let playerDamageInterceptor = null;
  let movementSpeedMul = null;

  function setPlayerDamageInterceptor(fn) { playerDamageInterceptor = fn; }
  function tryInterceptPlayerDamage(amount, fromX, fromY) {
    return !!(playerDamageInterceptor && playerDamageInterceptor(amount, fromX, fromY));
  }
  function setMovementSpeedMul(fn) { movementSpeedMul = fn; }
  function getMovementSpeedMul() { return movementSpeedMul ? movementSpeedMul() : 1; }

  window.Combat = {
    init,
    registerWeaponAction,
    unregisterWeaponAction,
    resolveWeaponHit,
    beginStagedAction,
    cancelAllStaged,
    isStaggered,
    beginStagger,
    update,
    setPlayerDamageInterceptor,
    tryInterceptPlayerDamage,
    setMovementSpeedMul,
    getMovementSpeedMul,
    get deps() { return deps; },
  };
})();

// Alcohol / drunken-affliction integration. Combat core is already loaded
// after ResourceSystem and before the extracted inventory/dialogue/calendar/
// world modules are initialized by game.js, so this can wrap their public
// init(deps) seams without duplicating any of game.js's state ownership.
(() => {
  "use strict";

  const RS = window.ResourceSystem;
  if (!RS || RS.__drunkenAfflictionsInstalled) return;

  const DRUNK_FOOTING_ID = "drunkenFooting";
  const DRUNK_HEALTH_ID = "drunkenHealth";
  const DRUNK_RECOVERY_PER_SEC = 0.02;
  const BLACKOUT_LOCAL_LIMIT_PERCENT = 25;
  const BLACKOUT_MIN_SKIP_MINUTES = 30;
  const BLACKOUT_MINUTES_PER_PERCENT = 10;
  const ALCOHOL_TAGS = new Set(["alcohol", "wine", "sake", "vodka", "nectar", "airag", "liquor", "spirit", "spirits"]);
  const INN_DRINKS = [
    { key: "needlegrainSake", buyPrice: 32 },
    { key: "heftrootVodka", buyPrice: 36 },
  ];

  let alchemyDeps = null;
  let storeDeps = null;
  let calendarDeps = null;
  let devDeps = null;
  let climbDeps = null;
  let dialogueDeps = null;
  let lastExteriorAnchor = null;
  let exteriorTrackerStarted = false;
  let lastBlackout = null;
  let lastDrink = null;
  let currentInnSeller = null;
  let originalBeginConversation = null;

  const original = {
    addAffliction: RS.addAffliction.bind(RS),
    removeAffliction: RS.removeAffliction.bind(RS),
    getEffectiveMax: RS.getEffectiveMax.bind(RS),
    getRingFillFraction: RS.getRingFillFraction.bind(RS),
    getSegmentBox: RS.getSegmentBox.bind(RS),
    enforceCaps: RS.enforceCaps.bind(RS),
    applyDamage: RS.applyDamage.bind(RS),
    spendStamina: RS.spendStamina.bind(RS),
    tick: RS.tick.bind(RS),
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const round1 = value => Math.round((Number(value) || 0) * 10) / 10;
  const gameRandom = () => window.GameRandom?.random?.() ?? Math.random();
  const maxFor = (entity, id) => id === DRUNK_FOOTING_ID
    ? Math.max(0, Number(entity?.maxFooting) || 0)
    : Math.max(0, Number(entity?.maxHealth) || 0);
  const getDrunk = (entity, id) => Math.max(0, Number(entity?.afflictions?.[id]) || 0);

  function setDrunk(entity, id, amount) {
    if (!entity) return 0;
    entity.afflictions ||= {};
    entity.afflictions[id] = Math.round(clamp(amount, 0, maxFor(entity, id)) * 1000) / 1000;
    return entity.afflictions[id];
  }

  function addDrunk(entity, id, amount) {
    if (!(amount > 0)) return 0;
    const before = getDrunk(entity, id);
    setDrunk(entity, id, before + amount);
    return round1(getDrunk(entity, id) - before);
  }

  function removeDrunk(entity, id, amount) {
    if (!(amount > 0)) return 0;
    const before = getDrunk(entity, id);
    setDrunk(entity, id, before - amount);
    return round1(before - getDrunk(entity, id));
  }

  RS.AFFLICTIONS[DRUNK_FOOTING_ID] = {
    name: "Drunken Footing", resource: "footing", extend: "maxBack", priority: 100, recovers: false,
    desc: "Black reserved Footing that always counts as spent until sobriety very slowly returns."
  };
  RS.AFFLICTIONS[DRUNK_HEALTH_ID] = {
    name: "Drunken Health", resource: "health", extend: "drunkBand", priority: 40, recovers: false,
    desc: "Pink Health buffer: direct damage converts this band into Bleeding Health before real Health is lost."
  };

  RS.addAffliction = function drunkenAwareAddAffliction(entity, id, amount) {
    if (id === DRUNK_FOOTING_ID || id === DRUNK_HEALTH_ID) return addDrunk(entity, id, amount);
    return original.addAffliction(entity, id, amount);
  };

  RS.removeAffliction = function drunkenAwareRemoveAffliction(entity, id, amount) {
    if (id === DRUNK_FOOTING_ID || id === DRUNK_HEALTH_ID) return removeDrunk(entity, id, amount);
    return original.removeAffliction(entity, id, amount);
  };

  RS.getEffectiveMax = function drunkenAwareEffectiveMax(entity, key) {
    if (key === "footing") {
      return clamp((Number(entity?.maxFooting) || 0) - getDrunk(entity, DRUNK_FOOTING_ID), 0, Number(entity?.maxFooting) || 0);
    }
    return original.getEffectiveMax(entity, key);
  };

  function enforceDrunkenCaps(entity) {
    original.enforceCaps(entity);
    if (Number.isFinite(entity?.footing)) {
      entity.footing = round1(clamp(entity.footing, 0, RS.getEffectiveMax(entity, "footing")));
    }
  }
  RS.enforceCaps = enforceDrunkenCaps;

  RS.getRingFillFraction = function drunkenAwareRingFillFraction(entity, key) {
    if (key === "footing") {
      const max = Number(entity?.maxFooting) || 0;
      return max ? clamp(Number(entity?.footing) / max, 0, 1) : 0;
    }
    return original.getRingFillFraction(entity, key);
  };

  function currentBackHealthUnionWidth(entity) {
    let width = 0;
    for (const [id, def] of Object.entries(RS.AFFLICTIONS)) {
      if (id === DRUNK_HEALTH_ID || def.resource !== "health" || def.extend !== "currentBack") continue;
      width = Math.max(width, RS.getAffliction(entity, id));
    }
    return width;
  }

  RS.getSegmentBox = function drunkenAwareSegmentBox(entity, key, id) {
    if (id === DRUNK_FOOTING_ID) {
      const max = Number(entity?.maxFooting) || 0;
      const amount = clamp(getDrunk(entity, id), 0, max);
      return { leftPoints: max - amount, widthPoints: amount, max };
    }
    if (id === DRUNK_HEALTH_ID) {
      const max = Number(entity?.maxHealth) || 0;
      const current = clamp(Number(entity?.health) || 0, 0, max);
      const otherTail = clamp(currentBackHealthUnionWidth(entity), 0, current);
      const right = Math.max(0, current - otherTail);
      const width = Math.min(getDrunk(entity, id), right);
      return { leftPoints: Math.max(0, right - width), widthPoints: width, max };
    }
    return original.getSegmentBox(entity, key, id);
  };

  const availableBleedingCapacity = entity => Math.max(0,
    (Number(entity?.maxHealth) || 0) - RS.getAffliction(entity, "bleedingHealth"));

  RS.applyDamage = function drunkenAwareApplyDamage(entity, amount, opts = {}) {
    if (!(amount > 0)) return 0;
    entity.lastAttackReceivedAt = performance.now();
    let finalDamage = Number(amount) || 0;
    if (opts.heavy) {
      const bonus = Math.min(RS.getAffliction(entity, "bruisedHealth"), finalDamage);
      if (bonus > 0) {
        RS.removeAffliction(entity, "bruisedHealth", bonus);
        finalDamage += bonus;
      }
    }

    const convertible = Math.min(getDrunk(entity, DRUNK_HEALTH_ID), finalDamage, availableBleedingCapacity(entity));
    if (convertible > 0) {
      removeDrunk(entity, DRUNK_HEALTH_ID, convertible);
      original.addAffliction(entity, "bleedingHealth", convertible);
    }

    const remaining = Math.max(0, finalDamage - convertible);
    const before = Number(entity.health) || 0;
    if (remaining > 0) entity.health = round1(clamp(before - remaining, 0, original.getEffectiveMax(entity, "health")));
    const lost = round1(before - (Number(entity.health) || 0));

    if (opts.afflictionBonuses) {
      for (const [id, mul] of Object.entries(opts.afflictionBonuses)) {
        if (RS.AFFLICTIONS[id] && mul > 0) RS.addAffliction(entity, id, finalDamage * mul);
      }
    }
    enforceDrunkenCaps(entity);
    if (lost > 0) {
      window.dispatchEvent(new CustomEvent("hobunji-resource-change", {
        detail: { entity, delta: -lost, reason: opts.reason || "damage", immediate: true }
      }));
    }
    return lost;
  };

  RS.spendStamina = function drunkenAwareSpendStamina(entity, amount, reason) {
    const beforeHealth = Number(entity?.health) || 0;
    const beforeDrunk = getDrunk(entity, DRUNK_HEALTH_ID);
    const result = original.spendStamina(entity, amount, reason);
    const directLost = Math.max(0, beforeHealth - (Number(entity?.health) || 0));
    if (directLost > 0 && beforeDrunk > 0) {
      const convertible = Math.min(directLost, beforeDrunk, availableBleedingCapacity(entity));
      if (convertible > 0) {
        entity.health = round1(clamp((Number(entity.health) || 0) + convertible, 0, original.getEffectiveMax(entity, "health")));
        removeDrunk(entity, DRUNK_HEALTH_ID, convertible);
        original.addAffliction(entity, "bleedingHealth", convertible);
      }
    }
    enforceDrunkenCaps(entity);
    return result;
  };

  RS.tick = function drunkenAwareTick(entity, dt, opts = {}) {
    const result = original.tick(entity, dt, opts);
    const recovery = Math.max(0, Number(dt) || 0) * DRUNK_RECOVERY_PER_SEC;
    if (recovery > 0) {
      removeDrunk(entity, DRUNK_FOOTING_ID, recovery);
      removeDrunk(entity, DRUNK_HEALTH_ID, recovery);
    }
    enforceDrunkenCaps(entity);
    return result;
  };

  function ensureCanonicalInnDrinkDefs(itemDefs) {
    if (!itemDefs) return;
    itemDefs.needlegrainSake ||= {
      icon: "🍶", label: "Needlegrain Sake", cat: "processed", sellPrice: 24,
      tags: ["Processed", "Sake", "Aged", "Needlegrain"],
      desc: "Barrel-aged needlegrain liquor, colored like dark pine needles.",
      spriteIcon: "bottle_wine.png", spriteColor: 0x2F4A2E, spriteMode: "keyed"
    };
    itemDefs.heftrootVodka ||= {
      icon: "🥃", label: "Heftroot Vodka", cat: "processed", sellPrice: 26,
      tags: ["Processed", "Vodka", "Aged", "Heftroot"],
      desc: "Barrel-aged heftroot spirit, clear white.",
      spriteIcon: "bottle_wine.png", spriteColor: 0xFFFFFF, spriteMode: "keyed"
    };
  }

  function alcoholProfileForDef(def) {
    if (!def) return null;
    const tags = (def.tags || []).map(tag => String(tag).toLowerCase());
    const haystack = `${tags.join(" ")} ${String(def.label || "").toLowerCase()}`;
    const alcoholic = tags.some(tag => ALCOHOL_TAGS.has(tag)) || /\b(wine|sake|vodka|nectar|airag|liquor|spirit|alcohol)\b/.test(haystack);
    if (!alcoholic) return null;
    if (haystack.includes("vodka") || haystack.includes("spirit") || haystack.includes("liquor")) return { footing: 32, health: 14, strength: "strong" };
    if (haystack.includes("sake")) return { footing: 24, health: 11, strength: "medium" };
    if (haystack.includes("wine")) return { footing: 20, health: 9, strength: "medium" };
    if (haystack.includes("nectar")) return { footing: 18, health: 8, strength: "mild" };
    if (haystack.includes("airag")) return { footing: 16, health: 7, strength: "mild" };
    return { footing: 20, health: 9, strength: "medium" };
  }

  const itemDefs = () => alchemyDeps?.ITEM_DEFS || storeDeps?.ITEM_DEFS || null;
  const isAlcoholItem = key => !!alcoholProfileForDef(itemDefs()?.[key]);

  function hookInit(api, onInit) {
    if (!api?.init || api.__hobunjiAlcoholInitHooked) return;
    const originalInit = api.init.bind(api);
    api.init = function alcoholAwareInit(injectedDeps) {
      const result = originalInit(injectedDeps);
      onInit(injectedDeps);
      return result;
    };
    api.__hobunjiAlcoholInitHooked = true;
  }

  function hookFutureGlobal(name, patch) {
    if (window[name]) { patch(window[name]); return; }
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && !descriptor.configurable) return;
    Object.defineProperty(window, name, {
      configurable: true,
      get() { return undefined; },
      set(value) {
        delete window[name];
        window[name] = value;
        patch(value);
      }
    });
  }

  function installAlchemyHook(api) {
    hookInit(api, injectedDeps => {
      alchemyDeps = injectedDeps;
      ensureCanonicalInnDrinkDefs(injectedDeps?.ITEM_DEFS);
    });
    if (api.__hobunjiAlcoholDrinkHooked) return;
    const potionRegistry = api.ALCHEMY_POTION_ITEMS || {};
    api.ALCHEMY_POTION_ITEMS = new Proxy(potionRegistry, {
      get(target, prop, receiver) {
        if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
        if (typeof prop === "string" && isAlcoholItem(prop)) return ["__alcohol__"];
        return undefined;
      }
    });
    const originalDrinkPotion = api.drinkPotion?.bind(api);
    api.drinkPotion = function alcoholAwareDrinkPotion(key) {
      if (!isAlcoholItem(key)) return originalDrinkPotion ? originalDrinkPotion(key) : { ok: false, message: "No drink available." };
      const inventory = alchemyDeps?.inventory;
      const def = itemDefs()?.[key];
      const profile = alcoholProfileForDef(def);
      const player = window.Combat?.deps?.player;
      if (!inventory || !player || !profile || (inventory[key] || 0) < 1) return { ok: false, message: "No alcoholic drink to consume." };
      inventory[key]--;
      alchemyDeps?.clampInventoryStack?.(key);
      const result = RS.addDrunkenness(player, profile.footing, profile.health, { source: key, label: def?.label || key });
      lastDrink = {
        key, label: def?.label || key,
        footingAdded: result.footingAdded,
        healthAdded: result.healthAdded,
        deficitPercent: result.deficitPercent,
        at: performance.now()
      };
      const blackoutText = result.blackout ? ` Blackout: ${Math.round(result.deficitPercent)}% deficit.` : "";
      return { ok: true, message: `${def?.icon || "🍷"} Drank ${def?.label || key}.${blackoutText}` };
    };
    api.__hobunjiAlcoholDrinkHooked = true;
  }

  function installGeneralStoreHook(api) {
    hookInit(api, injectedDeps => {
      storeDeps = injectedDeps;
      ensureCanonicalInnDrinkDefs(injectedDeps?.ITEM_DEFS);
    });
  }
  function installCalendarHook(api) { hookInit(api, injectedDeps => { calendarDeps = injectedDeps; }); }
  function installClimbHook(api) { hookInit(api, injectedDeps => { climbDeps = injectedDeps; }); }

  function isExteriorArea(area) {
    return area === "farm" || area === "town" || !!devDeps?._isZoneArea?.(area);
  }

  function inferredExteriorForArea(area) {
    if (isExteriorArea(area)) return area;
    if (area === "interior") return "farm";
    if (area === "map_i_researchers_tent") return "map_northern_cliffs";
    if (/swamp/i.test(String(area))) return "map_eastern_mire";
    if (devDeps?._isBuildingArea?.(area)) return "town";
    return lastExteriorAnchor?.area || "town";
  }

  function startExteriorTracker() {
    if (exteriorTrackerStarted || !devDeps) return;
    exteriorTrackerStarted = true;
    const track = () => {
      const area = devDeps?.getCurrentArea?.();
      if (devDeps && isExteriorArea(area)) {
        lastExteriorAnchor = {
          area,
          col: Math.floor((Number(devDeps.player?.x) || 0) / (Number(devDeps.TILE) || 1)),
          row: Math.floor((Number(devDeps.player?.y) || 0) / (Number(devDeps.TILE) || 1))
        };
      }
      requestAnimationFrame(track);
    };
    requestAnimationFrame(track);
  }

  function installDevSpawnerHook(api) {
    hookInit(api, injectedDeps => {
      devDeps = injectedDeps;
      startExteriorTracker();
    });
  }

  function exteriorAdjacency(area) {
    const zoneIds = Object.keys(devDeps?.EXTERIOR_ZONES || {}).filter(id => id !== "map_dev_arena");
    if (area === "farm") return ["town"];
    if (area === "town") return ["farm", ...zoneIds];
    if (zoneIds.includes(area)) return ["town"];
    return ["town"];
  }

  function fallbackAnchorForArea(area, cols, rows) {
    if (lastExteriorAnchor?.area === area) return { col: lastExteriorAnchor.col, row: lastExteriorAnchor.row };
    const zdef = devDeps?.EXTERIOR_ZONES?.[area];
    if (zdef) {
      return {
        col: clamp(zdef.entryCol ?? Math.floor(cols / 2), 0, Math.max(0, cols - 1)),
        row: clamp(zdef.entryRow ?? Math.floor(rows / 2), 0, Math.max(0, rows - 1))
      };
    }
    if (area === "farm") return { col: clamp(17, 0, Math.max(0, cols - 1)), row: clamp(1, 0, Math.max(0, rows - 1)) };
    return { col: Math.floor(cols / 2), row: Math.floor(rows / 2) };
  }

  function isBlackoutWalkable(grid, col, row) {
    const tile = grid?.[row]?.[col];
    if (!tile || tile.incline) return false;
    if (climbDeps?.isSolid?.(tile.type)) return false;
    return true;
  }

  function chooseWalkableTile(grid, cols, rows, anchor, radius) {
    const candidates = [];
    const r = Math.max(1, Math.round(radius));
    const minCol = Math.max(0, Math.floor(anchor.col - r));
    const maxCol = Math.min(cols - 1, Math.ceil(anchor.col + r));
    const minRow = Math.max(0, Math.floor(anchor.row - r));
    const maxRow = Math.min(rows - 1, Math.ceil(anchor.row + r));
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const dx = col - anchor.col, dy = row - anchor.row;
        if (dx * dx + dy * dy <= r * r && isBlackoutWalkable(grid, col, row)) candidates.push({ col, row });
      }
    }
    if (candidates.length) return candidates[Math.floor(gameRandom() * candidates.length)];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (isBlackoutWalkable(grid, col, row)) candidates.push({ col, row });
      }
    }
    return candidates.length ? candidates[Math.floor(gameRandom() * candidates.length)] : null;
  }

  function addPlayerToScene(scene) {
    if (!scene || !devDeps) return;
    scene.add(devDeps.playerMesh); scene.add(devDeps.playerGroundShadow);
    scene.add(devDeps.toolHolder); scene.add(devDeps.reticleMesh);
    scene.add(devDeps.reticleCircleMesh); scene.add(devDeps.reticleRingMesh);
    scene.add(devDeps.reticleWavyGroup);
  }

  function skipBlackoutTime(deficitPercent) {
    if (!calendarDeps?.calendar) return 0;
    const skippedMinutes = Math.max(BLACKOUT_MIN_SKIP_MINUTES, Math.round(deficitPercent * BLACKOUT_MINUTES_PER_PERCENT));
    const morning = Number(calendarDeps.MORNING_HOUR) || 6;
    const night = Number(calendarDeps.NIGHT_HOUR) || 22;
    const playableMinutesPerDay = Math.max(60, (night - morning) * 60);
    const calendar = calendarDeps.calendar;
    let total = (Number(calendar.time01) || 0) + skippedMinutes / playableMinutesPerDay;
    while (total >= 1) {
      total -= 1;
      calendar.day = (Number(calendar.day) || 1) + 1;
    }
    calendar.time01 = Math.max(0, total);
    return skippedMinutes;
  }

  function performBlackoutTravel(deficitPercent) {
    if (!devDeps) return null;
    const currentArea = devDeps.getCurrentArea();
    const baseExterior = inferredExteriorForArea(currentArea);
    const crossesMap = deficitPercent > BLACKOUT_LOCAL_LIMIT_PERCENT;
    const adjacent = exteriorAdjacency(baseExterior);
    const targetArea = crossesMap && adjacent.length
      ? adjacent[Math.floor(gameRandom() * adjacent.length)]
      : baseExterior;
    const radius = crossesMap
      ? Math.max(1, Math.ceil(deficitPercent - BLACKOUT_LOCAL_LIMIT_PERCENT))
      : Math.max(1, Math.ceil(deficitPercent));

    const doTravel = () => {
      const fromScene = devDeps.getActiveScene?.();
      if (fromScene) {
        fromScene.remove(devDeps.playerMesh); fromScene.remove(devDeps.playerGroundShadow);
        fromScene.remove(devDeps.toolHolder); fromScene.remove(devDeps.reticleMesh);
        fromScene.remove(devDeps.reticleCircleMesh); fromScene.remove(devDeps.reticleRingMesh);
        fromScene.remove(devDeps.reticleWavyGroup);
      }
      if (devDeps._isBuildingArea?.(currentArea)) devDeps.setCurrentBuildingMapId?.(null);
      devDeps.setCurrentArea(targetArea);
      // Town and wilderness scenes are both lazy. A cross-map blackout must
      // build its destination before getActiveGrid/getActiveScene are read,
      // just like ordinary gate travel does.
      if (targetArea === "town") devDeps.buildTownScene?.();
      else if (devDeps._isZoneArea?.(targetArea)) devDeps.buildZoneScene?.(targetArea);
      const grid = devDeps.getActiveGrid?.();
      const cols = Number(devDeps.getActiveCols?.()) || grid?.[0]?.length || 1;
      const rows = Number(devDeps.getActiveRows?.()) || grid?.length || 1;
      const anchor = !crossesMap && lastExteriorAnchor?.area === targetArea
        ? { col: lastExteriorAnchor.col, row: lastExteriorAnchor.row }
        : fallbackAnchorForArea(targetArea, cols, rows);
      const tile = chooseWalkableTile(grid, cols, rows, anchor, radius) || anchor;
      const tileSize = Number(devDeps.TILE) || 1;
      devDeps.player.x = (tile.col + 0.5) * tileSize;
      devDeps.player.y = (tile.row + 0.5) * tileSize;
      devDeps.player.vx = 0; devDeps.player.vy = 0;
      devDeps._snapCameraTarget?.();
      addPlayerToScene(devDeps.getActiveScene?.());
      devDeps.refreshActionBar?.();
      return { fromArea: currentArea, baseExterior, targetArea, radius, tile };
    };

    let immediateResult = null;
    if (typeof devDeps.startSceneTransition === "function") {
      devDeps.startSceneTransition(() => { immediateResult = doTravel(); });
    } else immediateResult = doTravel();
    return { requestedFromArea: currentArea, baseExterior, targetArea, radius, immediateResult };
  }

  function triggerBlackout(deficitPercent, source = "alcohol") {
    const effectivePercent = Math.max(1, Number(deficitPercent) || 0);
    const skippedMinutes = skipBlackoutTime(effectivePercent);
    const travel = performBlackoutTravel(effectivePercent);
    lastBlackout = { source, deficitPercent: effectivePercent, skippedMinutes, travel, at: performance.now() };
    devDeps?.showToast?.(`🍺 Blackout — ${skippedMinutes} minutes passed.`, true);
    return lastBlackout;
  }

  RS.addDrunkenness = function addDrunkenness(entity, footingAmount, healthAmount, opts = {}) {
    if (!entity) return { footingAdded: 0, healthAdded: 0, deficitPercent: 0, blackout: false };
    entity.afflictions ||= {};
    const maxFooting = Math.max(0, Number(entity.maxFooting) || 0);
    const before = getDrunk(entity, DRUNK_FOOTING_ID);
    const attempted = before + Math.max(0, Number(footingAmount) || 0);
    const footingAdded = addDrunk(entity, DRUNK_FOOTING_ID, footingAmount);
    const healthAdded = addDrunk(entity, DRUNK_HEALTH_ID, healthAmount);
    enforceDrunkenCaps(entity);
    const overflowPoints = Math.max(0, attempted - maxFooting);
    const reachedFull = maxFooting > 0 && before < maxFooting && getDrunk(entity, DRUNK_FOOTING_ID) >= maxFooting;
    const rawDeficitPercent = maxFooting > 0 ? overflowPoints / maxFooting * 100 : 0;
    const blackout = reachedFull || overflowPoints > 0;
    const deficitPercent = blackout ? Math.max(1, rawDeficitPercent) : 0;
    if (blackout && entity === window.Combat?.deps?.player) triggerBlackout(deficitPercent, opts.source || "alcohol");
    return { footingAdded, healthAdded, overflowPoints, deficitPercent, blackout };
  };

  function buyInnDrink(itemKey) {
    const stock = INN_DRINKS.find(item => item.key === itemKey);
    const def = itemDefs()?.[itemKey];
    if (!stock || !def || !storeDeps?.inventory) return;
    const gold = Number(storeDeps.inventory.gold) || 0;
    if (gold < stock.buyPrice) { storeDeps.showToast?.("Not enough gold.", false); return; }
    if ((storeDeps.inventory[itemKey] || 0) >= 99) { storeDeps.showToast?.("That stack is full.", false); return; }
    storeDeps.inventory.gold = gold - stock.buyPrice;
    storeDeps.inventory[itemKey] = Math.min(99, (storeDeps.inventory[itemKey] || 0) + 1);
    storeDeps.showToast?.(`Bought ${def.label}!`, true);
    storeDeps.buildInventoryGrid?.();
    storeDeps.saveMemberWorldData?.();
    renderInnDrinkChoices(currentInnSeller);
  }

  const sellerName = rec => `${rec?.id || ""} ${rec?.name || ""} ${rec?.displayName || ""} ${rec?.label || ""}`.toLowerCase();
  function isInnSeller(rec) {
    const name = sellerName(rec);
    return name.includes("hreesh") || name.includes("tooth");
  }
  function atInn() {
    const area = window.Combat?.deps?.getCurrentArea?.() || devDeps?.getCurrentArea?.();
    return area === "map_i_inn" || area === "map_i_inn_F2";
  }

  function setDialogueOption(index, label, onClick) {
    const button = document.getElementById(`dlgOpt${index}`);
    if (!button) return;
    const text = button.querySelector(".dlg-opt-label");
    if (text) text.textContent = label;
    button.classList.add("dlg-opt-visible");
    button.onclick = onClick;
  }

  function renderInnDrinkChoices(rec) {
    const dialogue = window.DialogueContent;
    if (!dialogue || !rec) return;
    currentInnSeller = rec;
    dialogue.beginSyntheticChoice(rec);
    dialogue.renderDlgNode({
      type: "choice",
      text: `${rec?.name || rec?.displayName || "The bartender"} gestures toward the bottles behind the bar.`,
      choices: []
    });
    dialogue.hideChoiceButtons?.();
    INN_DRINKS.forEach((stock, index) => {
      const def = itemDefs()?.[stock.key];
      setDialogueOption(index + 1, `${def?.icon || "🍷"} ${def?.label || stock.key} — ${stock.buyPrice}g`, () => buyInnDrink(stock.key));
    });
    setDialogueOption(3, "Chat", () => {
      currentInnSeller = null;
      originalBeginConversation?.(rec);
    });
    setDialogueOption(4, "Goodbye", () => {
      currentInnSeller = null;
      dialogue.resetDialogueState?.();
      dialogueDeps?.closeNpcDialogue?.();
    });
    const continueBtn = document.getElementById("npcDialogueContinue");
    if (continueBtn) continueBtn.style.display = "none";
  }

  function installDialogueHook(api) {
    hookInit(api, injectedDeps => { dialogueDeps = injectedDeps; });
    if (api.__hobunjiAlcoholDialogueHooked) return;
    originalBeginConversation = api.beginNpcConversation?.bind(api);
    if (!originalBeginConversation) return;
    api.beginNpcConversation = function alcoholAwareBeginConversation(rec) {
      if (isInnSeller(rec) && atInn()) { renderInnDrinkChoices(rec); return; }
      return originalBeginConversation(rec);
    };
    api.__hobunjiAlcoholDialogueHooked = true;
  }

  hookFutureGlobal("AlchemySystem", installAlchemyHook);
  hookFutureGlobal("GeneralStore", installGeneralStoreHook);
  hookFutureGlobal("CalendarSystem", installCalendarHook);
  hookFutureGlobal("ClimbSystem", installClimbHook);
  hookFutureGlobal("DevSpawner", installDevSpawnerHook);
  hookFutureGlobal("DialogueContent", installDialogueHook);

  RS.__drunkenAfflictionsInstalled = true;

  window.HobunjiAlcohol = {
    getDebug() {
      const player = window.Combat?.deps?.player;
      return {
        drunkenFooting: getDrunk(player, DRUNK_FOOTING_ID),
        drunkenHealth: getDrunk(player, DRUNK_HEALTH_ID),
        effectiveFootingMax: player ? RS.getEffectiveMax(player, "footing") : 0,
        recoveryPerSecond: DRUNK_RECOVERY_PER_SEC,
        sameMapDeficitLimitPercent: BLACKOUT_LOCAL_LIMIT_PERCENT,
        lastDrink, lastBlackout, lastExteriorAnchor
      };
    },
    forceDrink(profile = "vodka") {
      const player = window.Combat?.deps?.player;
      if (!player) return null;
      const fake = profile === "sake" ? { footing: 24, health: 11 }
        : profile === "wine" ? { footing: 20, health: 9 }
        : { footing: 32, health: 14 };
      return RS.addDrunkenness(player, fake.footing, fake.health, { source: `debug:${profile}` });
    },
    triggerBlackout(percent) { return triggerBlackout(percent, "debug"); },
    clear() {
      const player = window.Combat?.deps?.player;
      if (!player) return;
      setDrunk(player, DRUNK_FOOTING_ID, 0);
      setDrunk(player, DRUNK_HEALTH_ID, 0);
      enforceDrunkenCaps(player);
    }
  };
})();
