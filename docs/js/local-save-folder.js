// Compatibility loader: persistence core + default save/load UX flow.
// Kept at the historical path so existing pages do not need to change script order.
document.write('<style>#localSaveStartupGate{font-family:"KhymeryyanRomanLetters+Numbers","DM Mono",ui-monospace,monospace!important}</style>');
document.write('<script src="js/save-snapshot-core.js?v=20260904a"><\/script>');
document.write('<script src="js/local-save-folder-core.js?v=20260812a"><\/script>');
document.write('<script src="js/netlify-cloud-save.js?v=20260904a"><\/script>');
document.write('<script src="js/local-save-flow.js?v=20260812a"><\/script>');
document.write('<script src="js/save-startup-gate.js?v=20260904a"><\/script>');

// Harugasirri is visual-only, so it must not participate in BorderTerrain's
// parser-time accessor/setter chain. Load it once normal game bootstrap is
// complete; it then patches the already-existing BorderTerrain API and attaches
// directly to the currently-active scene. This also means any failure is visible
// through the normal in-menu debug logger instead of occurring before it.
(function loadHarugasirriAfterGameBoot() {
  const log = (message, level = 'info', category = 'world') => {
    if (typeof window.__farmLog === 'function') window.__farmLog(`[HarugasirriLoader] ${message}`, level, category);
    else if (level === 'warn' || level === 'error') console.warn(`[HarugasirriLoader] ${message}`);
  };

  const load = () => {
    if (window.HarugasirriSuperBackdrop) return;
    log('normal game bootstrap complete; loading distant-terrain module now.');
    const script = document.createElement('script'); // Used once to load the visual backdrop after parser-time game bootstrap.
    script.src = 'js/harugasirri-superbackdrop.js?v=20260906g';
    script.async = false;
    script.onload = () => {
      try {
        const scene = window.GridTileAccessors?.getActiveScene?.(); // Current scene receives the backdrop because the farm border build already happened before this late-safe loader.
        if (scene) window.HarugasirriSuperBackdrop?.attach?.(scene, 'active_boot_scene');
        else log('module loaded, but no active scene was available for the initial attach.', 'warn');

        // Harugasirri's own town wrapper normally captures BorderTerrain.init
        // deps. A late-safe load intentionally happens after init, so provide a
        // one-time fallback wrapper that resolves the active scene instead.
        const border = window.BorderTerrain; // Existing already-initialized API whose town builder needs the late-load scene fallback.
        if (border?.buildTownBorderTerrain && !border.__harugasirriLateTownFallback) {
          const originalTownBuild = border.buildTownBorderTerrain;
          border.buildTownBorderTerrain = function (...args) {
            const result = originalTownBuild.apply(this, args);
            try {
              const townScene = window.GridTileAccessors?.getActiveScene?.();
              if (townScene) window.HarugasirriSuperBackdrop?.attach?.(townScene, 'map_hobunji_town');
            } catch (error) {
              log(`late town attach failed: ${error?.message || error}`, 'warn');
            }
            return result;
          };
          border.__harugasirriLateTownFallback = true;
        }
        log('safe late loader armed; parser-time BorderTerrain was left untouched.');
      } catch (error) {
        log(`late loader attach failed: ${error?.message || error}`, 'error');
      }
    };
    script.onerror = () => log('script failed to load.', 'error', 'assets');
    document.head.appendChild(script);
  };

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', load, { once: true });
  else load();
})();
