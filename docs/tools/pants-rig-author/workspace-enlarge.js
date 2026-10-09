// Pants Rig Author: per-workspace Enlarge toggle for precise spline/bone/weight authoring.
// Each canvas card (pants PNG, species portrait beltline) gets a button that pins
// that card over the whole page. Inside Procedural Animation the iframe also asks
// its host to expand the Pants panel to the full viewport while enlarged.
(function () {
  'use strict';

  if (document.getElementById('pantsWorkspaceEnlargeStyles')) return;
  const embedded = document.documentElement.classList.contains('pantsRigEmbedded'); // embedded-layout.js already re-fits canvases on wrap resize.

  const style = document.createElement('style');
  style.id = 'pantsWorkspaceEnlargeStyles';
  style.textContent = `
.pantsEnlargeBtn{flex:0 0 auto!important;min-height:30px;padding:4px 10px;font-size:12px;white-space:nowrap}
.canvasCard.pantsEnlarged{position:fixed!important;inset:6px!important;z-index:1000!important;height:auto!important;min-height:0!important;display:flex!important;flex-direction:column!important;gap:6px;padding:8px;border:1px solid #4a6a92;border-radius:12px;background:#07101a;box-shadow:0 18px 60px rgba(0,0,0,.7)}
.canvasCard.pantsEnlarged .canvasWrap{flex:1 1 0!important;min-height:0!important;height:auto!important}
html.pantsWorkspaceEnlarged body{overflow:hidden!important}
`;
  document.head.appendChild(style);

  let active = null; // { card, button, canvas } for the currently enlarged workspace.

  function fitEnlarged() { // Standalone page only: contain-fit the canvas bitmap into the enlarged wrap (upscaling allowed).
    if (!active || embedded) return;
    const wrap = active.canvas.closest('.canvasWrap');
    const scale = Math.min((wrap.clientWidth - 8) / active.canvas.width, (wrap.clientHeight - 8) / active.canvas.height);
    active.canvas.style.setProperty('width', `${Math.max(1, Math.floor(active.canvas.width * scale))}px`, 'important');
    active.canvas.style.setProperty('height', `${Math.max(1, Math.floor(active.canvas.height * scale))}px`, 'important');
    active.canvas.style.setProperty('max-width', 'none', 'important');
    active.canvas.style.setProperty('max-height', 'none', 'important');
  }

  function notifyHost(enlarged) {
    if (window.parent === window) return;
    try { window.parent.postMessage({ type: 'hobunji-pants-rig-enlarge', enlarged }, window.location.origin); } catch (_) {}
  }

  function refitSoon() {
    requestAnimationFrame(() => {
      fitEnlarged();
      window.PantsRigEmbeddedLayout?.refit?.();
      window.__pantsRigAuthorDebug?.renderWeightOverlay?.(); // Overlay re-syncs its CSS box to the resized canvas.
    });
  }

  function setEnlarged(card, enlarged) {
    if (active && (!enlarged || active.card !== card)) {
      const previous = active;
      active = null;
      previous.card.classList.remove('pantsEnlarged');
      previous.button.textContent = '⤢ Enlarge';
      previous.button.setAttribute('aria-pressed', 'false');
      if (!embedded) for (const prop of ['width', 'height', 'max-width', 'max-height']) previous.canvas.style.removeProperty(prop);
    }
    if (enlarged && card) {
      const button = card.querySelector('.pantsEnlargeBtn');
      active = { card, button, canvas: card.querySelector('canvas.author') };
      card.classList.add('pantsEnlarged');
      button.textContent = '✕ Exit enlarge';
      button.setAttribute('aria-pressed', 'true');
    }
    document.documentElement.classList.toggle('pantsWorkspaceEnlarged', !!active);
    notifyHost(!!active);
    refitSoon();
  }

  function install() {
    for (const card of document.querySelectorAll('.workspace .canvasCard')) {
      const row = card.querySelector('.row');
      if (!row || row.querySelector('.pantsEnlargeBtn')) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary pantsEnlargeBtn';
      button.textContent = '⤢ Enlarge';
      button.setAttribute('aria-pressed', 'false');
      button.title = 'Enlarge this workspace for precise spline authoring (Esc to exit)';
      button.addEventListener('click', () => setEnlarged(card, active?.card !== card));
      row.appendChild(button);
    }
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && active) setEnlarged(null, false); });
    window.addEventListener('resize', refitSoon);
    window.addEventListener('message', event => { // Host may close/collapse the panel; leave enlarge mode with it.
      if (event.source === window.parent && event.data?.type === 'hobunji-pants-rig-exit-enlarge' && active) setEnlarged(null, false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  window.PantsRigWorkspaceEnlarge = Object.freeze({
    enlarge: which => setEnlarged(document.getElementById(which === 'portrait' ? 'portraitCanvas' : 'pantsCanvas')?.closest('.canvasCard') || null, true),
    exit: () => setEnlarged(null, false),
    active: () => (active ? active.canvas.id : null),
  });
})();
