// Pants Rig Author: per-workspace Enlarge toggle (+ zoom/pan) for precise spline/bone/weight authoring.
// Each canvas card (pants PNG, species portrait beltline) gets a button that pins
// that card over the whole page. While enlarged, a Zoom button steps the canvas to
// 2x/3x of the contain-fit size inside a scrollable workspace, and a Pan toggle lets
// one finger scroll instead of dragging a handle. Inside Procedural Animation the
// iframe also asks its host to expand the Pants panel to the full viewport.
(function () {
  'use strict';

  if (document.getElementById('pantsWorkspaceEnlargeStyles')) return;

  const ZOOM_STEPS = [1, 2, 3];

  const style = document.createElement('style');
  style.id = 'pantsWorkspaceEnlargeStyles';
  style.textContent = `
.pantsEnlargeBtn,.pantsZoomBtn,.pantsPanBtn{flex:0 0 auto!important;min-height:30px;padding:4px 10px;font-size:12px;white-space:nowrap}
.pantsZoomBtn,.pantsPanBtn{display:none!important}
.canvasCard.pantsEnlarged{position:fixed!important;inset:6px!important;z-index:1000!important;height:auto!important;min-height:0!important;display:flex!important;flex-direction:column!important;gap:6px;padding:8px;border:1px solid #4a6a92;border-radius:12px;background:#07101a;box-shadow:0 18px 60px rgba(0,0,0,.7)}
.canvasCard.pantsEnlarged .canvasWrap{flex:1 1 0!important;min-height:0!important;height:auto!important}
.canvasCard.pantsEnlarged .pantsZoomBtn{display:inline-block!important}
.canvasCard.pantsEnlarged.pantsZoomed .pantsPanBtn{display:inline-block!important}
.canvasCard.pantsEnlarged.pantsZoomed .canvasWrap{display:block!important;overflow:auto!important;place-items:unset!important;padding:0!important}
.canvasCard.pantsEnlarged.pantsZoomed canvas.author{margin:0 auto}
.canvasCard.pantsEnlarged.pantsPanning .canvasWrap{touch-action:pan-x pan-y!important}
.canvasCard.pantsEnlarged.pantsPanning canvas.author{pointer-events:none!important}
html.pantsWorkspaceEnlarged body{overflow:hidden!important}
html.pantsWorkspaceEnlarged .controls,html.pantsWorkspaceEnlarged .inspect,html.pantsWorkspaceEnlarged #status,html.pantsWorkspaceEnlarged .canvasCard:not(.pantsEnlarged){visibility:hidden!important}
@media(max-width:700px){.canvasCard.pantsEnlarged .row .badge{display:none!important}}
`;
  document.head.appendChild(style);

  let active = null; // { card, button, canvas } for the currently enlarged workspace.
  let zoom = 1; // Multiplier on the contain-fit size while enlarged.

  function fitEnlarged() { // Contain-fit the canvas bitmap into the enlarged wrap (upscaling allowed), times the zoom step.
    if (!active) return;
    const wrap = active.canvas.closest('.canvasWrap');
    const margin = zoom > 1 ? 0 : 8; // Zoomed canvases scroll, so no breathing margin is needed.
    const fit = Math.min((wrap.clientWidth - margin) / active.canvas.width, (wrap.clientHeight - margin) / active.canvas.height);
    const scale = Math.max(0.05, fit) * zoom;
    for (const [prop, value] of [['width', `${Math.max(1, Math.floor(active.canvas.width * scale))}px`], ['height', `${Math.max(1, Math.floor(active.canvas.height * scale))}px`], ['max-width', 'none'], ['max-height', 'none']]) {
      active.canvas.style.setProperty(prop, value, 'important');
    }
  }

  function notifyHost(enlarged) {
    if (window.parent === window) return;
    try { window.parent.postMessage({ type: 'hobunji-pants-rig-enlarge', enlarged }, window.location.origin); } catch (_) {}
  }

  function refitSoon({ center = false } = {}) {
    requestAnimationFrame(() => {
      fitEnlarged();
      window.PantsRigEmbeddedLayout?.refit?.();
      window.__pantsRigAuthorDebug?.renderWeightOverlay?.(); // Overlay re-syncs its CSS box to the resized canvas.
      if (center && active) {
        const wrap = active.canvas.closest('.canvasWrap');
        wrap.scrollLeft = Math.max(0, (wrap.scrollWidth - wrap.clientWidth) / 2);
        wrap.scrollTop = Math.max(0, (wrap.scrollHeight - wrap.clientHeight) / 2);
      }
    });
  }

  function syncZoomUi() {
    if (!active) return;
    const { card } = active;
    card.classList.toggle('pantsZoomed', zoom > 1);
    if (zoom === 1) card.classList.remove('pantsPanning');
    const zoomButton = card.querySelector('.pantsZoomBtn');
    zoomButton.textContent = `🔍 ${zoom}×`;
    const panButton = card.querySelector('.pantsPanBtn');
    const panning = card.classList.contains('pantsPanning');
    panButton.textContent = panning ? '✏️ Edit' : '✋ Pan';
    panButton.setAttribute('aria-pressed', String(panning));
    panButton.title = panning ? 'Back to editing handles and weights' : 'Scroll the zoomed workspace with one finger';
  }

  function cycleZoom() {
    if (!active) return;
    zoom = ZOOM_STEPS[(ZOOM_STEPS.indexOf(zoom) + 1) % ZOOM_STEPS.length];
    syncZoomUi();
    refitSoon({ center: true });
  }

  function togglePan() {
    if (!active || zoom === 1) return;
    active.card.classList.toggle('pantsPanning');
    syncZoomUi();
  }

  function setEnlarged(card, enlarged) {
    if (active && (!enlarged || active.card !== card)) {
      const previous = active;
      active = null;
      zoom = 1;
      previous.card.classList.remove('pantsEnlarged', 'pantsZoomed', 'pantsPanning');
      previous.button.textContent = '⤢ Enlarge';
      previous.button.setAttribute('aria-pressed', 'false');
      for (const prop of ['width', 'height', 'max-width', 'max-height']) previous.canvas.style.removeProperty(prop); // Embedded layout re-fits on its own once the wrap shrinks.
    }
    if (enlarged && card) {
      const button = card.querySelector('.pantsEnlargeBtn');
      active = { card, button, canvas: card.querySelector('canvas.author') };
      zoom = 1;
      card.classList.add('pantsEnlarged');
      button.textContent = '✕ Exit enlarge';
      button.setAttribute('aria-pressed', 'true');
      syncZoomUi();
    }
    document.documentElement.classList.toggle('pantsWorkspaceEnlarged', !!active);
    notifyHost(!!active);
    refitSoon();
    if (!active) setTimeout(() => window.PantsRigEmbeddedLayout?.refit?.(), 120); // Second pass after the wrap has settled back to its normal size.
  }

  function install() {
    for (const card of document.querySelectorAll('.workspace .canvasCard')) {
      const row = card.querySelector('.row');
      if (!row || row.querySelector('.pantsEnlargeBtn')) continue;
      const make = (className, text, handler, title) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `secondary ${className}`;
        button.textContent = text;
        button.title = title;
        button.addEventListener('click', handler);
        row.appendChild(button);
        return button;
      };
      make('pantsPanBtn', '✋ Pan', togglePan, 'Scroll the zoomed workspace with one finger');
      make('pantsZoomBtn', '🔍 1×', cycleZoom, 'Zoom the enlarged workspace 1×/2×/3×');
      const enlarge = make('pantsEnlargeBtn', '⤢ Enlarge', () => setEnlarged(card, active?.card !== card), 'Enlarge this workspace for precise spline authoring (Esc to exit)');
      enlarge.setAttribute('aria-pressed', 'false');
    }
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && active) setEnlarged(null, false); });
    window.addEventListener('resize', () => refitSoon());
    window.addEventListener('message', event => { // Host may close/collapse the panel; leave enlarge mode with it.
      if (event.source === window.parent && event.data?.type === 'hobunji-pants-rig-exit-enlarge' && active) setEnlarged(null, false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  window.PantsRigWorkspaceEnlarge = Object.freeze({
    enlarge: which => setEnlarged(document.getElementById(which === 'portrait' ? 'portraitCanvas' : 'pantsCanvas')?.closest('.canvasCard') || null, true),
    exit: () => setEnlarged(null, false),
    cycleZoom,
    togglePan,
    active: () => (active ? active.canvas.id : null),
    zoom: () => zoom,
  });
})();
