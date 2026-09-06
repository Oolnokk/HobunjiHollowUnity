// Additional ranged archetypes and dual-role melee/ranged weapon bridge.
//
// Thrown weapons reuse the existing held flask windup/release pose language and
// fire on input release. Blowguns keep the normal ranged load/fire state machine
// while owning copied, independently editable load/fire pose data.
(() => {
  'use strict';

  const VERSION = 2;
  const PATCH_RETRY_MS = 50; // Used while game.js finishes constructing generated metal weapon definitions.
  const PATCH_RETRY_LIMIT = 160; // Used to stop the bootstrap poll after roughly eight seconds instead of polling forever.
  const THROWN_HOLD_VISUAL_S = 3600; // Used to park the ranged visual at its authored windup without adding another game.js hold state.
  const THROWN_TYPE = 'thrown';
  const BLOWGUN_TYPE = 'blowgun';
  const BLOWGUN_RAW_DAMAGE = 2; // Used as the deliberately tiny direct dart hit; mastery afflictions are the blowgun's real damage identity.
  const BLOWGUN_AFFLICTION_SCALE = 40; // Multiplies the ranged system's normal 0.15-per-rank buildup into a huge 6.0x raw-damage multiplier per chosen affliction rank.
  const BLOWGUN_AFFLICTION_EFFECT_IDS = Object.freeze([
    'bleedingHealth', 'woundedStamina', 'congealedHealth', 'infectedStamina',
    'windedStamina', 'bruisedHealth', 'shatteredStamina', 'poisonedHealth',
  ]); // Used by Blowgun mastery to offer the full authored affliction set instead of a physical-damage-biased subset.
  const KYLIE_BLUNT_EFFECT_IDS = Object.freeze([
    'bruisedHealth', 'windedStamina', 'congealedHealth', 'shatteredStamina', 'knockback',
  ]); // Used by Kylie ranged mastery so its options mirror the game's blunt affliction family rather than sharp-style buildup.
  const DUAL_ROLE_SHAPES = Object.freeze({ kylie: THROWN_TYPE, bshuakauitl: BLOWGUN_TYPE });
  const patchedItems = new Set(); // Used by diagnostics and idempotent definition patching.
  const scaledAfflictionAliases = new Map(); // Used to carry per-shot buildup scaling through the existing projectile affliction map without changing raw damage.
  let thrownCharge = null; // Used to retain the active hold-release input until its matching release arrives.
  let lastRelease = null; // Used by the mobile-accessible debug snapshot to explain the most recent thrown release.
  let wrapperInstalled = false; // Used to avoid wrapping RangedWeapons.startPlayerAction more than once.
  let inputBridgeInstalled = false; // Used to avoid duplicate global release listeners after hot reloads.
  let ammoProfileInstalled = false; // Used to install weapon-specific mastery choices only once while keeping the old ranged API compatible.
  let afflictionBridgeInstalled = false; // Used to avoid wrapping ResourceSystem.addAffliction more than once.
  let baseStartPlayerAction = null; // Used to invoke the original ranged fire state machine after a thrown hold releases.
  let basePlayerActionLabel = null; // Used to preserve ordinary crossbow/blowgun action labels.
  let baseSetBasicEffect = null; // Used by the profile-aware mastery validator after checking the current weapon's allowed choices.
  let baseAddAffliction = null; // Used by the scaled-affliction alias bridge to reach the normal ResourceSystem implementation.
  let baseBasicAmmoEffects = null; // Holds the ranged system's original effect objects so its closure-private payload builder can keep using them.
  let baseBasicAmmoDescriptors = []; // Immutable-ish plain copies used to build filtered UI/mastery choice lists without triggering affliction alias getters.

  function clonePose(pose = {}) { return { ...pose, shoulderAim: pose.shoulderAim ? { ...pose.shoulderAim } : undefined }; }
  function clonePoseSet(source = {}) {
    return {
      neutral: clonePose(source.neutral),
      windup: clonePose(source.windup),
      strike: clonePose(source.strike),
    };
  }

  function withScale(pose, scale) { return { ...clonePose(pose), scale }; }

  function sharedThrowAnimation() {
    return window.HeldActionAnimations?.throwFlask || {
      durationS: 0.62,
      windupFrac: 0.44,
      strikeFrac: 0.62,
      holdFrac: 0.68,
      releaseFrac: 0.62,
      poses: {
        neutral: { x: 0, y: 0, z: -0.05, pitch: 10.31, yaw: 0, roll: 0, bodyYaw: 0 },
        windup: { x: 0.12, y: 0.46, z: -0.16, pitch: -126, yaw: -8, roll: 10, bodyYaw: -12 },
        strike: { x: 0.18, y: 0.3, z: 0.5, pitch: 34, yaw: 4, roll: -6, bodyYaw: 8 },
      },
    };
  }

  function sharedDrinkStrikePose() {
    return window.HeldActionAnimations?.drink?.poses?.strike || {
      x: 0.4, y: 0.4, z: 0.22, pitch: -180, yaw: 21, roll: 4, bodyYaw: 0,
    };
  }

  // Editable authored copies. These intentionally do not alias the Crossbow or
  // Drink objects: later tuning can change Blowgun without changing either source.
  const BLOWGUN_LOAD_POSE = {
    neutral: { x: 0, y: 0.12, z: 0.18, pitch: -8, yaw: 0, bodyYaw: 0, roll: 0, scale: 1.30 },
    windup: { x: 0, y: -0.17, z: 0.09, pitch: 77, yaw: 0, bodyYaw: -10, roll: 0, scale: 1.30 },
    strike: { x: 0, y: 0.18, z: 0.08, pitch: -11, yaw: 0, bodyYaw: 7, roll: 0, scale: 1.30 },
  };
  const BLOWGUN_FIRE_POSE = {
    neutral: { x: 0.4, y: 0.4, z: 0.22, pitch: -180, yaw: 21, roll: 4, bodyYaw: 0, scale: 1.30 },
    windup: { x: 0.4, y: 0.4, z: 0.22, pitch: -180, yaw: 21, roll: 4, bodyYaw: 0, scale: 1.30 },
    strike: { x: 0.4, y: 0.4, z: 0.22, pitch: -180, yaw: 21, roll: 4, bodyYaw: 0, scale: 1.30 },
  };

  function syncBlowgunStanceFromDrink() {
    const strike = sharedDrinkStrikePose();
    for (const phase of ['neutral', 'windup', 'strike']) {
      Object.assign(BLOWGUN_FIRE_POSE[phase], withScale(strike, 1.30));
    }
  }

  function crossbowDefaults() {
    const crossbow = window.RangedWeapons?.config?.crossbow || {};
    return {
      projectileCount: Number(crossbow.projectileCount) || 1,
      spreadDeg: Number(crossbow.spreadDeg) || 0,
      damage: Number(crossbow.damage) || 16,
      speedPxS: Number(crossbow.speedPxS) || 720,
      rangeTiles: Number(crossbow.rangeTiles) || 9,
      projectileRadiusPx: Number(crossbow.projectileRadiusPx) || 7,
      knockbackPxS: Number(crossbow.knockbackPxS) || 130,
      staminaCost: Number(crossbow.staminaCost) || 10,
    };
  }

  function finiteOr(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function authoredEffectIds(toolDef, fallback) {
    return Array.isArray(toolDef?.rangedBasicAmmoEffectIds) && toolDef.rangedBasicAmmoEffectIds.length
      ? [...toolDef.rangedBasicAmmoEffectIds]
      : [...fallback];
  }

  function thrownConfig(itemKey, toolDef) {
    const base = crossbowDefaults();
    const animation = sharedThrowAnimation();
    const scale = Number(toolDef?.rangedScale) || 1.05;
    const releaseDurationS = Math.max(0.12, (animation.durationS || 0.62) * (1 - (animation.windupFrac ?? 0.44)));
    const releaseAtFrac = Math.max(0.01, Math.min(0.98,
      ((animation.releaseFrac ?? animation.strikeFrac ?? 0.62) - (animation.windupFrac ?? 0.44)) /
      Math.max(0.01, 1 - (animation.windupFrac ?? 0.44))
    ));
    const holdFrac = Math.max(releaseAtFrac, Math.min(0.99,
      ((animation.holdFrac ?? 0.68) - (animation.windupFrac ?? 0.44)) /
      Math.max(0.01, 1 - (animation.windupFrac ?? 0.44))
    ));
    const shapeKey = shapeKeyFor(itemKey, toolDef);
    const config = {
      ...base,
      label: toolDef?.label || 'Thrown Weapon',
      rangedType: THROWN_TYPE,
      inputMode: 'hold-release',
      projectileSprite: toolDef?.sprite || 'assets/toolsprites/kylie.png',
      fireDurationS: releaseDurationS,
      fireSequence: 'attack',
      fireWindupFrac: 0,
      fireAtFrac: releaseAtFrac,
      fireHoldFrac: holdFrac,
      reloadDurationS: 0.01,
      reloadSequence: 'attack',
      reloadWindupFrac: 0,
      reloadStrikeFrac: 0.01,
      reloadHoldFrac: 0.01,
      // Idle uses the true neutral. Release starts from the already-held windup.
      loadPose: {
        neutral: withScale(animation.poses?.neutral, scale),
        windup: withScale(animation.poses?.neutral, scale),
        strike: withScale(animation.poses?.neutral, scale),
      },
      firePose: {
        neutral: withScale(animation.poses?.windup, scale),
        windup: withScale(animation.poses?.windup, scale),
        strike: withScale(animation.poses?.strike, scale),
      },
      chargePose: {
        neutral: withScale(animation.poses?.neutral, scale),
        windup: withScale(animation.poses?.windup, scale),
        strike: withScale(animation.poses?.windup, scale),
      },
      chargeWindupS: Math.max(0.05, (animation.durationS || 0.62) * (animation.windupFrac ?? 0.44)),
    };
    if (shapeKey === 'kylie' || Array.isArray(toolDef?.rangedBasicAmmoEffectIds)) {
      config.basicAmmoEffectIds = authoredEffectIds(toolDef, KYLIE_BLUNT_EFFECT_IDS);
      config.afflictionProfile = toolDef?.rangedAfflictionProfile || 'blunt';
    }
    if (Number.isFinite(Number(toolDef?.rangedDamage))) config.damage = Number(toolDef.rangedDamage);
    return config;
  }

  function blowgunConfig(toolDef) {
    const base = crossbowDefaults();
    return {
      ...base,
      damage: finiteOr(toolDef?.rangedDamage, BLOWGUN_RAW_DAMAGE),
      label: toolDef?.label || 'Blowgun',
      rangedType: BLOWGUN_TYPE,
      afflictionProfile: toolDef?.rangedAfflictionProfile || BLOWGUN_TYPE,
      basicAfflictionScale: Math.max(1, finiteOr(toolDef?.rangedAfflictionScale, BLOWGUN_AFFLICTION_SCALE)),
      basicAmmoEffectIds: authoredEffectIds(toolDef, BLOWGUN_AFFLICTION_EFFECT_IDS),
      inputMode: 'load-fire',
      projectileSprite: toolDef?.rangedProjectileSprite || 'assets/toolsprites/arrow_short.png',
      reloadDurationS: 1.04,
      reloadSequence: 'attack',
      reloadWindupFrac: 0.55,
      reloadStrikeFrac: 0.56,
      reloadHoldFrac: 0.692,
      fireDurationS: 1.04,
      fireSequence: 'attack',
      fireWindupFrac: 0.05,
      fireAtFrac: 0.08,
      fireHoldFrac: 0.17,
      firePose: clonePoseSet(BLOWGUN_FIRE_POSE),
      loadPose: clonePoseSet(BLOWGUN_LOAD_POSE),
    };
  }

  function toolDefinitions() { return window.Combat?.deps?.TOOL_ITEM_DEFS || null; }

  function shapeKeyFor(itemKey, def) {
    if (def?.shapeKey) return def.shapeKey;
    if (DUAL_ROLE_SHAPES[itemKey]) return itemKey;
    return null;
  }

  function rangedTypeFor(itemKey, def) {
    return def?.rangedType || DUAL_ROLE_SHAPES[shapeKeyFor(itemKey, def)] || null;
  }

  function addSlot(def, slot) {
    if (!Array.isArray(def.slots)) def.slots = [];
    if (!def.slots.includes(slot)) def.slots.push(slot);
  }

  function allowedBasicEffectIds(itemKey) {
    const configured = window.RangedWeapons?.config?.[itemKey]?.basicAmmoEffectIds;
    if (Array.isArray(configured) && configured.length) return configured;
    return baseBasicAmmoDescriptors.map(effect => effect.id);
  }

  function basicAmmoEffectsFor(itemKey = window.RangedWeapons?.equippedRangedKey?.()) {
    const allowed = new Set(allowedBasicEffectIds(itemKey));
    const config = window.RangedWeapons?.config?.[itemKey] || {};
    const highBuildup = Number(config.basicAfflictionScale) > 1;
    const shotNoun = config.rangedType === BLOWGUN_TYPE ? 'dart' : (config.rangedType === THROWN_TYPE ? 'throw' : 'shot');
    return baseBasicAmmoDescriptors
      .filter(effect => allowed.has(effect.id))
      .map(effect => ({
        ...effect,
        desc: highBuildup && effect.afflictionId
          ? `Each ${shotNoun} applies very high ${effect.label} buildup.`
          : effect.desc,
      }));
  }

  function sanitizeBasicLoadout(itemKey) {
    const effects = window.Combat?.deps?.getGearInventory?.()?.rangedAmmoLoadouts?.[itemKey]?.basicEffects;
    if (!effects) return false;
    const allowed = new Set(allowedBasicEffectIds(itemKey));
    let changed = false;
    for (const rank of [1, 3, 5]) {
      if (effects[rank] && !allowed.has(effects[rank])) {
        effects[rank] = null;
        changed = true;
      }
    }
    if (changed) window.Combat?.deps?.saveGearInventory?.();
    return changed;
  }

  function aliasToken(value) {
    return String(value || 'ranged').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'ranged';
  }

  function installAfflictionScalingBridge() {
    const rs = window.ResourceSystem;
    if (!rs?.AFFLICTIONS || typeof rs.addAffliction !== 'function') return false;
    if (afflictionBridgeInstalled) return true;
    baseAddAffliction = rs.addAffliction.bind(rs);
    rs.addAffliction = function rangedScaledAddAffliction(entity, id, amount) {
      const alias = scaledAfflictionAliases.get(id);
      if (!alias) return baseAddAffliction(entity, id, amount);
      return baseAddAffliction(entity, alias.realId, amount * alias.scale);
    };
    afflictionBridgeInstalled = true;
    return true;
  }

  function ensureScaledAfflictionAlias(realId, scale, profile) {
    if (!(scale > 1) || !realId) return realId;
    if (!installAfflictionScalingBridge()) return realId;
    const rs = window.ResourceSystem;
    const realDef = rs?.AFFLICTIONS?.[realId];
    if (!realDef) return realId;
    const roundedScale = Math.round(scale * 1000) / 1000;
    const aliasId = `__ranged_${aliasToken(profile)}_${String(roundedScale).replace('.', '_')}x_${realId}`;
    if (!scaledAfflictionAliases.has(aliasId)) {
      scaledAfflictionAliases.set(aliasId, { realId, scale: roundedScale, profile: profile || 'ranged' });
      rs.AFFLICTIONS[aliasId] = { ...realDef, rangedAliasFor: realId, rangedScale: roundedScale };
      const colors = window.ResourceRings?.AFFLICTION_COLORS;
      if (colors && Object.prototype.hasOwnProperty.call(colors, realId)) {
        try { colors[aliasId] = colors[realId]; } catch (_) { /* Cosmetic color table may be frozen; white trail fallback is harmless. */ }
      }
    }
    return aliasId;
  }

  function scaledAfflictionId(realId) {
    const ranged = window.RangedWeapons;
    const itemKey = ranged?.equippedRangedKey?.();
    const config = ranged?.config?.[itemKey];
    const scale = Number(config?.basicAfflictionScale) || 1;
    return scale > 1 ? ensureScaledAfflictionAlias(realId, scale, config?.afflictionProfile || config?.rangedType || itemKey) : realId;
  }

  function installAmmoProfiles() {
    const ranged = window.RangedWeapons;
    if (!ranged) return false;
    if (ammoProfileInstalled) {
      installAfflictionScalingBridge();
      return true;
    }
    if (!Array.isArray(ranged.BASIC_AMMO_EFFECTS) || typeof ranged.setBasicEffect !== 'function') return false;

    baseBasicAmmoEffects = ranged.BASIC_AMMO_EFFECTS;
    baseBasicAmmoDescriptors = baseBasicAmmoEffects.map(effect => ({
      id: effect.id,
      label: effect.label,
      desc: effect.desc,
      afflictionId: effect.afflictionId || null,
      knockbackMul: effect.knockbackMul || 0,
    }));

    for (const effect of baseBasicAmmoEffects) {
      const descriptor = baseBasicAmmoDescriptors.find(entry => entry.id === effect.id);
      if (!descriptor?.afflictionId) continue;
      const realId = descriptor.afflictionId;
      Object.defineProperty(effect, 'afflictionId', {
        configurable: true,
        enumerable: true,
        get: () => scaledAfflictionId(realId),
      });
    }

    baseSetBasicEffect = ranged.setBasicEffect.bind(ranged);
    ranged.setBasicEffect = function profileAwareSetBasicEffect(itemKey, rank, effectId) {
      if (!basicAmmoEffectsFor(itemKey).some(effect => effect.id === effectId)) return false;
      return baseSetBasicEffect(itemKey, rank, effectId);
    };
    ranged.basicAmmoEffectsFor = basicAmmoEffectsFor;
    Object.defineProperty(ranged, 'BASIC_AMMO_EFFECTS', {
      configurable: true,
      enumerable: true,
      get: () => basicAmmoEffectsFor(ranged.equippedRangedKey?.()),
    });
    installAfflictionScalingBridge();
    ammoProfileInstalled = true;
    return true;
  }

  function patchItem(itemKey, def) {
    const shapeKey = shapeKeyFor(itemKey, def);
    const type = rangedTypeFor(itemKey, def);
    if (!def || !type || (type !== THROWN_TYPE && type !== BLOWGUN_TYPE)) return false;
    addSlot(def, 'ranged');
    def.rangedType = type;
    def.animStyle = def.animStyle || 'ranged';
    const ranged = window.RangedWeapons;
    if (!ranged?.config) return false;
    if (type === THROWN_TYPE) {
      ranged.config[itemKey] = thrownConfig(itemKey, def);
      ranged.setLoaded?.(itemKey, false);
    } else {
      ranged.config[itemKey] = blowgunConfig(def);
      // A blowgun begins ready-to-fire like existing crossbows; after firing,
      // the normal ranged state machine exposes its explicit load stage.
      ranged.setLoaded?.(itemKey, true);
    }
    sanitizeBasicLoadout(itemKey);
    patchedItems.add(itemKey);
    return !!shapeKey;
  }

  function patchGeneratedDefinitions() {
    const defs = toolDefinitions();
    if (!defs || !window.RangedWeapons?.config) return false;
    installAmmoProfiles();
    syncBlowgunStanceFromDrink();
    let changed = 0;
    for (const [itemKey, def] of Object.entries(defs)) {
      const type = rangedTypeFor(itemKey, def);
      if (!type) continue;
      if (patchItem(itemKey, def)) changed++;
    }
    if (!patchedItems.size) return false;
    window.WeaponToolStances?.refreshDefinitions?.();
    window.Combat?.deps?.refreshActionBar?.();
    if (changed) window.__farmLog?.(`[ranged-archetypes] patched ${changed} dual-role generated weapon definition(s).`, 'combat');
    return true;
  }

  function isThrown(itemKey) {
    return window.RangedWeapons?.config?.[itemKey]?.rangedType === THROWN_TYPE;
  }

  function beginThrownCharge(itemKey, source = 'ranged-action', pointerId = null) {
    if (!isThrown(itemKey)) return false;
    if (thrownCharge?.itemKey === itemKey) return true;
    if (window.__rangedDebug?.playerAction) return false;
    const def = window.RangedWeapons.config[itemKey];
    thrownCharge = { itemKey, source, pointerId, startedAt: performance.now() };
    window.RangedWeapons.setLoaded?.(itemKey, false);
    const holdVisual = window.Combat?.deps?.triggerRangedWeaponVisual;
    if (typeof holdVisual === 'function') {
      const windupFrac = Math.max(0.000001, (def.chargeWindupS || 0.27) / THROWN_HOLD_VISUAL_S);
      holdVisual(THROWN_HOLD_VISUAL_S, {
        sequence: 'attack',
        pose: def.chargePose,
        windupFrac,
        strikeFrac: 0.99999,
        holdFrac: 0.999995,
      });
    }
    window.Combat?.deps?.refreshActionBar?.();
    lastRelease = { type: 'charge-start', itemKey, source, at: Date.now() };
    return true;
  }

  function releaseThrownCharge(source = 'release') {
    const charge = thrownCharge;
    if (!charge) return false;
    thrownCharge = null;
    const ranged = window.RangedWeapons;
    if (!ranged?.config?.[charge.itemKey] || typeof baseStartPlayerAction !== 'function') return false;
    // Force the existing load/fire state machine into its fire branch. The fire
    // event itself returns this item to empty/neutral, so no synthetic load stage
    // is ever exposed for a thrown weapon.
    ranged.setLoaded?.(charge.itemKey, true);
    const fired = baseStartPlayerAction(charge.itemKey);
    if (!fired) ranged.setLoaded?.(charge.itemKey, false);
    const heldMs = Math.max(0, performance.now() - charge.startedAt);
    lastRelease = { type: fired ? 'released' : 'release-failed', itemKey: charge.itemKey, source, heldMs: Math.round(heldMs), at: Date.now() };
    window.__farmLog?.(`[ranged-archetypes] ${charge.itemKey} ${fired ? 'released' : 'release failed'} after ${Math.round(heldMs)}ms (${source}).`, 'combat');
    return fired;
  }

  function cancelThrownCharge(reason = 'cancel') {
    if (!thrownCharge) return false;
    const itemKey = thrownCharge.itemKey;
    thrownCharge = null;
    window.RangedWeapons?.setLoaded?.(itemKey, false);
    window.RangedWeapons?.cancelPlayerAction?.();
    lastRelease = { type: 'cancelled', itemKey, source: reason, at: Date.now() };
    return true;
  }

  function installRangedWrapper() {
    const ranged = window.RangedWeapons;
    if (!ranged || wrapperInstalled) return !!ranged;
    baseStartPlayerAction = ranged.startPlayerAction.bind(ranged);
    basePlayerActionLabel = ranged.playerActionLabel.bind(ranged);
    ranged.startPlayerAction = function archetypeAwareStart(itemKey) {
      if (isThrown(itemKey)) return beginThrownCharge(itemKey);
      return baseStartPlayerAction(itemKey);
    };
    ranged.playerActionLabel = function archetypeAwareLabel(itemKey) {
      if (!isThrown(itemKey)) return basePlayerActionLabel(itemKey);
      if (thrownCharge?.itemKey === itemKey) return `Release ${ranged.config[itemKey]?.label || 'Throw'}`;
      if (window.__rangedDebug?.playerAction?.itemKey === itemKey) return `Throwing ${ranged.config[itemKey]?.label || 'Weapon'}…`;
      return `Throw ${ranged.config[itemKey]?.label || 'Weapon'}`;
    };
    wrapperInstalled = true;
    return true;
  }

  function desktopBindingFor(actionId) {
    return window.InputBindings?.getCurrentBindings?.()?.desktop?.[actionId] || null;
  }
  function controllerBindingFor(actionId) {
    return window.InputBindings?.getCurrentBindings?.()?.controller?.[actionId] || null;
  }
  function mouseCode(button) { return `Mouse${Number(button) || 0}`; }

  function gamepadBindingDown(binding) {
    const pads = navigator.getGamepads?.() || [];
    const pad = [...pads].find(Boolean);
    if (!pad || !binding) return false;
    const buttonMatch = /^Button(\d+)$/.exec(binding);
    if (buttonMatch) return !!pad.buttons?.[Number(buttonMatch[1])]?.pressed;
    if (binding === 'LeftTrigger') return !!pad.buttons?.[6]?.pressed;
    if (binding === 'RightTrigger') return !!pad.buttons?.[7]?.pressed;
    return false;
  }

  function installInputBridge() {
    if (inputBridgeInstalled || typeof window === 'undefined') return;
    inputBridgeInstalled = true;

    // Touch/mobile starts immediately on the visible Shoot button, even if the
    // game's ordinary tap dispatcher would otherwise wait for its own gesture threshold.
    window.addEventListener('pointerdown', event => {
      const button = event.target?.closest?.('[data-action="shoot"]');
      if (!button) return;
      const itemKey = window.RangedWeapons?.equippedRangedKey?.();
      if (isThrown(itemKey)) beginThrownCharge(itemKey, 'action-button', event.pointerId);
    }, true);

    window.addEventListener('pointerup', event => {
      if (!thrownCharge) return;
      if (thrownCharge.pointerId != null && event.pointerId === thrownCharge.pointerId) {
        releaseThrownCharge('action-button-pointerup');
        return;
      }
      if (desktopBindingFor('action1') === mouseCode(event.button)) releaseThrownCharge('desktop-mouseup');
    }, true);
    window.addEventListener('pointercancel', event => {
      if (thrownCharge?.pointerId === event.pointerId) cancelThrownCharge('pointer-cancel');
    }, true);

    // A lost release (alt-tab, app switch) must not leave the player parked in the
    // charging windup pose forever — same convention as combat-input.js's abortAllPresses.
    window.addEventListener('blur', () => { if (thrownCharge) cancelThrownCharge('window-blur'); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && thrownCharge) cancelThrownCharge('visibility-hidden');
    });

    window.addEventListener('keyup', event => {
      if (thrownCharge && desktopBindingFor('action1') === event.code) releaseThrownCharge('desktop-keyup');
    }, true);

    const pollControllerRelease = () => {
      if (thrownCharge && thrownCharge.source === 'ranged-action') {
        const binding = controllerBindingFor('action1');
        if (binding && !gamepadBindingDown(binding)) releaseThrownCharge('controller-release');
      }
      requestAnimationFrame(pollControllerRelease);
    };
    requestAnimationFrame(pollControllerRelease);
  }

  function bootstrap() {
    installRangedWrapper();
    installAmmoProfiles();
    installAfflictionScalingBridge();
    installInputBridge();
    let attempts = 0;
    const patchTimer = setInterval(() => {
      attempts++;
      installRangedWrapper();
      installAmmoProfiles();
      installAfflictionScalingBridge();
      if (patchGeneratedDefinitions() || attempts >= PATCH_RETRY_LIMIT) clearInterval(patchTimer);
    }, PATCH_RETRY_MS);
  }

  window.HobunjiRangedWeaponArchetypes = {
    version: VERSION,
    patchGeneratedDefinitions,
    beginThrownCharge,
    releaseThrownCharge,
    cancelThrownCharge,
    isThrown,
    basicAmmoEffectsFor,
    activeThrownChargeItemKey: () => thrownCharge?.itemKey || null,
    animations: {
      // These are mutable authored copies on purpose: the user can tune/export
      // Blowgun without changing the Crossbow or Drink source animations.
      blowgunLoad: BLOWGUN_LOAD_POSE,
      blowgunFire: BLOWGUN_FIRE_POSE,
      thrown: () => clonePoseSet(sharedThrowAnimation().poses),
    },
    debugSnapshot: () => ({
      version: VERSION,
      patchedItems: [...patchedItems],
      equippedRanged: window.RangedWeapons?.equippedRangedKey?.() || null,
      equippedType: window.RangedWeapons?.config?.[window.RangedWeapons?.equippedRangedKey?.()]?.rangedType || null,
      equippedBasicEffects: basicAmmoEffectsFor().map(effect => effect.id),
      scaledAfflictionAliases: Object.fromEntries([...scaledAfflictionAliases].map(([id, value]) => [id, { ...value }])),
      thrownCharge: thrownCharge ? { ...thrownCharge, heldMs: Math.round(performance.now() - thrownCharge.startedAt) } : null,
      lastRelease,
      blowgunRawDamage: BLOWGUN_RAW_DAMAGE,
      blowgunAfflictionScale: BLOWGUN_AFFLICTION_SCALE,
      blowgunLoadSource: 'crossbow-load-copy',
      blowgunStanceSource: 'drink-strike-copy',
    }),
  };
  window.__rangedArchetypeDebug = window.HobunjiRangedWeaponArchetypes;

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
})();
