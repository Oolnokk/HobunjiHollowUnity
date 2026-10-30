// Shared authored poses for held-item actions. The game runtime and the
// Tool / Attack Animation Editor both read this object so their defaults do
// not drift; an editor export can be copied back here after visual tuning.
(() => {
  'use strict';

  const drink = {
    version: 1,
    kind: 'hobunji_held_action_animation',
    name: 'Drink',
    headRelative: true, // Head-anchored: x/y/z are the held bottle's opening (aperture) measured from the species mouth point, in the head's frame; the head supplies rotation and scale.
    style: 'drink',
    durationS: 0.95,
    windupFrac: 0.38,
    strikeFrac: 0.62,
    holdFrac: 0.78,
    poses: {
      // Neutral is an idle endpoint: Pitch + Roll aim to the shoulder.
      neutral: { headRelative: true, x: -0.45, y: -0.42, z: 0.061, pitch: 10.31, yaw: 0, roll: 0, bodyYaw: 0, shoulderAim: { grip: true, palmNormal: true } },
      // Active endpoints deliberately retain Roll-only shoulder alignment.
      windup: { headRelative: true, x: -0.144, y: -0.087, z: 0.056, pitch: -114, yaw: 18, roll: -8, bodyYaw: 0, shoulderAim: { grip: false, palmNormal: true } },
      strike: { headRelative: true, x: -0.09, y: 0, z: 0.115, pitch: -180, yaw: 21, roll: 4, bodyYaw: 0, shoulderAim: { grip: false, palmNormal: true } },
    },
  };


  // Ordinary small bag items are carried in this own tool-base pose (NOT a
  // head/mouth-relative Drink pose). Starts as a copy of the functioning
  // Pick-Shovel long-hafted Tool Neutral and can be tuned independently.
  const smallHeldNeutral = Object.freeze({ x: 0.21, y: -0.12, z: -0.08, pitch: 17, yaw: -49, roll: -96, bodyYaw: -8, shoulderAim: { grip: true, palmNormal: true } }); // Source for all three editor still frames, independent of the long-hafted tool config.
  const heldItemSmall = {
    version: 1,
    kind: 'hobunji_held_action_animation',
    name: 'Small Held Item — Idle',
    style: 'thrust',
    still: true,
    durationS: 0.95, windupFrac: 0.16, strikeFrac: 0.28,
    poses: {
      neutral: { ...smallHeldNeutral },
      windup: { ...smallHeldNeutral },
      strike: { ...smallHeldNeutral },
    },
  };


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
        x: -0.04, y: 0.29, z: -0.1, pitch: 47, yaw: 107, bodyYaw: -55, roll: 88, // Authored thrown-weapon idle stance (Spin Throw); also the held flask's idle.
        shoulderAim: { grip: true, palmNormal: true },
        secondaryGrip: { enabled: false, percent: 50, primaryPercent: 50 },
        dualWield: { enabled: true },
      },
      windup: {
        x: 0.41, y: 0.37, z: 0.42, pitch: -180, yaw: 139, bodyYaw: -152, roll: -92,
        shoulderAim: { grip: false, palmNormal: true },
        secondaryGrip: { enabled: true, percent: 50, primaryPercent: 50 },
        dualWield: { enabled: true },
      },
      strike: {
        x: -0.57, y: 0.33, z: 0.17, pitch: -25, yaw: -65, bodyYaw: 63, roll: -88,
        shoulderAim: { grip: false, palmNormal: true },
        secondaryGrip: { enabled: true, percent: 50, primaryPercent: 50 },
        dualWield: { enabled: true },
      },
    },
  };

  const throwFlask = weaponThrowSpin; // Throwing-flask necks are handles: every flask throw intentionally reuses the exact hatchet/dagger/Kylie spin throw.

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
      neutral: { ...weaponThrowSpin.poses.neutral, x: -0.12, y: 0.2, z: 0, pitch: -10, yaw: 167, bodyYaw: -62, roll: 75, shoulderAim: { ...weaponThrowSpin.poses.neutral.shoulderAim }, secondaryGrip: { ...weaponThrowSpin.poses.neutral.secondaryGrip } },
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
      neutral: { x: 0, y: 0, z: 0.16, pitch: 0, yaw: 0, roll: 180, bodyYaw: 0, secondaryGrip: { enabled: false, percent: 50, primaryPercent: 50 }, dualWield: { enabled: true } },
      windup: { x: 0, y: 0.05, z: 0.30, pitch: 14, yaw: 0, roll: 180, bodyYaw: -20, secondaryGrip: { enabled: true, percent: 50, primaryPercent: 50 }, dualWield: { enabled: true } },
      strike: { x: 0, y: 0.05, z: 0.30, pitch: 14, yaw: 0, roll: 180, bodyYaw: -20, secondaryGrip: { enabled: true, percent: 50, primaryPercent: 50 }, dualWield: { enabled: true } },
    },
  };

  // Still two-handed carry for large inventory items (furniture, livestock, buildings...).
  // Same origin as Drink (hand anchor + pose offset): x lifts the item back to body centre,
  // y matches the old chest height, z pushes it farther out from the chest than the old 0.1.
  // Both hands grip the item's left and right edges. Small handheld items use Drink's neutral.
  const heldItemLarge = {
    version: 1,
    kind: 'hobunji_held_action_animation',
    name: 'Large Held Item (two-hand)',
    style: 'drink',
    durationS: 0.95,
    windupFrac: 0.38,
    strikeFrac: 0.62,
    holdFrac: 0.78,
    poses: {
      neutral: { x: 0.45, y: 0.19, z: 0.32, pitch: 0, yaw: 0, roll: 0, bodyYaw: 0, shoulderAim: { grip: true, palmNormal: true }, secondaryGrip: { enabled: true, percent: 50, primaryPercent: 50 } },
      windup: { x: 0.45, y: 0.19, z: 0.32, pitch: 0, yaw: 0, roll: 0, bodyYaw: 0, shoulderAim: { grip: true, palmNormal: true }, secondaryGrip: { enabled: true, percent: 50, primaryPercent: 50 } },
      strike: { x: 0.45, y: 0.19, z: 0.32, pitch: 0, yaw: 0, roll: 0, bodyYaw: 0, shoulderAim: { grip: true, palmNormal: true }, secondaryGrip: { enabled: true, percent: 50, primaryPercent: 50 } },
    },
  };

  const blowgunReady = {
    "version": 1,
    "kind": "hobunji_attack_animation",
    "name": "B'shuakauitl — Loaded",
    "style": "ranged",
    "sequence": "attack",
    "windupFrac": 0.38,
    "strikeFrac": 0.62,
    "holdFrac": 0.78,
    "durationS": 0.95,
    "headRelative": true, // Head-anchored: x/y/z are the B'shuakauitl's aperture (mouthpiece end) measured from the species mouth point, in the head's frame; 0 seats the mouthpiece exactly on the mouth.
    "toolEndFlip": false,
    // The mouth anchors the aperture AND the barrel direction. -180° pitch aims the shaft out from the face; no independent yaw offsets the shot from the head.
    "poses": {
      "neutral": {
        "x": 0,
        "y": 0,
        "z": 0,
        "pitch": -180,
        "yaw": 0,
        "roll": 4,
        "bodyYaw": 0,
        "scale": 1.3,
        "headRelative": true,
        "shoulderAim": {
          "grip": false,
          "palmNormal": true
        },
        "secondaryGrip": {
          "enabled": false,
          "percent": 50,
          "primaryPercent": 50
        },
        "dualWield": {
          "enabled": false
        }
      },
      "windup": {
        "headRelative": true,
        "x": 0,
        "y": 0,
        "z": 0,
        "pitch": -180,
        "yaw": 0,
        "roll": 0,
        "bodyYaw": 0,
        "shoulderAim": {
          "grip": false,
          "palmNormal": true
        },
        "scale": 1.3,
        "secondaryGrip": {
          "enabled": false,
          "percent": 50,
          "primaryPercent": 50
        },
        "dualWield": {
          "enabled": false
        }
      },
      "strike": {
        "headRelative": true,
        "x": 0,
        "y": 0,
        "z": 0,
        "pitch": -180,
        "yaw": 0,
        "roll": 4,
        "bodyYaw": 0,
        "shoulderAim": {
          "grip": false,
          "palmNormal": true
        },
        "scale": 1.3,
        "secondaryGrip": {
          "enabled": false,
          "percent": 50,
          "primaryPercent": 50
        },
        "dualWield": {
          "enabled": false
        }
      }
    },
    "gripMode": "palm-parallel"
  }; // Authored loaded/fire animation; independent from Drink.
  window.HeldActionAnimations = Object.freeze({ blowgunReady, drink, heldItemSmall, heldItemLarge, throwFlask, weaponThrowSpin, weaponThrowSpearSpin, counterShield });

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
  const isEnemyLoadoutEditor = /\/tools\/enemy-loadout-editor\/(?:index\.html)?$/.test(location.pathname);
  const isAnimationAuthor = /\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname);

  // The Attack Animation Editor consumes this shared object directly through
  // its Action registry. Editor-specific DOM injection would create a second
  // source of truth, so this library deliberately does nothing there.
  if (isAttackEditor) {
    // The Attack Animation Editor now reads HeldActionAnimations directly through
    // its unified Action registry. Do not inject options, synthesize DOM events,
    // or maintain a second editor state bridge here.
  } else if (!isAnimationAuthor && !isEnemyLoadoutEditor) {
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
    new URL('js/hand-tool-grips.js?v=20261030flailgrip1', docsBase).href,
    new URL('js/hand-tool-grip-authored-overrides.js?v=20261022hbc21c80', docsBase).href, // Must follow hand-tool-grips.js: migrates authored spear/bshuakauitl grips onto its live data.
    new URL('js/dual-wield-weapon-visuals.js?v=20261029h0c274fa', docsBase).href,
    new URL('js/hand-grip-modes.js?v=20261005h2e47f31', docsBase).href,
    new URL('js/hand-shoulder-pose-runtime.js?v=20261028hfirearmsync1', docsBase).href,
    new URL('js/portrait-arm-cloud-mask.js?v=20261005h2d40d1a', docsBase).href,
    new URL('js/portrait-hand-shoulder-scan.js?v=20260818c', docsBase).href,
    new URL('js/portrait-hand-shoulder-scan-species.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-attachments.js?v=20261019h0cfa905', docsBase).href,
    new URL('js/procedural-hand-outline-parity.js?v=20261016h5318a2d', docsBase).href,
    new URL('js/attachment-rig-latest-authored-snapshot.js?v=20261029maskSlots2', docsBase).href,
    new URL('js/procedural-hand-scale-free-world.js?v=20261017h3921033', docsBase).href,
    new URL('js/procedural-hand-shoulder-aim.js?v=20261025h7c7ee63', docsBase).href,
    new URL('js/procedural-hand-frame-driver.js?v=20261029hf430830', docsBase).href,
  ];
  if (isAttackEditor) {
    // The editor starts its first avatar rebuild immediately after these parser-time
    // scripts. Repair the shared NpcAvatarPreview dependency before any hand/editor
    // adapters run so a missed/cached helper request cannot strand the preview.
    handScripts.push(new URL('js/attack-editor-npc-preview-guard.js?v=20261029maskSlots2', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-configurator.js?v=20260919handreview1', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-inverse-configurator.js?v=20260919handreview1', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-mirror-toggle.js?v=20260817a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-grip-mode.js?v=20261005hce195f1', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-direct-attachments.js?v=20261001c0bd7bbe', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-shoulder-controls.js?v=20261025h6a95a6d', docsBase).href);
    handScripts.push(new URL('js/attack-editor-idle-hand-parity.js?v=20261019h611c43d', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-state-coherence.js?v=20260919handreview1', docsBase).href);
    handScripts.push(new URL('js/attack-editor-history.js?v=20260919history1', docsBase).href); // Loaded last so Undo/Redo can snapshot every hand/grip extension plus the core module once it initializes.
  } else if (!isAnimationAuthor && !isEnemyLoadoutEditor) {
    handScripts.push(new URL('js/procedural-hand-grip-runtime.js?v=20260918throwcharge3', docsBase).href);
    handScripts.push(new URL('js/weapon-idle-body-yaw-runtime.js?v=20260915perf1', docsBase).href);
    handScripts.push(new URL('js/crossbow-strike-audio-trim.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/weapon-png-scale.js?v=20260902c', docsBase).href);
    handScripts.push(new URL('js/hand-pixel-probe-diagnostics.js?v=20261016ha981d6f', docsBase).href);
  }

  function loadSequentially(urls) {
    return urls.reduce((promise, src) => promise.then(() => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        const nested = /\/attachment-rig-latest-authored-snapshot\.js(?:[?#]|$)/.test(src) ? window.HobunjiLatestAuthoredRigReady : null;
        Promise.resolve(nested).then(resolve, reject); // Dynamic tools must wait for species/mount wrappers before the hand driver wraps PNGPlaneAvatar.
      };
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