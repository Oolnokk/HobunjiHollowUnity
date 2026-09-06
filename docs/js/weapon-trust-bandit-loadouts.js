// Species-aware bandit loadouts for cultural weapons granted by trust dialogue.
//
// WeaponTrustVisits owns which shapes are trust gifts. This bridge keeps those
// shapes cultural at runtime: a bandit may only roll one when its species matches
// the NPC who grants that shape. Dual-role trust weapons are also added to that
// species' existing crossbow/scatterbow ranged roll using their real generated
// ranged definition, so future ranged-capable trust shapes work without another
// hardcoded shape list.
(function (global) {
  'use strict';

  const cfg = global.WEAPON_TRUST_VISIT_CONFIG;
  if (!cfg?.gifts?.length || !cfg?.bandits?.weaponShapePool?.length) return;

  let dialogueDeps = null; // Captures getNpcRecords; used to resolve each trust giver's current species instead of duplicating it in config.
  let banditDeps = null; // Captures BanditCombat's injected tool/metal helpers; used to rebuild a rolled bandit's concrete weapon keys and holders.
  let lastRoll = null; // Exposed through debugSnapshot so mobile testing can inspect the most recent cultural loadout decision without a console.
  const patchedApis = new WeakSet(); // Prevents double-wrapping singleton APIs during hot reloads.
  const culturalGifts = (cfg.gifts || []).filter(gift => gift?.npcId && gift?.shapeKey); // Drives every species restriction from the existing trust-gift data.
  const culturalShapeKeys = new Set(culturalGifts.map(gift => gift.shapeKey)); // Used to distinguish ordinary bandit shapes from culture-locked trust shapes.
  const configuredBanditShapes = new Set(cfg.bandits?.weaponShapePool || []); // Preserves the existing authoritative bandit melee pool/order.

  function npcRecords() {
    const records = dialogueDeps?.getNpcRecords?.();
    return Array.isArray(records) ? records : [];
  }

  function giverSpeciesId(gift) {
    const record = npcRecords().find(npc => npc?.id === gift?.npcId);
    return record?.appearance?.speciesId || null;
  }

  function culturalSpeciesByShape() {
    const out = {};
    for (const gift of culturalGifts) out[gift.shapeKey] = giverSpeciesId(gift);
    return out;
  }

  function culturalShapesForSpecies(speciesId) {
    if (!speciesId) return [];
    return culturalGifts
      .filter(gift => giverSpeciesId(gift) === speciesId)
      .map(gift => gift.shapeKey);
  }

  function allowedMeleeShapes(speciesId) {
    const culturalForSpecies = new Set(culturalShapesForSpecies(speciesId));
    const held = banditDeps?.HELD_SHAPE_DEFS || {};
    return [...configuredBanditShapes].filter(shapeKey => {
      if (!held[shapeKey]?.slots?.includes?.('weapon')) return false;
      return !culturalShapeKeys.has(shapeKey) || culturalForSpecies.has(shapeKey);
    });
  }

  function weightedPick(weights) {
    const entries = Object.entries(weights || {}).filter(([key, weight]) => !key.startsWith('_') && Number(weight) > 0);
    if (!entries.length) return null;
    const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
    let roll = (banditDeps?.rnd?.() ?? Math.random()) * total;
    for (const [key, weight] of entries) {
      roll -= Number(weight);
      if (roll <= 0) return key;
    }
    return entries[entries.length - 1][0];
  }

  function metalKeyFromWeaponKey(itemKey) {
    const known = new Set([
      ...(banditDeps?.VERDIGRIS_METAL_KEYS || []),
      ...Object.keys(banditDeps?.METAL_DEFS || {}),
    ]);
    return [...known]
      .sort((a, b) => String(b).length - String(a).length)
      .find(metalKey => String(itemKey || '').endsWith(`_${metalKey}`)) || null;
  }

  function makeHolder(scene, itemKey, name, visible) {
    const mesh = banditDeps?.makeToolPlaneMesh?.(itemKey);
    if (!mesh || !global.THREE?.Group || !scene?.add) return null;
    const holder = new global.THREE.Group();
    holder.name = name;
    holder.add(mesh);
    holder.visible = visible;
    scene.add(holder);
    return holder;
  }

  function replaceHolder(entity, field, itemKey, name, visible) {
    const old = entity?.[field];
    const holder = makeHolder(entity?.scene, itemKey, name, visible);
    if (!holder) return false;
    old?.parent?.remove?.(old);
    entity[field] = holder;
    return true;
  }

  function applyMeleeRoll(entity, speciesId, metalKey, opts) {
    const allowed = allowedMeleeShapes(speciesId);
    const originalKey = entity?.def?.weaponKey || null;
    const originalShape = banditDeps?.TOOL_ITEM_DEFS?.[originalKey]?.shapeKey
      || [...configuredBanditShapes].find(shapeKey => originalKey?.startsWith?.(`${shapeKey}_`))
      || null;

    if (opts?.defOverride && Object.prototype.hasOwnProperty.call(opts.defOverride, 'weaponKey')) {
      return { originalKey, finalKey: originalKey, originalShape, finalShape: originalShape, allowed, overridden: true };
    }
    if (!allowed.length || !metalKey || !entity?.def) {
      return { originalKey, finalKey: originalKey, originalShape, finalShape: originalShape, allowed, skipped: true };
    }

    // Re-roll the complete species-valid pool. This keeps equal shape probability
    // exactly as the existing bandit selector intended instead of biasing whichever
    // valid shape happened to survive an initial global roll.
    const finalShape = allowed[Math.floor((banditDeps?.rnd?.() ?? Math.random()) * allowed.length)];
    const shapeDef = banditDeps.HELD_SHAPE_DEFS?.[finalShape];
    const finalKey = banditDeps.craftedToolItemKey?.(finalShape, metalKey) || `${finalShape}_${metalKey}`;
    if (finalKey !== originalKey && !replaceHolder(entity, '_banditToolHolder', finalKey, 'banditToolHolder', !entity._rangedMode)) {
      global.__farmLog?.(`[bandits] cultural melee holder failed for ${finalKey}; keeping ${originalKey || 'none'}.`, 'warn');
      return { originalKey, finalKey: originalKey, originalShape, finalShape: originalShape, allowed, holderFailed: true };
    }
    entity.def.weaponKey = finalKey;
    entity.def.attackTag = shapeDef?.dmgType || 'sharp';
    const naturalStyle = shapeDef?.comboStyle || shapeDef?.animStyle;
    if (entity.def.banditAbilityLoadout) entity.def.banditAbilityLoadout.tap1 = naturalStyle === 'thrust' ? 'pokeCombo' : 'swingCombo';
    const isSweep = (banditDeps.TOOL_ITEM_DEFS?.[finalKey]?.animStyle || shapeDef?.animStyle) === 'sweep';
    entity._banditSwingAnim = isSweep ? 'sweep' : 'thrust';
    entity._banditSwingPose = isSweep ? global.Combat?.poses?.SWEEP_POSE : null;
    entity._banditSwingDirSign = 1;
    entity._banditSwingPower = 1;
    entity.banditWeaponMeshAttached = !!entity._banditToolHolder;
    return { originalKey, finalKey, originalShape, finalShape, allowed, overridden: false };
  }

  function culturalRangedWeights(gangCfg, rank, speciesId, metalKey) {
    const weights = { ...(gangCfg?.rangedWeaponWeightsByRank?.[rank] || {}) };
    const baseCulturalWeight = Number(gangCfg?.culturalRangedWeightByRank?.[rank]
      ?? gangCfg?.culturalRangedWeight
      ?? weights.scatterbow
      ?? 1);

    // Generated dual-role item definitions are patched into RangedWeapons.config.
    // Calling the existing patcher here makes the capability check resilient to
    // script timing and means this bridge never needs a second Kylie/B'shuakauitl list.
    global.HobunjiRangedWeaponArchetypes?.patchGeneratedDefinitions?.();
    for (const shapeKey of culturalShapesForSpecies(speciesId)) {
      if (!metalKey) continue;
      const itemKey = banditDeps?.craftedToolItemKey?.(shapeKey, metalKey) || `${shapeKey}_${metalKey}`;
      if (!global.RangedWeapons?.config?.[itemKey]) continue;
      weights[itemKey] = Math.max(0, Number.isFinite(baseCulturalWeight) ? baseCulturalWeight : 1);
    }
    return weights;
  }

  function applyRangedRoll(entity, gangCfg, rank, speciesId, metalKey, opts) {
    const originalKey = entity?.def?.rangedWeaponKey || null;
    if (opts?.defOverride && Object.prototype.hasOwnProperty.call(opts.defOverride, 'rangedWeaponKey')) {
      return { originalKey, finalKey: originalKey, weights: null, overridden: true };
    }
    // The base BanditCombat roll already decided whether this rank receives a
    // ranged weapon. Preserve that chance exactly; only widen the weapon choice
    // after a successful ranged roll.
    if (!originalKey || !entity?.def) return { originalKey, finalKey: originalKey, weights: null, skipped: true };

    const weights = culturalRangedWeights(gangCfg, rank, speciesId, metalKey);
    const pickedKey = weightedPick(weights) || originalKey;
    let finalKey = pickedKey;
    if (pickedKey !== originalKey && !replaceHolder(entity, '_banditRangedToolHolder', pickedKey, 'banditRangedToolHolder', !!entity._rangedMode)) {
      global.__farmLog?.(`[bandits] cultural ranged holder failed for ${pickedKey}; keeping ${originalKey}.`, 'warn');
      finalKey = originalKey;
    }
    if (finalKey !== originalKey) global.RangedWeapons?.setLoaded?.(originalKey, false, entity);
    entity.def.rangedWeaponKey = finalKey;
    global.RangedWeapons?.setLoaded?.(finalKey, true, entity);
    return { originalKey, pickedKey, finalKey, weights, overridden: false };
  }

  function applyCulturalLoadout(entity, gangCfg, rank, opts) {
    if (!entity?.isBandit || !entity?.def) return entity;
    const speciesId = entity.rosterRecord?.appearance?.speciesId || null;
    const metalKey = metalKeyFromWeaponKey(entity.def.weaponKey);
    const melee = applyMeleeRoll(entity, speciesId, metalKey, opts);
    const ranged = applyRangedRoll(entity, gangCfg, rank, speciesId, metalKey, opts);
    const speciesByShape = culturalSpeciesByShape();
    const unresolvedGivers = culturalGifts
      .filter(gift => !speciesByShape[gift.shapeKey])
      .map(gift => gift.npcId);

    lastRoll = {
      banditId: entity.id || null,
      speciesId,
      rank: rank || entity.banditRank || null,
      metalKey,
      culturalSpeciesByShape: speciesByShape,
      unresolvedGivers,
      melee,
      ranged,
    };
    entity._weaponTrustCulturalLoadout = lastRoll;

    const finalMeleeCultural = culturalShapeKeys.has(melee.finalShape);
    const finalRangedCultural = !!ranged.finalKey && !['crossbow', 'scatterbow'].includes(ranged.finalKey);
    if (finalMeleeCultural || finalRangedCultural) {
      global.__farmLog?.(`[bandits] cultural loadout ${speciesId || 'unknown'}: melee=${melee.finalKey || 'none'} ranged=${ranged.finalKey || 'none'}`, 'wildlife');
    }
    return entity;
  }

  function patchDialogueContent(api) {
    if (!api || patchedApis.has(api)) return;
    patchedApis.add(api);
    const originalInit = api.init?.bind(api);
    if (!originalInit) return;
    api.init = function weaponTrustBanditDialogueInit(injectedDeps) {
      dialogueDeps = injectedDeps;
      return originalInit(injectedDeps);
    };
  }

  function patchBanditCombat(api) {
    if (!api || patchedApis.has(api)) return;
    patchedApis.add(api);
    const originalInit = api.init?.bind(api);
    if (originalInit) api.init = function weaponTrustBanditLoadoutInit(injectedDeps) {
      banditDeps = injectedDeps;
      return originalInit(injectedDeps);
    };
    const originalMakeEntity = api.makeEntity?.bind(api);
    if (originalMakeEntity) api.makeEntity = async function weaponTrustSpeciesBanditEntity(gangCfg, rank, tier, x, y, opts = {}) {
      const entity = await originalMakeEntity(gangCfg, rank, tier, x, y, opts);
      return applyCulturalLoadout(entity, gangCfg, rank, opts);
    };
  }

  function patchApiWhenAssigned(name, patcher) {
    const existing = global[name];
    if (existing) { patcher(existing); return; }
    const descriptor = Object.getOwnPropertyDescriptor(global, name);
    if (descriptor && descriptor.configurable === false) return;
    // WeaponTrustVisits installs the same future-singleton hook first. Chain an
    // existing setter instead of replacing it, otherwise this module would
    // accidentally disable the trust runtime's own BanditCombat/DialogueContent
    // integration simply because both features wait for the same singleton.
    if (typeof descriptor?.set === 'function') {
      const upstreamSet = descriptor.set;
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: descriptor.enumerable ?? true,
        get() { return descriptor.get ? descriptor.get.call(global) : undefined; },
        set(value) {
          upstreamSet.call(global, value);
          patcher(global[name] || value);
        },
      });
      return;
    }
    let stored = descriptor?.get ? descriptor.get.call(global) : descriptor?.value;
    Object.defineProperty(global, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return stored; },
      set(value) {
        stored = value;
        patcher(value);
        Object.defineProperty(global, name, { value: stored, writable: true, configurable: true, enumerable: true });
      },
    });
  }

  global.WeaponTrustBanditLoadouts = Object.freeze({
    version: 1,
    giverSpeciesId,
    culturalShapesForSpecies,
    allowedMeleeShapes,
    applyCulturalLoadout,
    debugSnapshot() {
      return {
        culturalSpeciesByShape: culturalSpeciesByShape(),
        configuredBanditShapes: [...configuredBanditShapes],
        lastRoll,
      };
    },
  });
  global.__weaponTrustBanditLoadoutDebug = global.WeaponTrustBanditLoadouts;

  patchApiWhenAssigned('DialogueContent', patchDialogueContent);
  patchApiWhenAssigned('BanditCombat', patchBanditCombat);
})(window);
