// Desktop action-button badge synchronizer.
//
// Gameplay input ownership lives in game.js's shared configured router so
// keyboard, mouse, controller, two-slot bindings, and overlaps follow one path.
// This compatibility module keeps rendered action-bar badges synchronized and
// preserves its historical public namespace for loader readiness checks.
(() => {
  'use strict';

  if (window.HobunjiHeldSeedDesktopCapture) return;

  const ACTION_BUTTON_IDS = ['btnAction1', 'btnAction2', 'btnAction3', 'btnItemAction1', 'btnItemAction2'];
  let badgeSyncPending = false;

  function inputConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.input || {};
  }

  function savedBindings() {
    const config = inputConfig();
    try { return JSON.parse(localStorage.getItem(config.storageKey) || 'null') || {}; }
    catch (_) { return {}; }
  }

  function normalizedCodes(value) {
    return (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
  }

  function desktopCodesForAction(actionId) {
    const config = inputConfig();
    const authored = Array.isArray(config.actions)
      ? config.actions.find(action => action?.id === actionId)?.desktop
      : null;
    const live = window.__hobunjiInputBindings?.desktop?.[actionId];
    const saved = live === undefined ? savedBindings()?.desktop?.[actionId] : live;
    return normalizedCodes(saved === undefined ? authored : saved);
  }

  function keyBadgeLabel(code) {
    const configured = inputConfig().inputLabels?.[code];
    if (configured) return configured.toUpperCase();
    if (!code) return '';
    if (code === 'Space') return 'SPACE';
    if (code === 'Enter') return 'ENTER';
    if (code === 'Escape') return 'ESC';
    if (code.startsWith('Key')) return code.slice(3).toUpperCase();
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
    return code.toUpperCase();
  }

  function syncRenderedKeyBadges() {
    badgeSyncPending = false;
    for (let index = 0; index < ACTION_BUTTON_IDS.length; index++) {
      const button = document.getElementById(ACTION_BUTTON_IDS[index]);
      if (!button || button.classList?.contains?.('abt-hidden') || !button.dataset?.action) continue;
      const label = desktopCodesForAction(`action${index + 1}`).map(keyBadgeLabel).join(' / ');
      let badge = button.querySelector?.('.abt-key') || null;
      if (!label) { badge?.remove?.(); continue; }
      if (!badge && document.createElement && button.prepend) {
        badge = document.createElement('span');
        badge.className = 'abt-key';
        button.prepend(badge);
      }
      if (badge && badge.textContent !== `[${label}]`) badge.textContent = `[${label}]`;
    }
  }

  function scheduleBadgeSync() {
    if (badgeSyncPending) return;
    badgeSyncPending = true;
    setTimeout(syncRenderedKeyBadges, 0);
  }

  function installBadgeSync() {
    syncRenderedKeyBadges();
    const stack = document.getElementById('actionStack');
    if (stack && typeof MutationObserver === 'function') {
      const observer = new MutationObserver(scheduleBadgeSync);
      observer.observe(stack, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-action'] });
    }
  }

  window.addEventListener('hobunji-input-bindings-changed', event => {
    if (event?.detail?.device && event.detail.device !== 'desktop') return;
    scheduleBadgeSync();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installBadgeSync, { once: true });
  else installBadgeSync();

  const api = {
    syncBadges: syncRenderedKeyBadges,
    getDebug: () => ({
      slots: ACTION_BUTTON_IDS.map((id, index) => ({
        slot: index + 1,
        id,
        bindings: desktopCodesForAction(`action${index + 1}`),
      })),
    }),
  };
  window.HobunjiDesktopActionSlotRouter = api;
  window.HobunjiHeldSeedDesktopCapture = api;
})();
