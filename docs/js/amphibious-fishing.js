// Amphibious fish: water-only fishing rolls, post-reel creature fights, Fish Leap,
// Scent-marked Health, and exact-fish corpse retrieval.
(() => {
  'use strict';

  const WATER_TILE_TYPES = new Set(['river', 'stream', 'waterfall']); // Used to decide whether amphibious species are eligible for the next cast.
  const GURUMAHI_KIND = 'gurumahi'; // Used as the shared combat-form species key for all Gurumahi color variants.
  const SCENT_RECOVERY_MULTIPLIER = 0.2; // Used to make Scent-marked Health recover at one fifth the normal affliction rate.
  const FISH_LEAP_WINDUP_S = 0.25; // Used as the twice-as-fast version of Pounce's 0.5 second windup.
  const FISH_LEAP_UNCROUCH_S = 0.1; // Used to preserve Pounce's short release beat before launch.
  const FISH_LEAP_CROUCH_SCALE_Y = 0.55; // Used to preserve Pounce's crouch silhouette.
  const FISH_LEAP_SPEED_PX_S = 480; // Used to preserve Pounce's actual launch speed while increasing distance instead.
  const FISH_LEAP_DISTANCE_MULTIPLIER = 1.5; // Used to make Fish Leap travel 150% as far as Pounce.
  const FISH_LEAP_KNOCKBACK_PX_S = 640; // Used to preserve Pounce's hit force.
  const FISH_LEAP_WOUNDED_MULTIPLIER = 0.45; // Used to build Wounded Health from a Gurumahi leap hit.
  const FISH_LEAP_SCENT_MULTIPLIER = 0.55; // Used to build Scent-marked Health from a Gurumahi leap hit.

  let fishingDeps = null; // Used for player water checks, inventory correction, and fishing UI state.
  let wildlifeDeps = null; // Used to register/spawn the Gurumahi combat form into the normal creature runtime.
  let deathDeps = null; // Used to remove a retrieved amphibious corpse through the ordinary corpse registry/despawner.
  let previousFishingState = null; // Used to detect the one active->caught transition that starts an amphibious fight.
  let previousFishingPhase = null; // Used with previousFishingState to avoid spawning the same caught fish twice.
  let resourceRulesInstalled = false; // Used to make the ResourceSystem patch idempotent.
  let fishLeapInstalled = false; // Used to make the named attack registration idempotent.
  const liveAmphibiousCreatures = new Set(); // Used by mobile diagnostics and cleanup bookkeeping for reeled-in combat fish.

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function playerTile() {
    const mesh = fishingDeps?.playerMesh; // Used as the tile-space source of truth already shared by fishing frenzy placement.
    if (!mesh?.position || !fishingDeps?.getActiveTileAt) return null;
    const col = Math.floor(mesh.position.x);
    const row = Math.floor(mesh.position.z);
    try { return { col, row, tile: fishingDeps.getActiveTileAt(col, row) || null }; }
    catch (_) { return null; }
  }

  function playerInWater() {
    const here = playerTile();
    if (!here?.tile) return false;
    const type = String(here.tile.type ?? '').toLowerCase();
    if (WATER_TILE_TYPES.has(type)) return true;
    // Farm trenches use dynamic water rather than the permanent river/stream tile ids.
    // Treat only visibly wet trenches as standing in water, not an empty dug channel.
    if (type === 'trench') {
      const amount = Number(here.tile.water ?? here.tile.waterAmount ?? here.tile.waterLevel ?? here.tile.waterDepth ?? 0);
      return amount > 0.05;
    }
    return false;
  }

  function wrapInitApi(api, marker, capture, afterCapture) {
    if (!api?.init || api[marker]) return api;
    const originalInit = api.init;
    api.init = injectedDeps => {
      capture(injectedDeps);
      afterCapture?.(injectedDeps);
      return originalInit.call(api, injectedDeps);
    };
    Object.defineProperty(api, marker, { value: true, configurable: true });
    return api;
  }

  function hookWindowApi(name, wrap) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor?.get && descriptor?.set && descriptor.configurable) {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: () => descriptor.get.call(window),
        set: value => {
          descriptor.set.call(window, value);
          wrap(descriptor.get.call(window));
        },
      });
      wrap(descriptor.get.call(window));
      return;
    }
    if (!descriptor || descriptor.configurable) {
      let current = wrap(window[name]);
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: () => current,
        set: value => { current = wrap(value); },
      });
      return;
    }
    wrap(window[name]);
  }

  function ensureGurumahiCreatureDef() {
    const deps = wildlifeDeps;
    if (!deps?.CREATURE_DB || !deps?.TILE) return false;
    if (deps.CREATURE_DB[GURUMAHI_KIND]?.amphibiousFish) return true;
    const T = deps.TILE;
    deps.CREATURE_DB[GURUMAHI_KIND] = {
      label: 'Gurumahi', hostile: true, amphibiousFish: true,
      maxHealth: 48, maxStamina: 50,
      // Deliberately lumbering outside the leap: the fish's threat comes from explosive commitment, not pursuit speed.
      moveSpeed: 45, chaseSpeed: 70,
      attackDamage: 12, attackRangePx: T * 0.9, attackHalfConeRad: 44 * Math.PI / 180,
      attackStaminaCost: 12, attackCooldownS: 1.1,
      attacks: ['fishLeap'], attackTag: 'amphibiousFish',
      behaviorStages: ['pounceAttempt', 'evasiveOrbit'],
      aggroRangePx: T * 7, leashRangePx: T * 12,
      canClimb: false, canSwim: true,
      modelWidth: 2.2, spriteAspect: 1.6, lungeHeightUnits: 0.8, tint: 0xffffff,
      defaultSizeClass: 'medium',
      sprites: {
        idle: 'assets/objectsprites/fish_gurumahi.png',
        run: ['assets/objectsprites/fish_gurumahi.png', 'assets/objectsprites/fish_gurumahi.png'],
      },
      // Amphibious catches use a custom Retrieve interaction, not an ordinary butcher table.
      lootPool: null,
    };
    window.__farmLog?.('[amphibious-fishing] registered Gurumahi combat form', 'fish');
    return true;
  }

  function fishLeapAdditionalStaminaCost(c) {
    const maxStamina = Math.max(0, Number(c?.maxStamina) || 0);
    const genericCost = Math.max(0, Number(c?.def?.attackStaminaCost) || 0); // Already paid by the shared creature attack trigger.
    const normalPounceTotal = Math.max(18, maxStamina * 0.4); // Mirrors Pounce's current total-cost rule.
    const fishLeapTotal = normalPounceTotal * 2; // User rule: Fish Leap costs twice as much Stamina as Pounce.
    return Math.max(0, fishLeapTotal - genericCost);
  }

  function gatherFishLeapTargets(c, deps) {
    const out = [];
    if (c.isCompanion) {
      for (const hostile of deps.hostileObjects || []) {
        if (hostile.health > 0 && hostile.areaId === c.areaId) out.push({ isPlayer: false, ref: hostile });
      }
      return out;
    }
    for (const player of deps.players || [deps.player]) if (player) out.push({ isPlayer: true, ref: player });
    for (const companion of deps.companionObjects || []) {
      if (companion.health > 0 && companion.areaId === c.areaId) out.push({ isPlayer: false, ref: companion });
    }
    return out;
  }

  function fishLeapStart(c, state, ctx, deps) {
    state.stage = 'windup';
    state.t = 0;
    state.angle = Math.atan2(ctx.target.y - c.y, ctx.target.x - c.x);
    state.aimPitch = window.Combat?.meleeAimSolution?.(c, ctx.target, state.angle, 0)?.pitch || 0;
    state.targets = gatherFishLeapTargets(c, deps);
    state.rangePx = c.def.attackRangePx;
    state.halfConeRad = c.def.attackHalfConeRad;
    state.damage = c.def.attackDamage; // Same damage as the species' normal Pounce-equivalent hit.
    const baseLungeDistancePx = Math.max(
      state.rangePx,
      Math.hypot((ctx.target?.x ?? c.x) - c.x, (ctx.target?.y ?? c.y) - c.y),
    );
    state.lungeProfile = window.Combat?.meleeLungeProfile?.(
      baseLungeDistancePx,
      state.aimPitch,
      0,
      c.def.lungeHeightUnits ?? 1,
    ) || { distancePx: baseLungeDistancePx, hopUnits: 0, pitch: state.aimPitch };
    state.maxDistancePx = Math.max(0, state.lungeProfile.distancePx * FISH_LEAP_DISTANCE_MULTIPLIER);
    state.traveledPx = 0;
    state.collideRadiusPx = deps.TILE * 0.32;
    c.facing = state.angle;
    c.scaleY = 1;
    c._banditLungeHopCurrent = 0;
  }

  function fishLeapUpdate(c, state, dt, deps) {
    state.t += dt;
    if (state.stage === 'windup') {
      const t = Math.min(1, state.t / FISH_LEAP_WINDUP_S);
      const eased = 1 - Math.pow(1 - t, 3);
      c.scaleY = 1 - (1 - FISH_LEAP_CROUCH_SCALE_Y) * eased;
      if (t >= 1) { state.stage = 'uncrouch'; state.t = 0; }
      return true;
    }
    if (state.stage === 'uncrouch') {
      const t = Math.min(1, state.t / FISH_LEAP_UNCROUCH_S);
      const eased = 1 - Math.pow(1 - t, 3);
      c.scaleY = FISH_LEAP_CROUCH_SCALE_Y + (1 - FISH_LEAP_CROUCH_SCALE_Y) * eased;
      if (t >= 1) {
        c.scaleY = 1;
        state.stage = 'leap';
        state.t = 0;
        const frameUrl = c.def.sprites?.run?.[0];
        if (frameUrl) {
          const genotypeKind = deps.genotypeKindFor ? deps.genotypeKindFor(c) : null;
          deps.setCreatureFrame?.(c.avatarRef, frameUrl, genotypeKind, 'run1', c.genotype);
          c.currentFrameUrl = frameUrl;
        }
      }
      return true;
    }

    const dirX = Math.cos(state.angle), dirY = Math.sin(state.angle);
    const remainingPx = Math.max(0, state.maxDistancePx - state.traveledPx);
    if (remainingPx <= 0.001) { c._banditLungeHopCurrent = 0; return false; }
    const stepPx = Math.min(FISH_LEAP_SPEED_PX_S * dt, remainingPx);
    const nx = c.x + dirX * stepPx, ny = c.y + dirY * stepPx;
    if (!deps.canOccupyAt(nx, ny, state.collideRadiusPx)) { c._banditLungeHopCurrent = 0; return false; }
    c.x = nx;
    c.y = ny;
    state.traveledPx += stepPx;
    const leapProgress = state.maxDistancePx > 0.001 ? state.traveledPx / state.maxDistancePx : 1;
    c._banditLungeHopCurrent = (state.lungeProfile.hopUnits || 0) * Math.sin(Math.min(1, leapProgress) * Math.PI);
    deps.tickCreatureFootsteps?.(c, stepPx);
    const afflictionBonuses = {
      woundedHealth: FISH_LEAP_WOUNDED_MULTIPLIER,
      scentMarkedHealth: FISH_LEAP_SCENT_MULTIPLIER,
    };
    deps.tickCreatureLungeTrail?.(c, stepPx, afflictionBonuses);

    for (const target of state.targets) {
      const ref = target.ref;
      if (!ref || ref.health <= 0) continue;
      const hit = window.Combat?.meleeHit
        ? window.Combat.meleeHit(c, ref, {
            rangePx: state.rangePx,
            halfConeRad: state.halfConeRad,
            yaw: state.angle,
            pitch: state.aimPitch,
          })
        : deps.inCone(c.x, c.y, state.angle, ref.x, ref.y, state.rangePx, state.halfConeRad);
      if (!hit) continue;
      const damageOpts = { tag: 'amphibiousFish', afflictionBonuses, amphibiousFish: true };
      if (target.isPlayer) deps.damagePlayer(state.damage, c.x, c.y, FISH_LEAP_KNOCKBACK_PX_S, damageOpts);
      else deps.damageCreature(ref, state.damage, c.x, c.y, FISH_LEAP_KNOCKBACK_PX_S, damageOpts);
      deps.playCreatureClawHit?.(c);
      return false;
    }
    return true;
  }

  function fishLeapCancel(c) {
    c.scaleY = 1;
    c._banditLungeHopCurrent = 0;
  }

  function installFishLeap() {
    const attacks = window.Combat?.animalAttacks;
    if (fishLeapInstalled || !attacks?.register) return false;
    attacks.register('fishLeap', {
      label: 'Fish Leap',
      start: fishLeapStart,
      update: fishLeapUpdate,
      cancel: fishLeapCancel,
      additionalStaminaCost: fishLeapAdditionalStaminaCost,
      isStriking: state => state?.stage === 'leap',
    });
    fishLeapInstalled = true;
    window.__farmLog?.('[amphibious-fishing] registered Fish Leap (1.5x Pounce distance, 0.5x windup, 2x stamina)', 'combat');
    return true;
  }

  function enforceWoundedHealthCap(entity, RS) {
    const wounded = Math.max(0, RS.getAffliction(entity, 'woundedHealth') || 0); // Used as recoverable unavailable Health after Gurumahi hits.
    if (!(wounded > 0) || !Number.isFinite(entity?.maxHealth)) return;
    const cap = Math.max(0, entity.maxHealth - wounded);
    if (entity.health > cap) entity.health = Math.round(cap * 10) / 10;
  }

  function installResourceRules() {
    const RS = window.ResourceSystem;
    if (resourceRulesInstalled || !RS?.AFFLICTIONS || !RS?.applyDamage || !RS?.tick) return false;
    RS.AFFLICTIONS.woundedHealth ||= {
      name: 'Wounded Health', resource: 'health', extend: 'zero', priority: 58, recovers: true,
      family: 'damage', tags: ['physical', 'amphibious'],
      desc: 'Temporarily locks away part of maximum Health; it returns as the wound recovers.'
    };
    RS.AFFLICTIONS.scentMarkedHealth ||= {
      name: 'Scent-marked Health', resource: 'health', extend: 'currentBack', priority: 61, recovers: false,
      family: 'offensiveDebuff', tags: ['scent', 'amphibious'],
      desc: 'Amphibious fish attacks consume the mark for bonus damage. The scent fades slowly on its own.'
    };

    const originalApplyDamage = RS.applyDamage.bind(RS);
    const originalTick = RS.tick.bind(RS);
    const originalGetEffectiveMax = RS.getEffectiveMax.bind(RS);
    const originalEnforceCaps = RS.enforceCaps.bind(RS);

    RS.applyDamage = (entity, amount, opts = {}) => {
      if (!opts?.amphibiousFish) return originalApplyDamage(entity, amount, opts);
      const baseAmount = Math.max(0, Number(amount) || 0); // Used so new affliction buildup is based on the attack itself, not the scent bonus it consumed.
      const scent = Math.max(0, RS.getAffliction(entity, 'scentMarkedHealth') || 0);
      const scentBonus = Math.min(scent, baseAmount); // Mirrors Bruised Health's cap: bonus damage can at most double this hit.
      if (scentBonus > 0) RS.removeAffliction(entity, 'scentMarkedHealth', scentBonus);
      const bonuses = opts.afflictionBonuses || null;
      const cleanOpts = { ...opts, afflictionBonuses: null };
      const before = entity.health;
      originalApplyDamage(entity, baseAmount + scentBonus, cleanOpts);
      if (bonuses) {
        for (const [id, multiplier] of Object.entries(bonuses)) {
          if (RS.AFFLICTIONS[id] && multiplier > 0) RS.addAffliction(entity, id, baseAmount * multiplier);
        }
      }
      enforceWoundedHealthCap(entity, RS);
      return Math.max(0, Math.round((before - entity.health) * 10) / 10);
    };

    RS.tick = (entity, dt, opts = {}) => {
      const result = originalTick(entity, dt, opts);
      const scent = RS.getAffliction(entity, 'scentMarkedHealth');
      if (scent > 0) {
        const cfg = RS.config();
        const rest = RS.getRestInfo(entity, cfg);
        const rate = cfg.afflictionRecoveryPerSec * SCENT_RECOVERY_MULTIPLIER * (rest.rested ? 2 : 1); // Used to fade scent slowly, with the existing rested recovery bonus intact.
        RS.removeAffliction(entity, 'scentMarkedHealth', rate * dt);
      }
      enforceWoundedHealthCap(entity, RS);
      return result;
    };

    RS.getEffectiveMax = (entity, key) => {
      const base = originalGetEffectiveMax(entity, key);
      if (key !== 'health') return base;
      return Math.max(0, base - (RS.getAffliction(entity, 'woundedHealth') || 0));
    };

    RS.enforceCaps = entity => {
      originalEnforceCaps(entity);
      enforceWoundedHealthCap(entity, RS);
    };

    resourceRulesInstalled = true;
    window.__farmLog?.('[amphibious-fishing] installed Wounded Health + slow Scent-marked Health rules', 'combat');
    return true;
  }

  function makeAmphibiousCorpseWorldObject(c) {
    const key = c?._amphibiousFishItemKey;
    const label = c?._amphibiousFishLabel || window.FishCatalog?.get?.(key)?.label || 'amphibious fish';
    const stars = clamp(Math.round(Number(c?._amphibiousFishStars) || 3), 1, 5);
    return {
      id: 'corpse_' + c.id,
      type: 'amphibious_fish_corpse',
      promptRoot: c.avatarRef?.group || null,
      getButtons() {
        return [{ icon: '🐟', label: 'Retrieve ' + label, action: 'obj_loot_corpse', style: 'primary', allowed: true }];
      },
      onAction(action) {
        if (action !== 'obj_loot_corpse') return { ok: false, message: 'Unknown action.' };
        if (!key || !fishingDeps?.inventory) return { ok: false, message: 'The fish could not be retrieved.' };
        fishingDeps.inventory[key] = Math.min(99, (fishingDeps.inventory[key] || 0) + 1);
        window.CookingSystem?.recordItemQuality?.(key, stars, 1);
        deathDeps?.corpseObjects?.delete?.(c);
        deathDeps?.despawnCreature?.(c);
        liveAmphibiousCreatures.delete(c);
        fishingDeps.refreshActionBar?.();
        return { ok: true, message: `Retrieved ${stars}★ ${label}.` };
      },
    };
  }

  function wrapBanditCamps(api) {
    if (!api?.makeCorpseWorldObject || api.__amphibiousFishCorpseWrapped) return api;
    const original = api.makeCorpseWorldObject;
    api.makeCorpseWorldObject = c => c?.isAmphibiousFishCorpse ? makeAmphibiousCorpseWorldObject(c) : original.call(api, c);
    Object.defineProperty(api, '__amphibiousFishCorpseWrapped', { value: true, configurable: true });
    return api;
  }

  function wrapCreatureDeath(api) {
    if (!api?.init || api.__amphibiousFishDeathWrapped) return api;
    const originalInit = api.init;
    const originalBegin = api.begin;
    api.init = injectedDeps => {
      deathDeps = injectedDeps;
      return originalInit.call(api, injectedDeps);
    };
    if (typeof originalBegin === 'function') {
      api.begin = (c, ...args) => {
        if (c?._amphibiousFishItemKey) {
          // makeCorpseWorldObject's existing bandit branch is a narrow seam that lets this corpse use a custom Retrieve action.
          // This flag is set only after lethal damage removed the creature from live hostile AI, so it never gains bandit behavior.
          c.isBandit = true;
          c.isAmphibiousFishCorpse = true;
        }
        return originalBegin.call(api, c, ...args);
      };
    }
    Object.defineProperty(api, '__amphibiousFishDeathWrapped', { value: true, configurable: true });
    return api;
  }

  function wrapWildlifeSpawn(api) {
    return wrapInitApi(api, '__amphibiousFishSpawnWrapped', deps => { wildlifeDeps = deps; }, () => ensureGurumahiCreatureDef());
  }

  function spawnAmphibiousCatch(catchInfo) {
    if (!ensureGurumahiCreatureDef() || !wildlifeDeps?.makeCreatureEntity || !wildlifeDeps?.hostileObjects) return null;
    const T = wildlifeDeps.TILE;
    const x = (catchInfo.col + 0.5) * T;
    const y = (catchInfo.row + 0.5) * T;
    const creature = wildlifeDeps.makeCreatureEntity(GURUMAHI_KIND, x, y, {
      homeX: x, homeY: y, state: 'chasing',
    });
    if (!creature) return null;
    creature.state = 'chasing';
    creature.homeX = x; creature.homeY = y;
    creature._amphibiousFishItemKey = catchInfo.key;
    creature._amphibiousFishLabel = catchInfo.label;
    creature._amphibiousFishStars = catchInfo.stars;
    creature._amphibiousFishedTile = { col: catchInfo.col, row: catchInfo.row };
    wildlifeDeps.hostileObjects.add(creature);
    liveAmphibiousCreatures.add(creature);
    window.__farmLog?.(`[amphibious-fishing] ${catchInfo.label} became combat creature #${creature.id} at ${catchInfo.col},${catchInfo.row}`, 'fish');
    return creature;
  }

  function restoreFailedCatch(catchInfo) {
    if (!catchInfo?.key || !fishingDeps?.inventory) return;
    fishingDeps.inventory[catchInfo.key] = Math.min(99, (fishingDeps.inventory[catchInfo.key] || 0) + 1);
    window.CookingSystem?.recordItemQuality?.(catchInfo.key, catchInfo.stars, 1);
    fishingDeps.showToast?.(`${catchInfo.label} could not enter combat; the catch was returned to your bag.`, false);
  }

  function beginAmphibiousFight(state) {
    const fishDef = state?.fishDef;
    if (!fishDef?.amphibious || !state._amphibiousStartedInWater) return false;
    const key = fishDef.key;
    const anchor = state.anchorWorld;
    if (!key || !anchor) return false;
    const quality = state._amphibiousPendingQuality || { stars: 3, amount: 1 };
    const catchInfo = {
      key,
      label: fishDef.label || window.FishCatalog?.get?.(key)?.label || key,
      stars: clamp(Math.round(Number(quality.stars) || 3), 1, 5),
      col: Math.floor(anchor.x),
      row: Math.floor(anchor.z),
    };
    // The core fishing catch has already incremented the stack before opening its caught view.
    // Remove that provisional unit: the player only truly owns it after killing and retrieving the creature form.
    fishingDeps.inventory[key] = Math.max(0, (fishingDeps.inventory[key] || 0) - 1);
    window.Fishing?.close?.();
    const creature = spawnAmphibiousCatch(catchInfo);
    if (!creature) {
      restoreFailedCatch(catchInfo);
      return false;
    }
    fishingDeps.showToast?.(`${catchInfo.label} hauled itself out of the water — fight it to claim the fish!`, false);
    return true;
  }

  function wrapFishingApi(api) {
    if (!api?.init || api.__amphibiousFishingWrapped) return api;
    const originalInit = api.init;
    const originalBeginCast = api.beginCast;
    api.init = injectedDeps => {
      const originalRecordItemQuality = injectedDeps?.recordItemQuality;
      const decorated = {
        ...(injectedDeps || {}),
        recordItemQuality: (key, stars, amount = 1) => {
          const state = api.state;
          if (state?.fishDef?.amphibious && state._amphibiousStartedInWater) {
            state._amphibiousPendingQuality = { key, stars, amount }; // Used to transfer fishing quality onto the eventual corpse retrieval instead of the provisional catch.
            return;
          }
          return originalRecordItemQuality?.(key, stars, amount);
        },
      };
      fishingDeps = decorated;
      return originalInit.call(api, decorated);
    };
    if (typeof originalBeginCast === 'function') {
      api.beginCast = (...args) => {
        const startedInWater = playerInWater();
        const result = originalBeginCast.apply(api, args);
        const state = api.state;
        if (state) {
          state._amphibiousStartedInWater = startedInWater; // Used to preserve eligibility even if the player moves before landing the fish.
          state._amphibiousPendingQuality = null;
        }
        return result;
      };
    }
    Object.defineProperty(api, '__amphibiousFishingWrapped', { value: true, configurable: true });
    return api;
  }

  function featureLoop() {
    installResourceRules();
    installFishLeap();
    ensureGurumahiCreatureDef();
    wrapBanditCamps(window.BanditCamps);

    const state = window.Fishing?.state || null;
    if (previousFishingPhase === 'active' && state?.phase === 'caught' && state.fishDef?.amphibious) {
      beginAmphibiousFight(state);
    }
    if (previousFishingState && !state) previousFishingPhase = null;
    else previousFishingPhase = state?.phase || null;
    previousFishingState = state;

    for (const creature of [...liveAmphibiousCreatures]) {
      if (!creature || (creature.state === 'corpse' && !deathDeps?.corpseObjects?.has?.(creature))) liveAmphibiousCreatures.delete(creature);
    }
    requestAnimationFrame(featureLoop);
  }

  window.AmphibiousFishing = {
    playerInWater,
    isAmphibiousFish: key => !!window.FishCatalog?.get?.(key)?.amphibious,
    getDebug: () => ({
      playerInWater: playerInWater(),
      playerTile: playerTile() ? { col: playerTile().col, row: playerTile().row, type: String(playerTile().tile?.type || '') } : null,
      resourceRulesInstalled,
      fishLeapInstalled,
      creatureDefInstalled: !!wildlifeDeps?.CREATURE_DB?.[GURUMAHI_KIND],
      liveCreatures: [...liveAmphibiousCreatures].map(c => ({ id: c.id, state: c.state, key: c._amphibiousFishItemKey, health: c.health, stamina: c.stamina })),
    }),
  };

  hookWindowApi('Fishing', wrapFishingApi);
  hookWindowApi('WildlifeSpawn', wrapWildlifeSpawn);
  hookWindowApi('CreatureDeath', wrapCreatureDeath);
  hookWindowApi('BanditCamps', wrapBanditCamps);
  requestAnimationFrame(featureLoop);
})();
