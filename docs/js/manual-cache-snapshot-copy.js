(() => {
  'use strict';

  if (window.HobunjiManualCacheSnapshotCopy) return;

  function flash(btn, text, ms = 1600) {
    const original = btn.dataset.manualSnapshotOriginalLabel || btn.textContent || 'Snapshot now';
    btn.dataset.manualSnapshotOriginalLabel = original;
    btn.textContent = text;
    window.setTimeout(() => {
      if (btn.isConnected) btn.textContent = btn.dataset.manualSnapshotOriginalLabel || original;
    }, ms);
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try { copied = document.execCommand?.('copy') === true; } finally { area.remove(); }
    if (!copied) throw new Error('clipboard unavailable');
    return true;
  }

  function findManualButton() {
    const box = document.getElementById('hobunjiPerfDebugSettings');
    if (!box) return null;
    return [...box.querySelectorAll('button')].find(btn => {
      const label = (btn.dataset.manualSnapshotOriginalLabel || btn.textContent || '').trim();
      return label === 'Snapshot now';
    }) || null;
  }

  function install() {
    const oldButton = findManualButton();
    if (!oldButton) return false;
    if (oldButton.dataset.manualSnapshotAutoCopy === '1') return true;

    // performance-debug.js originally installs an anonymous console-only click
    // handler. Clone once to drop that handler, then install the user-facing
    // capture+copy behavior without touching the cache-audit implementation.
    const button = oldButton.cloneNode(true);
    button.dataset.manualSnapshotAutoCopy = '1';
    button.dataset.manualSnapshotOriginalLabel = 'Snapshot now';
    button.title = 'Capture a fresh cache snapshot and copy its JSON to the clipboard.';
    oldButton.replaceWith(button);

    button.addEventListener('click', async () => {
      const snap = window.HobunjiCacheAudit?.print?.();
      if (!snap) {
        flash(button, 'Unavailable');
        return;
      }
      try {
        await copyText(JSON.stringify(snap, null, 2));
        flash(button, 'Copied!');
      } catch (_) {
        flash(button, 'Captured; copy failed', 2200);
      }
    });
    return true;
  }

  let observer = null;
  let observerStopTimer = 0;
  function stopObserver() {
    observer?.disconnect?.();
    observer = null;
    if (observerStopTimer) window.clearTimeout(observerStopTimer);
    observerStopTimer = 0;
  }

  function arm() {
    if (install()) return;
    observer = new MutationObserver(() => {
      if (!install()) return;
      stopObserver();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // performance-debug.js creates this UI during boot. Bound the observer's
    // lifetime anyway so a failed debug-panel boot cannot leave a long-lived
    // whole-document observer behind.
    observerStopTimer = window.setTimeout(stopObserver, 15000);
  }

  window.HobunjiManualCacheSnapshotCopy = Object.freeze({ install });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm, { once: true });
  else arm();
})();
