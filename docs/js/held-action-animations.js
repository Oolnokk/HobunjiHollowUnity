// Shared authored poses for held-item actions. The game runtime and the
// Tool / Attack Animation Editor both read this object so their defaults do
// not drift; an editor export can be copied back here after visual tuning.
(() => {
  'use strict';

  // Used by the runtime's drink playback and the editor's Drink preset.
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
      neutral: { x: 0, y: 0, z: -0.05, pitch: 10.31, yaw: 0, roll: 0, bodyYaw: 0 },
      windup: { x: 0.32, y: 0.21, z: 0.1, pitch: -114, yaw: 18, roll: -8, bodyYaw: 0 },
      strike: { x: 0.4, y: 0.4, z: 0.22, pitch: -180, yaw: 21, roll: 4, bodyYaw: 0 },
    },
  };

  window.HeldActionAnimations = Object.freeze({ drink });

  // This shared file is already parser-loaded immediately after PNGPlaneAvatar
  // in both gameplay and the Attack Animation Editor. Keep hand bootstrapping
  // here so the hand feature no longer needs conflict-prone script-tag edits in
  // docs/index.html or the editor's large inline module.
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('./', location.href);
  const isAttackEditor = /\/tools\/attack-animation-editor\/(?:index\.html)?$/.test(location.pathname);
  const handScripts = [
    new URL('config/hand-model-profiles.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-foot-material-roles.js?v=20260818a', docsBase).href,
    new URL('js/hand-grip-modes.js?v=20260817a', docsBase).href,
    new URL('js/arm-bones.js?v=20260817c', docsBase).href,
    new URL('js/portrait-arm-cloud-mask.js?v=20260817a', docsBase).href,
    new URL('js/procedural-arm-animation.js?v=20260817c', docsBase).href,
    new URL('js/procedural-hand-double-side.js?v=20260817a', docsBase).href,
    new URL('js/procedural-hand-model-mirror.js?v=20260817a', docsBase).href,
    new URL('js/procedural-hand-medial-wrists.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-portrait-shoulders.js?v=20260817a', docsBase).href,
    new URL('js/procedural-arm-portrait-biceps.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-forearm-follow.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-arm-length.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-frame-driver.js?v=20260817c', docsBase).href,
    new URL('js/procedural-hand-frame-driver-owner.js?v=20260817a', docsBase).href,
  ];
  if (isAttackEditor) {
    handScripts.push(new URL('js/attack-editor-hand-configurator.js?v=20260817a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-inverse-configurator.js?v=20260817b', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-mirror-toggle.js?v=20260817a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-grip-mode.js?v=20260817b', docsBase).href);
  } else {
    handScripts.push(new URL('js/procedural-hand-grip-runtime.js?v=20260817a', docsBase).href);
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
