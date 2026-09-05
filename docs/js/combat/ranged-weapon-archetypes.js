// Additional ranged archetypes and dual-role melee/ranged weapon bridge.
//
// Thrown weapons reuse the existing held flask windup/release pose language and
// fire on input release. Blowguns keep the normal ranged load/fire state machine
// while owning copied, independently editable load/fire pose data.
(() => {
  'use strict';

  const VERSION = 1;
  const PATCH_RETRY_MS = 50; // Used while game.js finishes constructing generated metal weapon definitions.
  const PATCH_RETRY_LIMIT = 160; // Used to stop the bootstrap poll after roughly eight seconds instead of polling forever.
  const THROWN_HOLD_VISUAL_S = 3600; // Used to park the ranged visual at its authored windup without adding another game.js hold state.
  const THROWN_TYPE = 'thrown';
  const BLOWGUN_TYPE = 'blowgun';
  const DUAL_ROLE_SHAPES = Object.freeze({ kylie: THROWN_TYPE, bshuakauitl: BLOWGUN_TYPE });
  const patchedItems = new Set(); // Used by diagnostics and idempotent definition patching.
  let thrownCharge = null; // Used to retain the active hold-release input until its matching release arrives.
  let lastRelease = null; // Used by the mobile-accessible debug snapshot to explain the most recent thrown release.
  let wrapperInstalled = false; // Used to avoid wrapping RangedWeapons.startPlayerAction more than once.
  let inputBridgeInstalled = false; // Used to avoid duplicate global release listeners after hot reloads.
  let baseStartPlayerAction = null; // Used to invoke the original ranged fire state machine after a thrown hold releases.
  let basePlayerActionLabel = null; // Used to preserve ordinary crossbow/blowgun action labels.

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
    return {
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
  }

  function blowgunConfig(toolDef) {
    const base = crossbowDefaults();
    return {
      ...base,
      label: toolDef?.label || 'Blowgun',
      rangedType: BLOWGUN_TYPE,
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
    patchedItems.add(itemKey);
    return !!shapeKey;
  }

  function patchGeneratedDefinitions() {
    const defs = toolDefinitions();
    if (!defs || !window.RangedWeapons?.config) return false;
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
    installInputBridge();
    let attempts = 0;
    const patchTimer = setInterval(() => {
      attempts++;
      installRangedWrapper();
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
      thrownCharge: thrownCharge ? { ...thrownCharge, heldMs: Math.round(performance.now() - thrownCharge.startedAt) } : null,
      lastRelease,
      blowgunLoadSource: 'crossbow-load-copy',
      blowgunStanceSource: 'drink-strike-copy',
    }),
  };
  window.__rangedArchetypeDebug = window.HobunjiRangedWeaponArchetypes;

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
})();
