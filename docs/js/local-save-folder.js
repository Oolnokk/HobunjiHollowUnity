// Compatibility loader: persistence core + default save/load UX flow.
// Kept at the historical path so existing pages do not need to change script order.
// Preload the loading percentage's Roman face under its own alias. The percent is
// hidden until this face settles so it never flashes in a generic browser font.
document.write('<style>@font-face{font-family:"HobunjiLoadingPercentRoman";src:url("assets/hud/KhymeryyanRomanLetters+Numbers.otf.ttf") format("truetype");font-display:block}#localSaveStartupGate{font-family:"KhymeryyanRomanLetters+Numbers","DM Mono",ui-monospace,monospace!important}#hlsPercent{font-family:"HobunjiLoadingPercentRoman","KhymeryyanRoman",serif!important;visibility:hidden}html.hls-loading-percent-font-ready #hlsPercent{visibility:visible}</style>');
(() => {
  const revealPercent = () => document.documentElement?.classList.add('hls-loading-percent-font-ready');
  if (typeof FontFace !== 'function' || !document.fonts) {
    revealPercent();
    return;
  }
  const face = new FontFace('HobunjiLoadingPercentRoman', 'url("assets/hud/KhymeryyanRomanLetters+Numbers.otf.ttf")');
  face.load()
    .then(font => { document.fonts.add(font); revealPercent(); })
    .catch(revealPercent);
})();

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
