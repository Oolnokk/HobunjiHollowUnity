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
      neutral: { x: 0, y: 0, z: -0.05, pitch: 10.31, yaw: 0, roll: 0, bodyYaw: 0, shoulderAim: { pitch: true, yaw: false, roll: true } },
      windup: { x: 0.32, y: 0.21, z: 0.1, pitch: -114, yaw: 18, roll: -8, bodyYaw: 0, shoulderAim: { pitch: false, yaw: false, roll: true } },
      strike: { x: 0.4, y: 0.4, z: 0.22, pitch: -180, yaw: 21, roll: 4, bodyYaw: 0, shoulderAim: { pitch: false, yaw: false, roll: true } },
    },
  };

  window.HeldActionAnimations = Object.freeze({ drink });

  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('./', location.href);
  const isAttackEditor = /\/tools\/attack-animation-editor\/(?:index\.html)?$/.test(location.pathname);
  const handScripts = [
    new URL('config/hand-model-profiles.js?v=20260819b', docsBase).href,
    new URL('config/hand-shoulder-points.js?v=20260818b', docsBase).href,
    new URL('config/hand-shoulder-pose-profiles.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-foot-material-roles.js?v=20260818b', docsBase).href,
    new URL('js/hand-tool-grips.js?v=20260819c', docsBase).href,
    new URL('js/hand-tool-semantic-basis.js?v=20260819a', docsBase).href,
    new URL('js/hand-grip-modes.js?v=20260819b', docsBase).href,
    new URL('js/hand-experimental-rig-settings.js?v=20260819b', docsBase).href,
    new URL('js/hand-shoulder-pose-runtime.js?v=20260819a', docsBase).href,
    new URL('js/portrait-arm-cloud-mask.js?v=20260819b', docsBase).href,
    new URL('js/portrait-hand-shoulder-scan.js?v=20260818c', docsBase).href,
    new URL('js/portrait-hand-shoulder-scan-species.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-attachments.js?v=20260818a', docsBase).href,
    new URL('js/procedural-hand-pair-mirror.js?v=20260819c', docsBase).href,
    new URL('js/procedural-hand-outline-parity.js?v=20260818c', docsBase).href,
    new URL('js/procedural-hand-scale-free-world.js?v=20260819a', docsBase).href,
    new URL('js/procedural-hand-skinned-held-registration.js?v=20260819a', docsBase).href,
    new URL('js/procedural-hand-two-bone-skin.js?v=20260819c', docsBase).href,
    new URL('js/procedural-hand-skinned-outline.js?v=20260819d', docsBase).href,
    new URL('js/procedural-hand-shoulder-aim.js?v=20260819e', docsBase).href,
    new URL('js/procedural-hand-frame-driver.js?v=20260819f', docsBase).href,
    new URL('js/procedural-hand-lifecycle-guard.js?v=20260819a', docsBase).href,
  ];
  if (isAttackEditor) {
    handScripts.push(new URL('js/attack-editor-npc-preview-guard.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-configurator.js?v=20260817a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-inverse-configurator.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-mirror-toggle.js?v=20260819c', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-grip-mode.js?v=20260819b', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-direct-attachments.js?v=20260819b', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-shoulder-controls.js?v=20260819b', docsBase).href);
    handScripts.push(new URL('js/attack-editor-idle-hand-parity.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-shoulder-animation-state.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-forearm-rig.js?v=20260819c', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-state-coherence.js?v=20260819e', docsBase).href);
    handScripts.push(new URL('js/attack-editor-animation-state-guard.js?v=20260819b', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-initialization-guard.js?v=20260819a', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-tool-closeup.js?v=20260819c', docsBase).href);
    handScripts.push(new URL('js/attack-editor-hand-tool-basis-author.js?v=20260819a', docsBase).href);
  } else {
    handScripts.push(new URL('js/procedural-hand-grip-runtime.js?v=20260819a', docsBase).href);
    handScripts.push(new URL('js/weapon-idle-body-yaw-runtime.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/crossbow-strike-audio-trim.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/weapon-png-scale.js?v=20260818a', docsBase).href);
    handScripts.push(new URL('js/hand-pixel-probe-diagnostics.js?v=20260819d', docsBase).href);
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