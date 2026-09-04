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
      neutral: { x: 0, y: 0, z: -0.05, pitch: 10.31, yaw: 0, roll: 0, bodyYaw: 0, shoulderAim: { pitch: true, yaw: false, roll: true } },
      // Active endpoints deliberately retain Roll-only shoulder alignment.
      windup: { x: 0.32, y: 0.21, z: 0.1, pitch: -114, yaw: 18, roll: -8, bodyYaw: 0, shoulderAim: { pitch: false, yaw: false, roll: true } },
      strike: { x: 0.4, y: 0.4, z: 0.22, pitch: -180, yaw: 21, roll: 4, bodyYaw: 0, shoulderAim: { pitch: false, yaw: false, roll: true } },
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

  window.HeldActionAnimations = Object.freeze({ drink, throwFlask, counterShield });

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

  // The Attack Animation Editor's main logic is an ES module, so its local anim /
  // TOOL_PRESETS state is deliberately not global. Install Counter Shield through
  // the editor's public DOM controls after that module has initialized: dispatching
  // the same input/change events as a user keeps its internal animation state,
  // gizmos, JSON export, hands, timeline, and viewport all synchronized.
  if (isAttackEditor) {
    const installCounterShieldEditorPreset = () => {
      const presetSelect = document.getElementById('presetSelect');
      const loadPresetBtn = document.getElementById('loadPresetBtn');
      if (!presetSelect || !loadPresetBtn || presetSelect.querySelector('option[value="counter_shield_shared"]')) return;

      const option = document.createElement('option');
      option.value = 'counter_shield_shared';
      option.textContent = 'Counter Shield — Guard Hold';
      presetSelect.appendChild(option);

      const setControl = (id, value, eventName = 'input') => {
        const el = document.getElementById(id);
        if (!el || value == null) return;
        el.value = String(value);
        el.dispatchEvent(new Event(eventName, { bubbles: true }));
      };

      const applyCounterShield = () => {
        const a = window.HeldActionAnimations?.counterShield;
        if (!a) return;
        setControl('animName', a.name, 'input');
        setControl('animStyle', a.style, 'change');
        setControl('playbackSequence', 'attack', 'change');
        setControl('durationS', a.durationS, 'input');
        setControl('windupFrac', Math.min(0.90, a.windupFrac), 'input');
        // The editor slider intentionally tops out below 1 so a visible return
        // segment always exists. Runtime Counter Shield still holds at strike.
        setControl('strikeFrac', Math.min(0.98, a.strikeFrac), 'input');
        setControl('holdFrac', Math.min(0.99, a.holdFrac), 'input');

        for (const phase of ['neutral', 'windup', 'strike']) {
          const pose = a.poses?.[phase] || {};
          for (const key of ['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'bodyYaw']) {
            setControl(`${phase}_${key}`, pose[key], 'input');
          }
        }

        // Pose inputs scrub/pause by design; restart after bulk-loading so the
        // user immediately sees Counter Shield animate, then can scrub any pose.
        document.getElementById('resetPreviewBtn')?.click();
        const playPause = document.getElementById('playPauseBtn');
        if (playPause && /Play/i.test(playPause.textContent || '')) playPause.click();
      };

      loadPresetBtn.addEventListener('click', () => {
        if (presetSelect.value === 'counter_shield_shared') applyCounterShield();
      }, true);

      // The stats selector already contains Counter Shield. Selecting it now also
      // loads the matching animation, fixing the previous stats-only dead end.
      document.getElementById('statSlotSelect')?.addEventListener('change', event => {
        const selected = event.currentTarget?.selectedOptions?.[0];
        if (!/Counter Shield/i.test(selected?.textContent || '')) return;
        presetSelect.value = 'counter_shield_shared';
        applyCounterShield();
      });
    };

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', () => setTimeout(installCounterShieldEditorPreset, 0), { once: true });
    } else {
      setTimeout(installCounterShieldEditorPreset, 0);
    }
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
    new URL('config/hand-model-profiles.js?v=20260821e', docsBase).href,
    new URL('config/hand-shoulder-points.js?v=20260818b', docsBase).href,
    new URL('config/hand-shoulder-pose-profiles.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-foot-material-roles.js?v=20260821e', docsBase).href,
    new URL('js/hand-tool-grips.js?v=20260902c', docsBase).href,
    new URL('js/hand-grip-modes.js?v=20260818c', docsBase).href,
    new URL('js/hand-shoulder-pose-runtime.js?v=20260818c', docsBase).href,
    new URL('js/portrait-arm-cloud-mask.js?v=20260817a', docsBase).href,
    new URL('js/portrait-hand-shoulder-scan.js?v=20260818c', docsBase).href,
    new URL('js/portrait-hand-shoulder-scan-species.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-attachments.js?v=20260821g', docsBase).href,
    new URL('js/procedural-hand-outline-parity.js?v=20260821f', docsBase).href,
    new URL('js/attachment-rig-latest-authored-snapshot.js?v=20260904a', docsBase).href,
    new URL('js/procedural-hand-scale-free-world.js?v=20260904posteriorlive1', docsBase).href,
    new URL('js/procedural-hand-shoulder-aim.js?v=20260821k', docsBase).href,
    new URL('js/procedural-hand-frame-driver.js?v=20260901a', docsBase).href,
  ];
  if (isAttackEditor) {
    // The editor starts its first avatar rebuild immediately after these parser-time
    // scripts. Repair the shared NpcAvatarPreview dependency before any hand/editor
    // adapters run so a missed/cached helper request cannot strand the preview.
    handScripts.push(new URL('js/attack-editor-npc-preview-guard.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-configurator.js?v=20260817a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-inverse-configurator.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-mirror-toggle.js?v=20260817a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-grip-mode.js?v=20260819a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-direct-attachments.js?v=20260902b', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-shoulder-controls.js?v=20260818c', docsBase).href);
    handScripts.push(new URL('js/attack-editor-idle-hand-parity.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-shoulder-animation-state.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-state-coherence.js?v=20260819b', docsBase).href);
  } else if (!isAnimationAuthor) {
    handScripts.push(new URL('js/procedural-hand-grip-runtime.js?v=20260817a', docsBase).href);
    handScripts.push(new URL('js/weapon-idle-body-yaw-runtime.js?v=20260818a', docsBase).href);
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