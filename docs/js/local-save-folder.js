// Compatibility loader: persistence core + default save/load UX flow.
// Kept at the historical path so existing pages do not need to change script order.
document.write('<style>#localSaveStartupGate{font-family:"KhymeryyanRomanLetters+Numbers","DM Mono",ui-monospace,monospace!important}</style>');
document.write('<script src="js/save-snapshot-core.js?v=20260904a"><\/script>');
document.write('<script src="js/local-save-folder-core.js?v=20260812a"><\/script>');
document.write('<script src="js/netlify-cloud-save.js?v=20260904a"><\/script>');
document.write('<script src="js/local-save-flow.js?v=20260812a"><\/script>');
document.write('<script src="js/save-startup-gate.js?v=20260910review1"><\/script>');

// The loading sky has to sit above the loader root's black paint but below all
// existing foreground UI. Keep that stacking contract explicit rather than
// depending on positioned-element paint order.
document.write('<style>#hobunjiLoadScreen>#hlsSkyBackdrop{z-index:0!important}#hobunjiLoadScreen>#hlsImage,#hobunjiLoadScreen>#hlsScriptViewport,#hobunjiLoadScreen>#hlsLoreBlock,#hobunjiLoadScreen>#hlsPercent{z-index:1}#hobunjiLoadScreen>#hlsDebug,#hobunjiLoadScreen>#hlsSkyDebug{z-index:2}</style>');

// This compatibility loader is a stable parser-blocking boot slot before the loading-screen runtime.
// Load the lightweight sky backdrop here so initial boot and later map-travel loaders use the same module.
document.write('<script src="js/loading-screen-sky-backdrop.js?v=20260913b"><\/script>');

// A second, idempotent DOM-ready check protects the loader from browser/parser
// edge cases around nested document.write script insertion. The sky module has
// its own installed guard, so this only does work when the parser-blocking load
// genuinely did not install it.
window.addEventListener('DOMContentLoaded', () => {
  if (window.LoadingScreenSkyBackdrop?.installed || document.querySelector('script[data-loading-sky-retry]')) return;
  const script = document.createElement('script');
  script.src = 'js/loading-screen-sky-backdrop.js?v=20260913b';
  script.async = false;
  script.dataset.loadingSkyRetry = '1';
  (document.head || document.documentElement).appendChild(script);
}, { once: true });