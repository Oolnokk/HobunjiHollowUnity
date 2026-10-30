// Shared authority for in-world location titles and optional synchronized music.
// Caves, camps and mine descents use the existing top-of-screen banner.
(() => {
  'use strict';

  let deps = null; // Supplies the current area so cancelled transitions cannot announce stale destinations.
  let pending = null; // Holds the newest title/cue until the loading overlay has actually disappeared.
  let lastShown = null; // Exposes the most recent arrival in mobile-readable debug info.

  function init(nextDeps) {
    deps = nextDeps || {};
  }

  function reveal(arrival) {
    window.ToastNotifications?.showZoneBanner?.(arrival.title);
    if (arrival.cue) window.Music?.playGameplayCue?.(arrival.cue);
    lastShown = { title: arrival.title, area: arrival.area, cue: arrival.cue, at: Date.now() };
    window.__farmLog?.('[arrival] ' + arrival.title + ' | cue=' + (arrival.cue || 'none') + ' | area=' + (arrival.area || 'unknown'), 'info'); // Existing mobile diagnostics records the synchronized reveal.
  }

  function flushWhenLoaded() {
    const arrival = pending; // Consume before callbacks so duplicate loader events cannot repeat a sting.
    pending = null;
    if (!arrival) return;
    if (arrival.area && deps?.getCurrentArea?.() !== arrival.area) {
      window.__farmLog?.('[arrival] cancelled stale title for ' + arrival.area, 'warn'); // Visible diagnostic for interrupted loading.
      return;
    }
    reveal(arrival);
  }

  function announce(title, { cue = null, area = null } = {}) {
    const label = String(title ?? '').trim(); // Rejects blank location names before changing HUD or music.
    if (!label) return false;
    const arrival = { title: label, cue, area: area || deps?.getCurrentArea?.() || null }; // Records destination for stale-arrival protection.
    if (window.LoadingScreenRuntime?.getDebug?.().visible) {
      pending = arrival;
    } else {
      pending = null;
      reveal(arrival);
    }
    return true;
  }

  function mineDescent(mapId) {
    const floor = window.TownMine?.floorFromMapId?.(mapId); // Uses canonical floor parsing, not loading-screen text.
    return floor ? announce('Floor ' + floor, { area: mapId, cue: 'progressDeeper' }) : false;
  }

  window.LoadingScreenRuntime?.onHidden?.(flushWhenLoaded); // Event-driven reveal without per-frame polling.
  window.LocationArrival = Object.freeze({
    init,
    announce,
    mineDescent,
    getDebug: () => ({ pending: pending && { ...pending }, lastShown: lastShown && { ...lastShown } }),
  });
})();
