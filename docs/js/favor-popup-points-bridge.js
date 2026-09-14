(() => {
  'use strict';

  if (Number(window.FavorPopupPointsBridge?.version) >= 1) return;

  function convertFavorHeartDelta(kind, amount) {
    if (kind !== 'favor') return amount;
    const points = window.NpcFavorBalance?.heartsToFavorPoints?.(amount);
    return Number.isFinite(Number(points)) ? points : amount;
  }

  function install() {
    const api = window.WorldPopupText;
    if (!api || api.__favorPopupPointsBridge) return false;

    if (typeof api.showRelationshipChange === 'function') {
      const original = api.showRelationshipChange.bind(api);
      api.showRelationshipChange = function favorPointRelationshipPopup(root, kind, amount, ...args) {
        return original(root, kind, convertFavorHeartDelta(kind, amount), ...args);
      };
    }

    if (typeof api.showFavorChange === 'function') {
      const original = api.showFavorChange.bind(api);
      api.showFavorChange = function favorPointPopup(root, amount, ...args) {
        return original(root, convertFavorHeartDelta('favor', amount), ...args);
      };
    }

    api.__favorPopupPointsBridge = true;
    return true;
  }

  if (!install() && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => {
      if (!install()) return;
      observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.FavorPopupPointsBridge = Object.freeze({ version: 1, install });
})();