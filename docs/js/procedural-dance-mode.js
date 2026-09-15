// Procedural Animation Editor bootstrap: load the shared authored joint-anchor parity
// first, then run the preserved Dance/feet/idle-hands adapter. Keeping this tiny
// wrapper means the editor and gameplay consume the same posterior/shoulder rules
// without duplicating them into the giant authoring HTML.
// `procedural-dance-mode-base.js` remains the owner of `procedural-editor-idle-arm-parity.js`;
// this wrapper only guarantees that joint/profile parity is installed before that chain.
(() => {
  'use strict';
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const base = selfUrl ? new URL('./', selfUrl) : new URL('../../js/', location.href);
  const queue = [
    ['proceduralEditorJointMotionParityScript', new URL('character-joint-motion-parity.js?v=20260915joint1', base).href],
    ['proceduralDanceModeBaseScript', new URL('procedural-dance-mode-base.js?v=20260915joint1', base).href],
  ];

  function log(message, level = 'info', extra = null) {
    const editorLog = window.HobunjiGameplayBackdrop?.log;
    if (editorLog) { editorLog(message, level, extra); return; }
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    fn(message, extra ?? '');
  }

  const loadOne = ([id, src]) => new Promise((resolve, reject) => {
    if ((id === 'proceduralEditorJointMotionParityScript' && window.HobunjiCharacterJointMotionParity?.installed)
      || (id === 'proceduralDanceModeBaseScript' && window.HobunjiEditorDanceGeneratedFeet)) return resolve();
    const existing = document.getElementById(id);
    if (existing?.dataset.loaded === 'true') return resolve();
    const script = existing || document.createElement('script');
    script.id = id;
    script.async = false;
    script.src = src;
    script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    if (!existing) document.head.appendChild(script);
  });

  queue.reduce((promise, entry) => promise.then(() => loadOne(entry)), Promise.resolve())
    .then(() => {
      log('[Joint anchors] Procedural Dance bootstrap loaded shared posterior hips + authored dance shoulders before the editor adapters.', 'info', {
        jointParityInstalled: !!window.HobunjiCharacterJointMotionParity?.installed,
        maoAoMaleShoulderSanity: window.HobunjiCharacterJointMotionParity?.maoAoShoulderSanity?.('male') || null,
      });
    })
    .catch(error => log(`[Joint anchors] Procedural Dance bootstrap failed: ${error.message}`, 'error'));
})();