// Hobunji Hollow — viewport-fit guard for onboarding and character creation.
// Keeps the creator card inside the visible viewport while letting its body scroll when space is tight.
(() => {
  'use strict';

  const MODULE_ID = 'hobunjiOnboardingViewportFit'; // Prevents duplicate installation when onboarding assets are reloaded.
  if (window[MODULE_ID]) return;

  const status = {
    installed: true,
    viewportWidth: 0,
    viewportHeight: 0,
    cardWidth: 0,
    cardHeight: 0,
    overflowX: false,
    overflowY: false,
    lastCheckedAt: 0,
  }; // Exposes mobile-friendly fit diagnostics without requiring the browser console.

  let bodyObserver = null; // Watches for the onboarding overlay itself being mounted or removed.
  let overlayObserver = null; // Watches onboarding-core replacing the current card during rerenders.
  let cardResizeObserver = null; // Re-checks fit when the creator's rendered dimensions change.
  let observedOverlay = null; // Overlay currently connected to overlayObserver.
  let observedCard = null; // Card currently connected to cardResizeObserver.
  let checkQueued = false; // Coalesces resize/mutation bursts into one fit measurement.

  function installStyle() {
    if (document.getElementById(`${MODULE_ID}Style`)) return;
    const style = document.createElement('style');
    style.id = `${MODULE_ID}Style`;
    style.textContent = `
#ob-overlay{box-sizing:border-box;max-width:100vw;max-height:100vh;max-height:100dvh;overflow:hidden}
#ob-overlay>.ob-card{box-sizing:border-box;min-height:0;max-width:100%}
#ob-overlay>.ob-card:not(.sl-card){max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);overflow:hidden}
#ob-overlay>.ob-card:not(.sl-card)>.ob-title,
#ob-overlay>.ob-card:not(.sl-card)>.ob-tabs,
#ob-overlay>.ob-card:not(.sl-card)>.ob-footer{flex:0 0 auto}
#ob-overlay>.ob-card:not(.sl-card)>.ob-two-col{flex:1 1 auto;min-height:0;overflow:hidden}
#ob-overlay>.ob-card:not(.sl-card)>.ob-two-col>.ob-col-left{min-height:0}
#ob-overlay>.ob-card:not(.sl-card)>.ob-two-col>.ob-col-right{min-height:0;max-height:100%;overflow-y:auto;overscroll-behavior:contain}
#ob-overlay .ob-viewport-fit-warning{position:fixed;left:8px;bottom:8px;z-index:9999;max-width:min(420px,calc(100vw - 16px));box-sizing:border-box;padding:6px 8px;border:1px solid rgba(255,181,158,.48);border-radius:7px;background:rgba(20,5,3,.92);color:#ffb59e;font:9px/1.35 'DM Mono',ui-monospace,monospace;pointer-events:none}
@media (max-width:560px){
  #ob-overlay{padding:8px}
  #ob-overlay>.ob-card:not(.sl-card){max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);padding:12px;gap:10px}
  #ob-overlay>.ob-card:not(.sl-card)>.ob-two-col{overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain}
  #ob-overlay>.ob-card:not(.sl-card)>.ob-two-col>.ob-col-left{flex:0 0 auto}
  #ob-overlay>.ob-card:not(.sl-card)>.ob-two-col>.ob-col-right{flex:0 0 auto;width:100%;max-height:none;overflow:visible;padding-right:0}
}
@media (max-height:640px) and (min-width:561px){
  #ob-overlay>.ob-card:not(.sl-card)>.ob-two-col{overflow-y:auto;overscroll-behavior:contain}
  #ob-overlay>.ob-card:not(.sl-card)>.ob-two-col>.ob-col-right{max-height:none;overflow:visible}
}
`;
    document.head.appendChild(style);
  }

  function overlayElement() {
    return document.getElementById('ob-overlay');
  }

  function creatorCard(overlay = overlayElement()) {
    const card = overlay?.querySelector('.ob-card');
    return card && !card.classList.contains('sl-card') ? card : null;
  }

  function warningElement(overlay = overlayElement()) {
    return overlay?.querySelector('[data-ob-viewport-fit-warning="1"]') || null;
  }

  function setWarning(overlay, message) {
    let warning = warningElement(overlay);
    if (!message) {
      warning?.remove();
      return;
    }
    if (!warning) {
      warning = document.createElement('div');
      warning.className = 'ob-viewport-fit-warning';
      warning.dataset.obViewportFitWarning = '1';
      warning.setAttribute('aria-live', 'polite');
      overlay?.appendChild(warning);
    }
    warning.textContent = message;
  }

  function measureFit() {
    checkQueued = false;
    const overlay = overlayElement();
    const card = creatorCard(overlay);
    if (!card) {
      status.cardWidth = 0;
      status.cardHeight = 0;
      status.overflowX = false;
      status.overflowY = false;
      setWarning(overlay, '');
      return;
    }

    const viewport = window.visualViewport;
    const viewportWidth = Math.round(viewport?.width || window.innerWidth || 0);
    const viewportHeight = Math.round(viewport?.height || window.innerHeight || 0);
    const viewportLeft = Math.round(viewport?.offsetLeft || 0);
    const viewportTop = Math.round(viewport?.offsetTop || 0);
    const rect = card.getBoundingClientRect();
    const tolerance = 1;

    status.viewportWidth = viewportWidth;
    status.viewportHeight = viewportHeight;
    status.cardWidth = Math.round(rect.width);
    status.cardHeight = Math.round(rect.height);
    status.overflowX = rect.left < viewportLeft - tolerance || rect.right > viewportLeft + viewportWidth + tolerance;
    status.overflowY = rect.top < viewportTop - tolerance || rect.bottom > viewportTop + viewportHeight + tolerance;
    status.lastCheckedAt = Date.now();

    if (status.overflowX || status.overflowY) {
      const axes = [status.overflowX ? 'horizontal' : '', status.overflowY ? 'vertical' : ''].filter(Boolean).join(' + ');
      setWarning(overlay, `Creator viewport-fit warning (${axes}): ${status.cardWidth}×${status.cardHeight} card inside ${viewportWidth}×${viewportHeight} viewport.`);
    } else {
      setWarning(overlay, '');
    }
  }

  function queueFitCheck() {
    if (checkQueued) return;
    checkQueued = true;
    requestAnimationFrame(measureFit);
  }

  function observeCurrentCard() {
    const overlay = overlayElement();
    if (overlay !== observedOverlay) {
      overlayObserver?.disconnect();
      overlayObserver = null;
      observedOverlay = overlay;
      if (overlay) {
        overlayObserver = new MutationObserver(() => {
          observeCurrentCard();
          queueFitCheck();
        });
        overlayObserver.observe(overlay, { childList: true });
      }
    }

    const card = creatorCard(overlay);
    if (card !== observedCard) {
      cardResizeObserver?.disconnect();
      cardResizeObserver = null;
      observedCard = card;
      if (card && typeof ResizeObserver !== 'undefined') {
        cardResizeObserver = new ResizeObserver(queueFitCheck);
        cardResizeObserver.observe(card);
      }
    }
    queueFitCheck();
  }

  function install() {
    installStyle();
    bodyObserver = new MutationObserver(observeCurrentCard);
    bodyObserver.observe(document.body, { childList: true });
    window.addEventListener('resize', queueFitCheck, { passive: true });
    window.visualViewport?.addEventListener('resize', queueFitCheck, { passive: true });
    window.visualViewport?.addEventListener('scroll', queueFitCheck, { passive: true });
    observeCurrentCard();
  }

  window[MODULE_ID] = { status, recheck: measureFit };

  if (document.body) install();
  else document.addEventListener('DOMContentLoaded', install, { once: true });
})();
