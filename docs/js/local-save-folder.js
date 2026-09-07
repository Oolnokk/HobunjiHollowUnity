// Compatibility loader: persistence core + default save/load UX flow.
// Kept at the historical path so existing pages do not need to change script order.
document.write('<style>#localSaveStartupGate{font-family:"KhymeryyanRomanLetters+Numbers","DM Mono",ui-monospace,monospace!important}</style>');
document.write('<script src="js/save-snapshot-core.js?v=20260904a"><\/script>');
document.write('<script src="js/local-save-folder-core.js?v=20260812a"><\/script>');
document.write('<script src="js/netlify-cloud-save.js?v=20260904a"><\/script>');
document.write('<script src="js/local-save-flow.js?v=20260812a"><\/script>');
document.write('<script src="js/save-startup-gate.js?v=20260904a"><\/script>');
document.write('<script src="js/manual-cache-snapshot-copy.js?v=20260907a"><\/script>');

// Harugasirri remains visual-only and loads after normal parser bootstrap.
// Scene readiness is not tied to DOMContentLoaded or even GridTileAccessors.init:
// the accessor deps can be installed before the actual Three.js scene exists.
// Arm a one-shot wrapper around getActiveScene instead. The first real scene
// returned is handed to the backdrop runtime, then the wrapper restores itself
// after a successful attach. No timers, intervals, or per-frame Harugasirri work.
(function loadHarugasirriAfterGameBoot() {
  const log = (message, level = 'info', category = 'world') => {
    if (typeof window.__farmLog === 'function') window.__farmLog(`[HarugasirriLoader] ${message}`, level, category);
    else if (level === 'warn' || level === 'error') console.warn(`[HarugasirriLoader] ${message}`);
  };

  const appendScript = (src, onload) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = onload;
    script.onerror = () => log(`script failed to load: ${src}`, 'error', 'assets');
    document.head.appendChild(script);
    return script;
  };

  let attachedBootScene = false;
  let attachInFlight = null;
  let activeSceneHook = null;
  const attemptedScenes = new WeakSet();

  function restoreActiveSceneHook() {
    const hook = activeSceneHook;
    if (!hook) return;
    if (hook.accessors.getActiveScene === hook.wrapped) hook.accessors.getActiveScene = hook.original;
    activeSceneHook = null;
  }

  function requestAttach(scene, reason) {
    if (!scene || attachedBootScene || !window.HarugasirriSuperBackdrop?.attach) return Promise.resolve(attachedBootScene);
    if (attemptedScenes.has(scene)) return attachInFlight || Promise.resolve(false);
    attemptedScenes.add(scene);
    log(`active scene found through ${reason}; requesting backdrop attach.`);
    attachInFlight = Promise.resolve(window.HarugasirriSuperBackdrop.attach(scene, 'active_boot_scene'))
      .then(group => {
        attachInFlight = null;
        if (!group) {
          log(`backdrop attach returned no group through ${reason}; runtime debug state will contain the failure.`, 'warn', 'assets');
          return false;
        }
        // Directly register the group that actually attached. This avoids
        // depending on Scene.prototype.add interception: some outdoor map
        // roots are intermediate Object3D/Group containers even though
        // GridTileAccessors correctly treats them as the active render root.
        window.HarugasirriCullRange?.armScene?.(group);
        attachedBootScene = true;
        restoreActiveSceneHook();
        log(`backdrop attached through ${reason}.`);
        return true;
      })
      .catch(error => {
        attachInFlight = null;
        log(`backdrop attach rejected through ${reason}: ${error?.message || error}`, 'error', 'assets');
        return false;
      });
    return attachInFlight;
  }

  function armActiveSceneHook() {
    const accessors = window.GridTileAccessors;
    if (!accessors?.getActiveScene || activeSceneHook || attachedBootScene) return false;
    const original = accessors.getActiveScene;
    function wrapped(...args) {
      const scene = original.apply(this, args);
      if (scene && !attachedBootScene) requestAttach(scene, 'first successful getActiveScene()');
      return scene;
    }
    accessors.getActiveScene = wrapped;
    activeSceneHook = { accessors, original, wrapped };
    return true;
  }

  function tryCurrentScene(reason) {
    if (attachedBootScene || !window.GridTileAccessors?.getActiveScene) return false;
    try {
      const scene = window.GridTileAccessors.getActiveScene();
      if (!scene) return false;
      requestAttach(scene, reason);
      return true;
    } catch (error) {
      log(`scene not ready through ${reason}: ${error?.message || error}`, 'info');
      return false;
    }
  }

  function armGridAccessorInitHook() {
    const accessors = window.GridTileAccessors;
    if (!accessors?.init || accessors.__harugasirriSceneReadyHook) return false;
    const originalInit = accessors.init;
    accessors.init = function (...args) {
      const result = originalInit.apply(this, args);
      armActiveSceneHook();
      tryCurrentScene('GridTileAccessors.init');
      return result;
    };
    Object.defineProperty(accessors, '__harugasirriSceneReadyHook', { value: true, configurable: true });
    return true;
  }

  function runtimeReady() {
    armGridAccessorInitHook();
    armActiveSceneHook();
    const attachedOrRequested = tryCurrentScene('runtime load');
    if (!attachedOrRequested) log('runtime armed; the first real active scene will trigger the backdrop attach.');
    log('safe late loader armed; no scene polling was added.');
  }

  const loadRuntime = () => {
    if (window.HarugasirriSuperBackdrop) { runtimeReady(); return; }
    appendScript('js/harugasirri-superbackdrop-runtime.js?v=20260907b', runtimeReady);
  };

  const loadCullRange = () => {
    if (window.HarugasirriCullRange) { loadRuntime(); return; }
    appendScript('js/harugasirri-cull-range.js?v=20260907d', loadRuntime);
  };

  const load = () => {
    log('normal parser bootstrap complete; loading Harugasirri transform + render-order/cull-range + distant-terrain runtime now.');
    if (window.HarugasirriTransform) loadCullRange();
    else appendScript('js/harugasirri-transform.js?v=20260906a', loadCullRange);
  };

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', load, { once: true });
  else load();
})();
