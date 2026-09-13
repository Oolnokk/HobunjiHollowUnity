// Compatibility loader: persistence core + default save/load UX flow.
// Kept at the historical path so existing pages do not need to change script order.
document.write('<style>#localSaveStartupGate{font-family:"KhymeryyanRomanLetters+Numbers","DM Mono",ui-monospace,monospace!important}</style>');
document.write('<script src="js/save-snapshot-core.js?v=20260904a"><\/script>');
document.write('<script src="js/local-save-folder-core.js?v=20260812a"><\/script>');
document.write('<script src="js/netlify-cloud-save.js?v=20260904a"><\/script>');
document.write('<script src="js/local-save-flow.js?v=20260812a"><\/script>');
document.write('<script src="js/save-startup-gate.js?v=20260910review1"><\/script>');

// loading-screen-runtime.js now owns sky startup and stacking. This parser-time
// load is only a prewarm for historical entry paths; loader correctness does not
// depend on this compatibility file successfully installing the sky.
document.write('<script src="js/loading-screen-sky-backdrop.js?v=20260913e"><\/script>');

window.addEventListener('DOMContentLoaded', () => {
  if (window.LoadingScreenSkyBackdrop?.installed || window.LoadingScreenRuntime?.ensureSkyBackdropLoaded) return;
  if (document.querySelector('script[data-loading-sky-retry]')) return;
  const script = document.createElement('script');
  script.src = 'js/loading-screen-sky-backdrop.js?v=20260913e';
  script.async = false;
  script.dataset.loadingSkyRetry = '1';
  (document.head || document.documentElement).appendChild(script);
}, { once: true });
