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

  window.HeldActionAnimations = Object.freeze({ drink });

  // Shared direct-hand bootstrap. There are no arm bones, IK, reach clamps, or
  // rotating arm sprites. Shoulder coordinates are either manually authored in
  // Animation Author or resolved by the raw-arm main-mass fallback. Per-pose axis
  // weights then blend smoothly with the same pose timeline as the held item.
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('./', location.href);
  const isAttackEditor = /\/tools\/attack-animation-editor\/(?:index\.html)?$/.test(location.pathname);
  const handScripts = [
    new URL('config/hand-model-profiles.js?v=20260818f', docsBase).href,
    new URL('config/hand-shoulder-points.js?v=20260818b', docsBase).href,
    new URL('config/hand-shoulder-pose-profiles.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-foot-material-roles.js?v=20260818b', docsBase).href,
    new URL('js/hand-tool-grips.js?v=20260818a', docsBase).href,
    new URL('js/hand-grip-modes.js?v=20260818c', docsBase).href,
    new URL('js/hand-shoulder-pose-runtime.js?v=20260818c', docsBase).href,
    new URL('js/portrait-arm-cloud-mask.js?v=20260817a', docsBase).href,
    new URL('js/portrait-hand-shoulder-scan.js?v=20260818c', docsBase).href,
    new URL('js/portrait-hand-shoulder-scan-species.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-attachments.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-scale-free-world.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-shoulder-aim.js?v=20260818d', docsBase).href,
    new URL('js/procedural-hand-frame-driver.js?v=20260818g', docsBase).href,
  ];
  if (isAttackEditor) {
    // The editor starts its first avatar rebuild immediately after these parser-time
    // scripts. Repair the shared NpcAvatarPreview dependency before any hand/editor
    // adapters run so a missed/cached helper request cannot strand the preview.
    handScripts.push(new URL('js/attack-editor-npc-preview-guard.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-configurator.js?v=20260817a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-inverse-configurator.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-mirror-toggle.js?v=20260817a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-grip-mode.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-direct-attachments.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-shoulder-controls.js?v=20260818c', docsBase).href);
    handScripts.push(new URL('js/attack-editor-idle-hand-parity.js?v=20260818a', docsBase).href);
  } else {
    handScripts.push(new URL('js/procedural-hand-grip-runtime.js?v=20260817a', docsBase).href);
    handScripts.push(new URL('js/crossbow-strike-audio-trim.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/weapon-png-scale.js?v=20260818a', docsBase).href);
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

  if (document.readyState === 'loading' && document.currentScript) {
    for (const src of handScripts) document.write(`<script src="${src}"><\/script>`);
  } else {
    loadSequentially(handScripts).catch(error => console.warn('[hands] bootstrap failed:', error));
  }
})();
