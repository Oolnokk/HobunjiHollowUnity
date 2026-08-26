// Event-gated tool/weapon mastery progression.
// Old game.js award-on-use / award-on-hit calls still exist, so this module
// guards the shared mastery state and only permits explicit qualifying events.
(() => {
  'use strict';
  if (window.HobunjiMasteryPolicy) return;

  const CONFIG = Object.freeze({
    worthXpScale: 0.5,
    shovelWorthRate: 0.5,
    pureCombatMultiplier: 2,
    combatHealthReference: 60,
    combatDamageReference: 8,
    combatBaseScale: 1.25,
    combatXpMin: 0.5,
    combatXpMax: 8,
    qualityStep: 0.25,
    rangedKillLatchMs: 250,
  });
  const THRESHOLDS = Object.freeze([40, 90, 150, 220, 300]); // Used to preserve the existing five mastery thresholds.
  const COMBAT_SLOTS = new Set(['weapon', 'mainHand', 'melee', 'ranged']); // Used to detect weapon-only gear such as future swords.

  let armed = false; // Used to allow normal save/bootstrap hydration before gameplay writes are gated.
  let permitDepth = 0; // Used to permit only policy/dev positive XP writes after arming.
  let popupPermitDepth = 0; // Used to allow this module's own mastery popup.
  let combatDeps = null; // Used for combat equipment and damage hooks.
  let equipmentDeps = null; // Used for live gear/equipment/save hooks.
  let hostDeps = null; // Used for canonical ITEM_DEFS economy values.
  let treasureDeps = null; // Used for buried-treasure placements and loot.
  let gearGetter = null; // Used to follow gearInventory replacements on load/character switches.
  let lastGear = null; // Used to avoid re-guarding the same gear object.
  let lastQuality = null; // Used to bind a farming XP event to its harvested crop and stars.
  let pendingRangedKill = null; // Used to pair lethal ranged damage with the exact ranged itemKey callback.
  const treasureDugState = new Map(); // Used to detect only the first buried→dug transition.
  const guardedMaps = new WeakMap(); // Used to keep one Proxy per raw mastery map.
  const guardedRecords = new WeakMap(); // Used to keep one Proxy per raw mastery record.
  const guardedRecordProxies = new WeakSet(); // Used to avoid proxy nesting.
  const debug = {
    blockedWrites: 0, suppressedLegacyCombatAwards: 0, suppressedLegacyPopups: 0,
    lastBlocked: null, lastAward: null, lastKill: null, lastHarvest: null, lastTreasure: null, lastDeathRecovery: null,
  }; // Used by mobile-friendly getDebug()/formatDebug().

  const now = () => (performance?.now ? performance.now() : Date.now());
  const round1 = value => Math.round((Number(value) || 0) * 10) / 10;
  const round2 = value => Math.round((Number(value) || 0) * 100) / 100;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  function firstFinite(...values) {
    for (const value of values) if (Number.isFinite(Number(value))) return Number(value);
    return null;
  }
  function withPermit(fn) {
    permitDepth++;
    try { return fn(); } finally { permitDepth--; }
  }
  function masteryXp(record) {
    const xp = Number(record?.xp);
    return Number.isFinite(xp) ? Math.max(0, xp) : 0;
  }
  function blockWrite(itemKey, before, attempted) {
    debug.blockedWrites++;
    debug.lastBlocked = { itemKey: String(itemKey || ''), before: round2(before), attempted: round2(attempted), at: now() };
  }

  function guardRecord(record, itemKey) {
    if (!record || typeof record !== 'object') record = { xp: 0 };
    if (guardedRecordProxies.has(record)) return record;
    if (guardedRecords.has(record)) return guardedRecords.get(record);
    const proxy = new Proxy(record, {
      set(target, property, value) {
        if (property === 'xp') {
          const before = masteryXp(target);
          const attempted = Math.max(0, Number(value) || 0);
          if (armed && permitDepth <= 0 && attempted > before) { blockWrite(itemKey, before, attempted); return true; }
          target.xp = attempted;
          return true;
        }
        target[property] = value;
        return true;
      },
      defineProperty(target, property, descriptor) {
        if (property === 'xp' && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          const before = masteryXp(target);
          const attempted = Math.max(0, Number(descriptor.value) || 0);
          if (armed && permitDepth <= 0 && attempted > before) { blockWrite(itemKey, before, attempted); return true; }
          descriptor = { ...descriptor, value: attempted };
        }
        return Reflect.defineProperty(target, property, descriptor);
      },
    });
    guardedRecords.set(record, proxy);
    guardedRecordProxies.add(proxy);
    return proxy;
  }

  function guardMasteryMap(rawMap) {
    const map = rawMap && typeof rawMap === 'object' ? rawMap : {};
    if (guardedMaps.has(map)) return guardedMaps.get(map);
    for (const [key, record] of Object.entries(map)) map[key] = guardRecord(record, key);
    const proxy = new Proxy(map, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof property !== 'string' || !value || typeof value !== 'object') return value;
        const guarded = guardRecord(value, property);
        if (guarded !== value) target[property] = guarded;
        return guarded;
      },
      set(target, property, value) {
        if (typeof property !== 'string') { target[property] = value; return true; }
        const before = masteryXp(target[property]);
        let next = value && typeof value === 'object' ? value : { xp: Number(value) || 0 };
        const attempted = masteryXp(next);
        if (armed && permitDepth <= 0 && attempted > before) {
          blockWrite(property, before, attempted);
          next = { ...next, xp: before };
        }
        target[property] = guardRecord(next, property);
        return true;
      },
      defineProperty(target, property, descriptor) {
        if (typeof property === 'string' && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          const before = masteryXp(target[property]);
          let next = descriptor.value && typeof descriptor.value === 'object' ? descriptor.value : { xp: Number(descriptor.value) || 0 };
          const attempted = masteryXp(next);
          if (armed && permitDepth <= 0 && attempted > before) {
            blockWrite(property, before, attempted);
            next = { ...next, xp: before };
          }
          descriptor = { ...descriptor, value: guardRecord(next, property) };
        }
        return Reflect.defineProperty(target, property, descriptor);
      },
    });
    guardedMaps.set(map, proxy);
    return proxy;
  }

  function guardGear(gear) {
    if (!gear || typeof gear !== 'object' || gear.__hobunjiMasteryPolicyGuarded) return gear || null;
    let masteryMap = guardMasteryMap(gear.toolMastery || {}); // Used as the guarded map behind the live gear property.
    try {
      Object.defineProperty(gear, 'toolMastery', {
        configurable: true, enumerable: true,
        get: () => masteryMap,
        set: next => { masteryMap = guardMasteryMap(next || {}); },
      });
      Object.defineProperty(gear, '__hobunjiMasteryPolicyGuarded', { configurable: true, value: true });
    } catch (_) { gear.toolMastery = masteryMap; }
    return gear;
  }

  function currentGear() {
    let gear = null; // Used to resolve the current character's live gear object.
    try {
      if (gearGetter) gear = gearGetter();
      else if (typeof combatDeps?.gearInventory === 'function') gear = combatDeps.gearInventory();
      else gear = combatDeps?.gearInventory || null;
    } catch (_) {}
    if (gear && (gear !== lastGear || !gear.__hobunjiMasteryPolicyGuarded)) lastGear = guardGear(gear);
    return lastGear;
  }
  const slots = () => equipmentDeps?.equipmentSlots || combatDeps?.equipmentSlots || {};
  const toolDefs = () => equipmentDeps?.TOOL_ITEM_DEFS || combatDeps?.TOOL_ITEM_DEFS || {};
  const itemDefs = () => hostDeps?.ITEM_DEFS || treasureDeps?.ITEM_DEFS || {};

  function itemWorth(itemKey, fallback = 1) {
    const def = itemDefs()[itemKey] || {};
    const sell = firstFinite(def.sellPrice, def.sellValue, def.value, def.baseValue);
    if (sell != null && sell > 0) return sell;
    const retail = firstFinite(def.price, def.buyPrice, def.cost);
    return retail != null && retail > 0 ? Math.max(1, retail * 0.4) : Math.max(1, Number(fallback) || 1);
  }
  const qualityMultiplier = stars => 1 + Math.max(0, (Number(stars) || 1) - 1) * CONFIG.qualityStep;
  const worthXp = (worth, rate = 1) => round2(Math.max(0.5, Math.sqrt(Math.max(1, Number(worth) || 0)) * CONFIG.worthXpScale) * Math.max(0, Number(rate) || 0));
  function masteryLevel(xp) {
    let level = 0;
    for (const threshold of THRESHOLDS) if ((Number(xp) || 0) >= threshold) level++;
    return level;
  }
  const toolLabel = key => toolDefs()[key]?.label || key || 'Tool';

  function award(itemKey, amount, reason, metadata = {}) {
    if (!itemKey || !(Number(amount) > 0)) return 0;
    const gear = currentGear();
    if (!gear) return 0;
    let record = gear.toolMastery[itemKey]; // Used as this tool's canonical persistent mastery record.
    if (!record) {
      withPermit(() => { gear.toolMastery[itemKey] = { xp: 0 }; });
      record = gear.toolMastery[itemKey];
    }
    const before = masteryXp(record);
    const delta = round2(amount);
    const after = round2(before + delta);
    withPermit(() => { record.xp = after; });
    try { equipmentDeps?.saveGearInventory?.(); } catch (_) {}
    debug.lastAward = { itemKey, label: toolLabel(itemKey), amount: delta, before, after, reason, metadata: { ...metadata }, at: now() };
    if (window.WorldPopupText?.showChange) {
      popupPermitDepth++;
      try { window.WorldPopupText.showChange('masteryXp', delta, { text: `+${delta} ${toolLabel(itemKey)} Mastery` }); }
      finally { popupPermitDepth--; }
    }
    if (masteryLevel(after) > masteryLevel(before)) equipmentDeps?.showToast?.(`${toolLabel(itemKey)} Mastery ${masteryLevel(after)}/5`, true);
    try { window.dispatchEvent?.(new CustomEvent('hobunji-mastery-award', { detail: { ...debug.lastAward } })); } catch (_) {}
    return delta;
  }

  function enemyDifficulty(enemy) {
    const def = enemy?.def || {};
    const hp = firstFinite(enemy?.maxHealth, enemy?.healthMax, enemy?.maxHP, def.maxHealth, def.healthMax, def.maxHP, def.health, enemy?._masteryObservedMaxHealth)
      ?? Math.max(1, Number(enemy?.health) || CONFIG.combatHealthReference);
    const damage = firstFinite(enemy?.attackDamage, enemy?.damage, enemy?.contactDamage, def.attackDamage, def.damage, def.contactDamage, def.biteDamage)
      ?? CONFIG.combatDamageReference;
    const explicit = firstFinite(enemy?.masteryDifficulty, def.masteryDifficulty, enemy?.difficulty, def.difficulty, enemy?.threatLevel, def.threatLevel, enemy?.tier, def.tier);
    const explicitFactor = explicit != null && explicit > 0 ? 0.75 + Math.sqrt(explicit) * 0.25 : 1;
    return clamp(CONFIG.combatBaseScale * Math.sqrt(Math.max(1, hp) / CONFIG.combatHealthReference) * Math.sqrt(Math.max(1, damage) / CONFIG.combatDamageReference) * explicitFactor, CONFIG.combatXpMin, CONFIG.combatXpMax);
  }

  function isPureCombatWeapon(itemKey, ranged = false) {
    if (ranged) return true;
    const itemSlots = Array.isArray(toolDefs()[itemKey]?.slots) ? toolDefs()[itemKey].slots.map(String) : [];
    return itemSlots.some(slot => COMBAT_SLOTS.has(slot)) && !itemSlots.some(slot => !COMBAT_SLOTS.has(slot));
  }
  const meleeKey = () => combatDeps?.currentWeaponKey?.() || slots().weapon || slots().mainHand || slots().melee || null;
  const rangedKey = () => combatDeps?.getEquippedRangedKey?.() || slots().ranged || null;

  function awardKill(itemKey, enemy, ranged = false) {
    if (!itemKey || !enemy) return 0;
    const difficulty = enemyDifficulty(enemy);
    const multiplier = isPureCombatWeapon(itemKey, ranged) ? CONFIG.pureCombatMultiplier : 1;
    const amount = round1(difficulty * multiplier);
    debug.lastKill = { enemy: enemy?.def?.label || enemy?.label || enemy?.id || 'hostile', itemKey, ranged: !!ranged, difficulty: round1(difficulty), multiplier, amount, at: now() };
    return award(itemKey, amount, ranged ? 'ranged kill' : 'melee kill', { enemy: debug.lastKill.enemy, difficulty: debug.lastKill.difficulty, combatOnlyMultiplier: multiplier });
  }

  function patchCombat(api) {
    if (!api?.init || api.__masteryPolicyPatched) return;
    const originalInit = api.init.bind(api); // Used to preserve Combat initialization while replacing mastery-producing callbacks.
    const originalUpdate = api.update?.bind(api); // Used to re-guard gear after character/save swaps.
    api.init = function masteryPolicyCombatInit(injected = {}, ...rest) {
      combatDeps = injected;
      const damageCreature = injected.damageCreature; // Used to detect the exact lethal player damage transition.
      if (typeof damageCreature === 'function' && !damageCreature.__masteryPolicyWrapped) {
        const wrapped = function masteryPolicyDamageCreature(enemy, ...args) {
          const before = Math.max(0, Number(enemy?.health) || 0);
          if (enemy && before > Number(enemy._masteryObservedMaxHealth || 0)) enemy._masteryObservedMaxHealth = before;
          let result; // Used to preserve the wrapped damage result or the safe lethal-transition recovery result.
          try {
            result = damageCreature(enemy, ...args);
          } catch (error) {
            const afterError = Math.max(0, Number(enemy?.health) || 0); // Used to distinguish a recoverable interrupted death from an unrelated combat error.
            if (!(enemy && before > 0 && afterError <= 0)) throw error;
            combatDeps?.hostileObjects?.delete?.(enemy);
            combatDeps?.companionObjects?.delete?.(enemy);
            const recovered = window.CreatureDeath?.recover?.(enemy, args[1], args[2], error); // Used to finish corpse conversion when a reward/UI hook aborts core damageCreature after lethal health was applied.
            debug.lastDeathRecovery = {
              at: now(), enemy: enemy?.id || enemy?.def?.label || 'hostile',
              recovered: !!recovered, reason: error?.stack || error?.message || String(error),
            };
            window.__farmLog?.(`[mastery] lethal transition ${recovered ? 'recovered' : 'FAILED'} for ${debug.lastDeathRecovery.enemy}: ${debug.lastDeathRecovery.reason}`, 'combat');
            if (!recovered) throw error;
            result = false;
          }
          const after = Math.max(0, Number(enemy?.health) || 0);
          const options = args[4] && typeof args[4] === 'object' ? args[4] : {};
          if (before > 0 && after <= 0) {
            if (options.ranged) {
              const kill = { enemy, at: now() }; // Used until ranged-weapons.js supplies the exact firing itemKey on its next line.
              pendingRangedKill = kill;
              queueMicrotask(() => {
                if (pendingRangedKill !== kill) return;
                pendingRangedKill = null;
                awardKill(rangedKey(), enemy, true);
              });
            } else awardKill(meleeKey(), enemy, false);
          }
          return result;
        };
        wrapped.__masteryPolicyWrapped = true;
        injected.damageCreature = wrapped;
      }
      if (typeof injected.awardWeaponMasteryXp === 'function') {
        injected.awardWeaponMasteryXp = () => { debug.suppressedLegacyCombatAwards++; return 0; };
      }
      if (Object.prototype.hasOwnProperty.call(injected, 'awardRangedMastery')) {
        injected.awardRangedMastery = itemKey => {
          const kill = pendingRangedKill;
          if (!kill || now() - kill.at > CONFIG.rangedKillLatchMs) { debug.suppressedLegacyCombatAwards++; return 0; }
          pendingRangedKill = null;
          return awardKill(itemKey || rangedKey(), kill.enemy, true);
        };
      }
      const result = originalInit(injected, ...rest);
      currentGear();
      return result;
    };
    if (originalUpdate) api.update = (...args) => { currentGear(); return originalUpdate(...args); };
    api.__masteryPolicyPatched = true;
  }

  function patchEquipment(api) {
    if (!api?.init || api.__masteryPolicyPatched) return;
    const originalInit = api.init.bind(api); // Used to capture the canonical gear getter and save hooks.
    api.init = function masteryPolicyEquipmentInit(injected = {}, ...rest) {
      equipmentDeps = injected;
      if (typeof injected.getGearInventory === 'function') gearGetter = injected.getGearInventory;
      if (typeof injected.devBumpToolMasteryLevel === 'function' && !injected.devBumpToolMasteryLevel.__masteryPolicyPermit) {
        const oldDevBump = injected.devBumpToolMasteryLevel; // Used to keep the existing dev mastery button working.
        const permitted = (...args) => withPermit(() => oldDevBump(...args));
        permitted.__masteryPolicyPermit = true;
        injected.devBumpToolMasteryLevel = permitted;
      }
      const result = originalInit(injected, ...rest);
      currentGear();
      return result;
    };
    api.__masteryPolicyPatched = true;
  }

  function patchCooking(api) {
    if (!api?.init || api.__masteryPolicyHostPatched) return;
    const originalInit = api.init.bind(api); // Used to capture ITEM_DEFS economy values.
    api.init = function masteryPolicyCookingInit(injected = {}, ...rest) { hostDeps = injected; return originalInit(injected, ...rest); };
    api.__masteryPolicyHostPatched = true;
  }

  function patchFishing(api) {
    if (!api?.init || api.__masteryPolicyQualityPatched) return;
    const originalInit = api.init.bind(api); // Used to capture the exact harvested item quality before farming XP is awarded.
    api.init = function masteryPolicyFishingInit(injected = {}, ...rest) {
      if (typeof injected.recordItemQuality === 'function' && !injected.recordItemQuality.__masteryPolicyWrapped) {
        const oldRecord = injected.recordItemQuality; // Used to preserve quality tracking while remembering the current harvest.
        const wrapped = function masteryPolicyRecordQuality(itemKey, stars, count, ...args) {
          lastQuality = { itemKey, stars: Math.max(1, Number(stars) || 1), count: Math.max(1, Number(count) || 1), at: now() };
          return oldRecord(itemKey, stars, count, ...args);
        };
        wrapped.__masteryPolicyWrapped = true;
        injected.recordItemQuality = wrapped;
      }
      return originalInit(injected, ...rest);
    };
    api.__masteryPolicyQualityPatched = true;
  }

  function cropKeyFromReason(reason) {
    const label = String(reason || '').replace(/^harvested\s+/i, '').trim();
    if (!label) return null;
    if (itemDefs()[label]) return label;
    const lower = label.toLowerCase();
    return Object.keys(itemDefs()).find(key => String(itemDefs()[key]?.label || '').toLowerCase() === lower) || null;
  }

  function patchSkillSystem(api) {
    if (!api?.award || api.__masteryPolicyPatched) return;
    const oldAward = api.award.bind(api); // Used to preserve normal Farming skill XP.
    api.award = function masteryPolicySkillAward(skillId, amount, reason, ...rest) {
      const result = oldAward(skillId, amount, reason, ...rest);
      if (String(skillId || '').toLowerCase() !== 'farming' || !/^harvested\s+/i.test(String(reason || ''))) return result;
      const recent = lastQuality && now() - lastQuality.at < 500 ? lastQuality : null; // Used to prefer the exact harvested itemKey over label matching.
      const cropKey = recent?.itemKey || cropKeyFromReason(reason);
      const hoeKey = slots().hoe;
      if (!cropKey || !hoeKey) return result;
      const count = recent?.count || 1;
      const stars = recent?.stars || 1;
      const worth = itemWorth(cropKey) * count * qualityMultiplier(stars);
      const amountXp = worthXp(worth);
      debug.lastHarvest = { cropKey, hoeKey, count, stars, worth: round1(worth), amount: amountXp, at: now() };
      award(hoeKey, amountXp, 'crop harvest', { cropKey, count, stars, yieldWorth: round1(worth) });
      return result;
    };
    api.__masteryPolicyPatched = true;
  }

  const treasureKey = (mapId, placement) => `${mapId}:${placement?.col},${placement?.row}`;
  function treasureWorth(loot = {}) {
    let worth = Math.max(0, Number(loot.gold) || 0); // Gold already uses the economy's value unit.
    for (const metalKey of loot.metalKeys || []) {
      const itemKey = treasureDeps?.metalBarItemKey?.(metalKey);
      const fallback = Math.max(1, Number(treasureDeps?.METAL_DEFS?.[metalKey]?.tier) || 1) * 8;
      worth += itemKey ? itemWorth(itemKey, fallback) : fallback;
    }
    for (const key of loot.dyeItemKeys || []) worth += itemWorth(key, 4);
    if (loot.potionKey) worth += itemWorth(loot.potionKey, 12);
    if (loot.recipeItemKey) worth += itemWorth(loot.recipeItemKey, 18);
    if (loot.clothing) worth += Math.max(1, firstFinite(loot.clothing.sellPrice, loot.clothing.price) || 1);
    return Math.max(1, worth);
  }
  function recordTreasure(mapId) {
    const persisted = treasureDeps?._zoneTreasurePersist?.get?.(mapId);
    const zone = treasureDeps?._zoneScenes?.get?.(mapId);
    if (!persisted || !zone) return;
    for (const placement of persisted.placements || []) {
      const dug = zone.grid?.[placement.row]?.[placement.col]?.type === treasureDeps.TileType?.TRENCH;
      treasureDugState.set(treasureKey(mapId, placement), !!dug);
    }
  }
  function detectTreasure(mapId) {
    const persisted = treasureDeps?._zoneTreasurePersist?.get?.(mapId);
    const zone = treasureDeps?._zoneScenes?.get?.(mapId);
    if (!persisted || !zone) return;
    for (const placement of persisted.placements || []) {
      const key = treasureKey(mapId, placement);
      const dug = zone.grid?.[placement.row]?.[placement.col]?.type === treasureDeps.TileType?.TRENCH;
      const wasDug = treasureDugState.get(key);
      treasureDugState.set(key, !!dug);
      if (wasDug !== false || !dug || placement.found || placement.masteryAwarded) continue;
      const shovelKey = slots().shovel;
      if (!shovelKey) continue;
      const worth = treasureWorth(placement.loot || {});
      const amountXp = worthXp(worth, CONFIG.shovelWorthRate);
      placement.masteryAwarded = true;
      debug.lastTreasure = { mapId, col: placement.col, row: placement.row, shovelKey, worth: round1(worth), amount: amountXp, at: now() };
      award(shovelKey, amountXp, 'buried treasure dig', { mapId, col: placement.col, row: placement.row, yieldWorth: round1(worth), worthRate: CONFIG.shovelWorthRate });
    }
  }

  function patchTreasure(api) {
    if (!api?.init || api.__masteryPolicyPatched) return;
    const oldInit = api.init.bind(api); // Used to capture canonical treasure registries.
    const oldEnsure = api.ensureZone?.bind(api); // Used to baseline already-dug saved chests without rewarding them.
    const oldSync = api.syncZoneInteractivity?.bind(api); // Used to detect the first successful dig exposure.
    api.init = function masteryPolicyTreasureInit(injected = {}, ...rest) { treasureDeps = injected; return oldInit(injected, ...rest); };
    if (oldEnsure) api.ensureZone = function masteryPolicyTreasureEnsure(mapId, ...rest) { const result = oldEnsure(mapId, ...rest); recordTreasure(mapId); return result; };
    if (oldSync) api.syncZoneInteractivity = function masteryPolicyTreasureSync(mapId, ...rest) { const result = oldSync(mapId, ...rest); detectTreasure(mapId); return result; };
    api.__masteryPolicyPatched = true;
  }

  function patchWorldPopup(api) {
    if (!api || api.__masteryPolicyPatched) return;
    const shouldBlock = kind => {
      if (kind !== 'masteryXp' || popupPermitDepth > 0) return false;
      if (now() - Number(debug.lastBlocked?.at || -Infinity) > 30) return false;
      debug.suppressedLegacyPopups++;
      return true;
    };
    if (api.showChange) {
      const old = api.showChange.bind(api); // Used to preserve all non-legacy mastery popup behavior.
      api.showChange = (kind, ...args) => shouldBlock(kind) ? null : old(kind, ...args);
    }
    if (api.queueReward) {
      const old = api.queueReward.bind(api); // Used to suppress queued legacy mastery rows after a blocked write.
      api.queueReward = (kind, ...args) => shouldBlock(kind) ? null : old(kind, ...args);
    }
    api.__masteryPolicyPatched = true;
  }

  function hook(globalName, marker, patcher) {
    if (window[globalName]) { patcher(window[globalName]); return; }
    const descriptor = Object.getOwnPropertyDescriptor(window, globalName); // Used to chain with other future-global compatibility hooks.
    if (descriptor && !descriptor.configurable) return;
    const previousGet = descriptor?.get; // Used to preserve prior lazy getters.
    const previousSet = descriptor?.set; // Used to preserve prior lazy setters.
    let value = descriptor?.value; // Used when no earlier accessor owns storage.
    Object.defineProperty(window, globalName, {
      configurable: true,
      get: () => previousGet ? previousGet.call(window) : value,
      set(next) {
        if (previousSet) previousSet.call(window, next); else value = next;
        const resolved = previousGet ? previousGet.call(window) : value;
        if (resolved && !resolved[marker]) patcher(resolved);
      },
    });
  }

  patchCombat(window.Combat);
  hook('EquipmentPanel', '__masteryPolicyPatched', patchEquipment);
  hook('CookingSystem', '__masteryPolicyHostPatched', patchCooking);
  hook('Fishing', '__masteryPolicyQualityPatched', patchFishing);
  hook('SkillSystem', '__masteryPolicyPatched', patchSkillSystem);
  hook('WildTreasure', '__masteryPolicyPatched', patchTreasure);
  hook('WorldPopupText', '__masteryPolicyPatched', patchWorldPopup);

  function arm() { armed = true; currentGear(); }
  function getDebug() {
    return {
      armed, blockedWrites: debug.blockedWrites,
      suppressedLegacyCombatAwards: debug.suppressedLegacyCombatAwards,
      suppressedLegacyPopups: debug.suppressedLegacyPopups,
      equipped: { hoe: slots().hoe || null, shovel: slots().shovel || null, weapon: meleeKey(), ranged: rangedKey() },
      lastBlocked: debug.lastBlocked ? { ...debug.lastBlocked } : null,
      lastAward: debug.lastAward ? { ...debug.lastAward } : null,
      lastKill: debug.lastKill ? { ...debug.lastKill } : null,
      lastHarvest: debug.lastHarvest ? { ...debug.lastHarvest } : null,
      lastTreasure: debug.lastTreasure ? { ...debug.lastTreasure } : null,
      lastDeathRecovery: debug.lastDeathRecovery ? { ...debug.lastDeathRecovery } : null,
      config: { ...CONFIG, thresholds: [...THRESHOLDS] },
    };
  }
  function formatDebug() {
    const state = getDebug();
    const awardText = state.lastAward ? `${state.lastAward.label} +${state.lastAward.amount} (${state.lastAward.reason})` : 'none';
    const blockedText = state.lastBlocked ? `${state.lastBlocked.itemKey} ${state.lastBlocked.before}→${state.lastBlocked.attempted}` : 'none';
    return `Mastery policy: ${state.armed ? 'armed' : 'booting'} | blocked ${state.blockedWrites} | last award ${awardText} | last blocked ${blockedText}`;
  }

  window.HobunjiMasteryPolicy = {
    getDebug, formatDebug, worthMasteryXp: worthXp, enemyDifficultyScore: enemyDifficulty, isPureCombatWeapon,
    _test: { awardMastery: award, guardGearInventory: guardGear, armPolicy: arm, treasureLootWorth: treasureWorth, detectTreasureDigTransitions: detectTreasure, recordTreasureStates: recordTreasure },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm, { once: true });
  else queueMicrotask(arm);
})();
