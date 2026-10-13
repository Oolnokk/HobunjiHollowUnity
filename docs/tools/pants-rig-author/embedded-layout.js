// Pants Rig Author: embedded-layout correction for Procedural Animation.
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search); // Distinguishes the narrow Procedural Animation iframe from the standalone tool page.
  if (!params.has('embedded') || document.getElementById('pantsRigEmbeddedLayoutStyles')) return;

  document.documentElement.classList.add('pantsRigEmbedded');
  const style = document.createElement('style'); // Overrides the standalone <=760px rules that otherwise force 520px/360px canvas rows inside the 620px-wide iframe.
  style.id = 'pantsRigEmbeddedLayoutStyles';
  style.textContent = `
html.pantsRigEmbedded,html.pantsRigEmbedded body{min-height:100%;height:auto;overflow:auto}
html.pantsRigEmbedded .app{display:flex!important;flex-direction:column!important;min-height:100%!important;height:auto!important;padding:7px!important;overflow:visible!important}
html.pantsRigEmbedded .workspace{order:-1!important;min-height:0!important;overflow:visible!important}
html.pantsRigEmbedded .canvasPair{display:grid!important;grid-template-rows:minmax(280px,1fr) minmax(220px,.72fr)!important;height:calc(100dvh - 92px)!important;min-height:560px!important;gap:9px!important}
html.pantsRigEmbedded .canvasCard{min-height:0!important;height:auto!important;overflow:hidden!important}
html.pantsRigEmbedded .canvasWrap{min-height:0!important;height:auto!important;overflow:hidden!important;padding:4px!important}
html.pantsRigEmbedded canvas.author{display:block!important;width:auto!important;height:auto!important;max-width:none!important;max-height:none!important;touch-action:none}
html.pantsRigEmbedded #portraitCanvas{width:auto!important}
html.pantsRigEmbedded .controls,html.pantsRigEmbedded .inspect{max-height:none!important;overflow:visible!important}
@media(max-height:650px){html.pantsRigEmbedded .canvasPair{height:620px!important;min-height:620px!important;grid-template-rows:340px 260px!important}}
`;
  document.head.appendChild(style);

  const fitted = new Map(); // Tracks the last CSS dimensions so ResizeObserver callbacks do not churn styles unnecessarily.
  function fitCanvas(canvas) {
    const wrap = canvas?.closest?.('.canvasWrap');
    if (!canvas || !wrap) return;
    const maxWidth = Math.max(1, wrap.clientWidth - 8); // Leaves a few pixels around handles while preserving the complete canvas bitmap.
    const maxHeight = Math.max(1, wrap.clientHeight - 8);
    const intrinsicWidth = Math.max(1, Number(canvas.width) || 1);
    const intrinsicHeight = Math.max(1, Number(canvas.height) || 1);
    const scale = Math.min(maxWidth / intrinsicWidth, maxHeight / intrinsicHeight); // True contain scaling; width and height always use the same factor.
    const width = Math.max(1, Math.floor(intrinsicWidth * scale));
    const height = Math.max(1, Math.floor(intrinsicHeight * scale));
    const key = `${width}x${height}`;
    if (fitted.get(canvas) === key) return;
    fitted.set(canvas, key);
    canvas.style.setProperty('width', `${width}px`, 'important');
    canvas.style.setProperty('height', `${height}px`, 'important');
  }

  function fitAll() {
    fitCanvas(document.getElementById('pantsCanvas'));
    fitCanvas(document.getElementById('portraitCanvas'));
  }

  const observer = new ResizeObserver(fitAll); // Re-fits when the Pants panel, Opera window, or mobile orientation changes.
  const start = () => {
    document.querySelectorAll('.canvasWrap').forEach(node => observer.observe(node));
    fitAll();
    requestAnimationFrame(fitAll);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.PantsRigEmbeddedLayout = Object.freeze({
    installed: true,
    refit: fitAll,
    snapshot() {
      const read = id => {
        const canvas = document.getElementById(id);
        const rect = canvas?.getBoundingClientRect?.();
        return canvas && rect ? { intrinsic: `${canvas.width}x${canvas.height}`, css: `${Math.round(rect.width)}x${Math.round(rect.height)}` } : null;
      };
      return { pants: read('pantsCanvas'), portrait: read('portraitCanvas') };
    },
  }); // Lets the host/debug panel confirm that neither preview is being aspect-cropped.
})();
