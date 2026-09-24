// Shared authored poses for held-item actions. The game runtime and the
// Tool / Attack Animation Editor both read this object so their defaults do
// not drift; an editor export can be copied back here after visual tuning.
(() => {
  'use strict';

  const drink = {
    version: 1,
    kind: 'hobunji_held_action_animation',
    name: 'Drink',
    style: 'drink',
    durationS: 0.95,
    windupFrac: 0.38,
    strikeFrac: 0.62,
    holdFrac: 0.78,
    poses: {
      // Neutral is an idle endpoint: Pitch + Roll aim to the shoulder.
      neutral: { x: 0, y: 0, z: -0.05, pitch: 10.31, yaw: 0, roll: 0, bodyYaw: 0, shoulderAim: { grip: true, palmNormal: true } },
      // Active endpoints deliberately retain Roll-only shoulder alignment.
      windup: { x: 0.32, y: 0.21, z: 0.1, pitch: -114, yaw: 18, roll: -8, bodyYaw: 0, shoulderAim: { grip: false, palmNormal: true } },
      strike: { x: 0.4, y: 0.4, z: 0.22, pitch: -180, yaw: 21, roll: 4, bodyYaw: 0, shoulderAim: { grip: false, palmNormal: true } },
    },
  };

  const throwFlask = {
    version: 1,
    kind: 'hobunji_held_action_animation',
    name: 'Overhead Flask Throw',
    style: 'throw',
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
  }; // Used by held flask aim/confirm; intentionally simple for later authoring tweaks.

  // Shared temporary throw animation for every thrown weapon until dedicated
  // per-shape throws are authored. Runtime charge holds at its Windup endpoint,
  // then release scales this pose path to the visible charge percentage.
  const weaponThrowSpin = {
    version: 1,
    kind: 'hobunji_attack_animation',
    name: 'Weapon Throw (Spin)',
    style: 'chop',
    sequence: 'attack',
    durationS: 1.04,
    windupFrac: 0.49,
    strikeFrac: 0.57,
    holdFrac: 0.82,
    gripMode: 'palm-parallel',
    spinBasisDeg: 0,
    spinRevolutions: 2.5,
    projectileSpin: true,
    poses: {
      neutral: {
        x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: 2, roll: -82,
        shoulderAim: { grip: true, palmNormal: true },
        secondaryGrip: { enabled: false, percent: 50 },
      },
      windup: {
        x: 0.41, y: 0.37, z: 0.42, pitch: -180, yaw: 139, bodyYaw: -152, roll: -92,
        shoulderAim: { grip: false, palmNormal: true },
        secondaryGrip: { enabled: false, percent: 50 },
      },
      strike: {
        x: -0.57, y: 0.33, z: 0.17, pitch: -25, yaw: -65, bodyYaw: 63, roll: -88,
        shoulderAim: { grip: false, palmNormal: true },
        secondaryGrip: { enabled: false, percent: 50 },
      },
    },
  };

  // Fishing spears use the same arm/body path, but the weapon's in-plane
  // spinning basis is rotated 90° counterclockwise. On release the projectile
  // keeps the exact sampled spear-plane orientation instead of continuing to
  // tumble like a hatchet/dagger/Kylie.
  const weaponThrowSpearSpin = {
    ...weaponThrowSpin,
    name: 'Fishing Spear Throw (Offset Spin)',
    toolEndFlip: true, // Runtime already end-flips fishing spear throws; keep the shared editor source on that exact visible basis too.
    spinBasisDeg: 90,
    projectileSpin: false,
    projectileLockAlignment: true,
    projectileBasisDeg: -90, // Corrects only the launched spear PNG a quarter-turn clockwise; held spin/end-flip authoring stays unchanged.
    poses: {
      neutral: { ...weaponThrowSpin.poses.neutral, shoulderAim: { ...weaponThrowSpin.poses.neutral.shoulderAim }, secondaryGrip: { ...weaponThrowSpin.poses.neutral.secondaryGrip } },
      windup: { ...weaponThrowSpin.poses.windup, shoulderAim: { ...weaponThrowSpin.poses.windup.shoulderAim }, secondaryGrip: { ...weaponThrowSpin.poses.windup.secondaryGrip } },
      strike: { ...weaponThrowSpin.poses.strike, shoulderAim: { ...weaponThrowSpin.poses.strike.shoulderAim }, secondaryGrip: { ...weaponThrowSpin.poses.strike.secondaryGrip } },
    },
  };

  // Counter Shield is authored here rather than privately in combat-counter-shield.js
  // so the runtime and Attack Animation Editor operate on the same guard pose.
  // Roll 180 turns the flat weapon PNG around in its own plane, making the weapon
  // point in the opposite direction without changing the guard's world-space aim.
  const counterShield = {
    version: 1,
    kind: 'hobunji_held_action_animation',
    name: 'Counter Shield',
    style: 'sweep',
    durationS: 0.24,
    windupFrac: 0.50,
    strikeFrac: 1.00,
    holdFrac: 1.00,
    poses: {
      neutral: { x: 0, y: 0, z: 0.16, pitch: 0, yaw: 0, roll: 180, bodyYaw: 0 },
      windup: { x: 0, y: 0.05, z: 0.30, pitch: 14, yaw: 0, roll: 180, bodyYaw: -20 },
      strike: { x: 0, y: 0.05, z: 0.30, pitch: 14, yaw: 0, roll: 180, bodyYaw: -20 },
    },
  };

  window.HeldActionAnimations = Object.freeze({ drink, throwFlask, weaponThrowSpin, weaponThrowSpearSpin, counterShield });

  // Shared direct-hand bootstrap. There are no arm bones, IK, reach clamps, or
  // rotating arm sprites. Shoulder coordinates are either manually authored in
  // Animation Author or resolved by the raw-arm main-mass fallback. Per-pose axis
  // weights then blend smoothly with the same pose timeline as the held item.
  const configuredDocsBase = window.__HobunjiHandBootstrapDocsBase || null; // Lets repository-backed authoring tools keep every hand dependency on the selected commit.
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = configuredDocsBase
    ? new URL(configuredDocsBase, location.href)
    : (selfUrl && selfUrl.protocol !== 'blob:' ? new URL('../', selfUrl) : new URL('./', location.href));
  const isAttackEditor = /\/tools\/attack-animation-editor\/(?:index\.html)?$/.test(location.pathname);
  const isAnimationAuthor = /\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname);

  // The Attack Animation Editor consumes this shared object directly through
  // its Action registry. Editor-specific DOM injection would create a second
  // source of truth, so this library deliberately does nothing there.
  if (isAttackEditor) {
    // The Attack Animation Editor now reads HeldActionAnimations directly through
    // its unified Action registry. Do not inject options, synthesize DOM events,
    // or maintain a second editor state bridge here.
  } else if (!isAnimationAuthor) {
    // Counter Shield's combat module predates the shared held-action library and
    // still owns a private fallback BLOCK_POSE. Once all synchronous combat scripts
    // have registered their abilities, wrap only Counter Shield's hold callbacks and
    // substitute this shared authored pose at the triggerWeaponHoldVisual boundary.
    // No combat timing/damage/stamina code is replaced; only the visual pose payload.
    const installCounterShieldRuntimePoseBridge = () => {
      const ability = window.Combat?.abilities?.get?.('counterShield');
      if (!ability || ability._sharedHeldActionPoseBridge) return false;
      const methodNames = ['onHoldStart', 'onHoldUpdate'];
      for (const methodName of methodNames) {
        const originalMethod = ability[methodName];
        if (typeof originalMethod !== 'function') continue;
        ability[methodName] = function sharedCounterShieldPoseCallback(...args) {
          const deps = window.Combat?.deps;
          const originalHoldVisual = deps?.triggerWeaponHoldVisual;
          const authored = window.HeldActionAnimations?.counterShield;
          if (!authored?.poses || typeof originalHoldVisual !== 'function') {
            return originalMethod.apply(this, args);
          }
          deps.triggerWeaponHoldVisual = function sharedCounterShieldHoldVisual(_durationS, options = {}) {
            return originalHoldVisual.call(this, authored.durationS || _durationS, {
              ...options,
              anim: authored.style || options.anim || 'sweep',
              pose: authored.poses,
              windupFrac: authored.windupFrac ?? options.windupFrac,
              strikeFrac: authored.strikeFrac ?? options.strikeFrac,
            });
          };
          try {
            return originalMethod.apply(this, args);
          } finally {
            deps.triggerWeaponHoldVisual = originalHoldVisual;
          }
        };
      }
      ability._sharedHeldActionPoseBridge = true;
      window.__farmLog?.('[counter-shield] shared Attack Editor guard pose bridge installed.', 'info', 'combat');
      return true;
    };

    const installWhenReady = () => {
      if (installCounterShieldRuntimePoseBridge()) return;
      let attempts = 0;
      const retry = setInterval(() => {
        attempts++;
        if (installCounterShieldRuntimePoseBridge() || attempts >= 40) clearInterval(retry);
      }, 50);
    };
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', installWhenReady, { once: true });
    } else {
      setTimeout(installWhenReady, 0);
    }
  }

  // Cache versions below are bumped whenever their held-item authoring contract changes.
  // This matters on the stable game/editor URLs where the parent held-action script URL itself may be cached.
  const handScripts = [
    new URL('config/hand-model-profiles.js?v=20260919handreview1', docsBase).href,
    new URL('config/hand-shoulder-points.js?v=20260818b', docsBase).href,
    new URL('config/hand-shoulder-pose-profiles.js?v=20260920localhinge1', docsBase).href,
    new URL('js/procedural-hand-foot-material-roles.js?v=20260821e', docsBase).href,
    new URL('js/hand-tool-grips.js?v=20260921throwpivot2', docsBase).href,
    new URL('js/hand-grip-modes.js?v=20260920palmflip1-rangedgrip1', docsBase).href,
    new URL('js/hand-shoulder-pose-runtime.js?v=20260920elbow5', docsBase).href,
    new URL('js/portrait-arm-cloud-mask.js?v=20260817a', docsBase).href,
    new URL('js/portrait-hand-shoulder-scan.js?v=20260818c', docsBase).href,
    new URL('js/portrait-hand-shoulder-scan-species.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-attachments.js?v=20260920wristaxis1', docsBase).href,
    new URL('js/procedural-hand-outline-parity.js?v=20260821f', docsBase).href,
    new URL('js/attachment-rig-latest-authored-snapshot.js?v=20260904a', docsBase).href,
    new URL('js/procedural-hand-scale-free-world.js?v=20260924perf1', docsBase).href,
    new URL('js/procedural-hand-shoulder-aim.js?v=20260924perf1', docsBase).href,
    new URL('js/procedural-hand-frame-driver.js?v=20260919handreview1-rangedgrip1', docsBase).href,
  ];
  if (isAttackEditor) {
    // The editor starts its first avatar rebuild immediately after these parser-time
    // scripts. Repair the shared NpcAvatarPreview dependency before any hand/editor
    // adapters run so a missed/cached helper request cannot strand the preview.
    handScripts.push(new URL('js/attack-editor-npc-preview-guard.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-configurator.js?v=20260919handreview1', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-inverse-configurator.js?v=20260919handreview1', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-mirror-toggle.js?v=20260817a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-grip-mode.js?v=20260919labels1-rangedgrip1', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-direct-attachments.js?v=20260919quatcal1-rangedgrip2', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-shoulder-controls.js?v=20260920posecore1', docsBase).href);
    handScripts.push(new URL('js/attack-editor-idle-hand-parity.js?v=20260920localhinge1', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-state-coherence.js?v=20260919handreview1', docsBase).href);
    handScripts.push(new URL('js/attack-editor-history.js?v=20260919history1', docsBase).href); // Loaded last so Undo/Redo can snapshot every hand/grip extension plus the core module once it initializes.
  } else if (!isAnimationAuthor) {
    handScripts.push(new URL('js/procedural-hand-grip-runtime.js?v=20260918throwcharge3', docsBase).href);
    handScripts.push(new URL('js/weapon-idle-body-yaw-runtime.js?v=20260915perf1', docsBase).href);
    handScripts.push(new URL('js/crossbow-strike-audio-trim.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/weapon-png-scale.js?v=20260902c', docsBase).href);
    handScripts.push(new URL('js/hand-pixel-probe-diagnostics.js?v=20260821b', docsBase).href);
  }

  function loadSequentially(urls) {
    return urls.reduce((promise, src) => promise.then(() => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    })), Promise.resolve());
  }

  let ready;
  if (document.readyState === 'loading' && document.currentScript) {
    for (const src of handScripts) document.write(`<script src="${src}"><\/script>`);
    ready = Promise.resolve();
  } else {
    ready = loadSequentially(handScripts);
  }
  window.HobunjiHandRuntimeReady = ready; // Repository tools await this before constructing avatars that the frame driver must wrap.
  ready.then(() => window.applyHobunjiAttachmentRigProfileCorrections?.()); // Applies exported species/gender hand scales after the hand-profile manager finishes loading.
  ready.catch(error => console.warn('[hands] bootstrap failed:', error));
})();
