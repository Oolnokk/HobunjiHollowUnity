// Compatibility loader: persistence core + default save/load UX flow.
// Kept at the historical path so existing pages do not need to change script order.
document.write('<style>#localSaveStartupGate{font-family:"KhymeryyanRomanLetters+Numbers","DM Mono",ui-monospace,monospace!important}</style>');
document.write('<script src="js/save-snapshot-core.js?v=20260904a"><\/script>');
document.write('<script src="js/local-save-folder-core.js?v=20260812a"><\/script>');
document.write('<script src="js/netlify-cloud-save.js?v=20260904a"><\/script>');
document.write('<script src="js/local-save-flow.js?v=20260812a"><\/script>');
document.write('<script src="js/save-startup-gate.js?v=20260904a"><\/script>');

// Harugasirri remains visual-only and loads after normal parser bootstrap. The
// game can keep GridTileAccessors uninitialized until later startup work has
// finished, though, so DOMContentLoaded alone is not a reliable scene-ready
// signal. We therefore arm one event-like hook on GridTileAccessors.init and
// attach immediately after its real deps are installed. No frame loop/polling.
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
  function tryAttachActiveScene(reason) {
    if (attachedBootScene || !window.HarugasirriSuperBackdrop) return attachedBootScene;
    try {
      const accessors = window.GridTileAccessors;
      if (!accessors?.getActiveScene) return false;
      const scene = accessors.getActiveScene();
      if (!scene) return false;
      attachedBootScene = true;
      window.HarugasirriSuperBackdrop.attach?.(scene, 'active_boot_scene');
      log(`attached through ${reason}; active scene is ready.`);
      return true;
    } catch (error) {
      // Most importantly, this is expected while GridTileAccessors exists but
      // its injected deps are still null. Its init hook below will retry once,
      // at the exact point those deps become valid.
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
      tryAttachActiveScene('GridTileAccessors.init');
      return result;
    };
    Object.defineProperty(accessors, '__harugasirriSceneReadyHook', { value: true, configurable: true });
    return true;
  }

  function runtimeReady() {
    armGridAccessorInitHook();
    // Covers the opposite ordering: if GridTileAccessors was already initialized
    // before the late visual runtime finished loading, attach right now.
    const attached = tryAttachActiveScene('runtime load');
    if (!attached) log('runtime armed; waiting for GridTileAccessors.init before first scene attach.');
    log('safe late loader armed; parser-time BorderTerrain was left untouched.');
  }

  const loadRuntime = () => {
    if (window.HarugasirriSuperBackdrop) { runtimeReady(); return; }
    appendScript('js/harugasirri-superbackdrop-runtime.js?v=20260906b', runtimeReady);
  };

  const load = () => {
    log('normal parser bootstrap complete; loading Harugasirri transform + distant-terrain runtime now.');
    if (window.HarugasirriTransform) loadRuntime();
    else appendScript('js/harugasirri-transform.js?v=20260906a', loadRuntime);
  };

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', load, { once: true });
  else load();
})();
