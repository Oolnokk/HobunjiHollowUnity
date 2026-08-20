// Attack Animation Editor dependency guard for the shared NPC portrait preview API.
//
// The editor's core module starts rebuilding its default avatar immediately. If the
// parser-blocking npc-avatar-preview-utils.js request was missed, cached incorrectly,
// or otherwise failed before the module starts, that used to surface only as
// "Cannot read properties of undefined (reading 'ensurePortraitCosmetics')" and the
// avatar never recovered. Keep the shared adapter itself single-purpose and repair
// only this editor dependency here.
(function (global) {
  'use strict';

  if (global.NpcAvatarPreview?.ensurePortraitCosmetics) return;
  if (global.__hobunjiAttackEditorNpcPreviewGuard) return;
  global.__hobunjiAttackEditorNpcPreviewGuard = true;

  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('../../', location.href);
  const adapterUrl = new URL('js/npc-avatar-preview-utils.js?v=20260818-repair1', docsBase).href;
  const prior = global.NpcAvatarPreview && typeof global.NpcAvatarPreview === 'object'
    ? global.NpcAvatarPreview
    : null;
  let loadPromise = null;
  let proxy = null;

  function adapterReady(api) {
    return !!api && api !== proxy && typeof api.ensurePortraitCosmetics === 'function';
  }

  function loadAdapter() {
    if (adapterReady(global.NpcAvatarPreview)) return Promise.resolve(global.NpcAvatarPreview);
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = adapterUrl;
      script.async = false;
      script.onload = () => {
        const api = global.NpcAvatarPreview;
        if (!adapterReady(api)) {
          reject(new Error('npc-avatar-preview-utils.js loaded but did not expose NpcAvatarPreview'));
          return;
        }
        console.info('[attack-editor] recovered NpcAvatarPreview dependency');
        resolve(api);
      };
      script.onerror = () => reject(new Error(`Failed to load ${adapterUrl}`));
      document.head.appendChild(script);
    });
    return loadPromise;
  }

  proxy = {
    ...(prior || {}),
    __hobunjiRecoveryProxy: true,
    ensurePortraitCosmetics(paths) {
      return loadAdapter().then(api => api.ensurePortraitCosmetics(paths));
    },
  };
  global.NpcAvatarPreview = proxy;
})(window);
