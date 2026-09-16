(() => {
  'use strict';
  if (window.LivestockNurseryObserverScope) return;

  // Compatibility guard for LivestockNursery's legacy panel observer. That
  // module predates the current Farm UI and asks one MutationObserver to watch
  // document.body recursively. While the Farm tab is open, unrelated HUD/menu
  // child-list changes can therefore trigger a full Nursery rebuild and save
  // parse. Keep the observer's existing callback/reconnect behavior, but scope
  // only THAT observer to the two DOM lists it actually decorates.
  const NativeMutationObserver = window.MutationObserver; // Preserved constructor used by every ordinary observer in the game.
  const nativeObserve = NativeMutationObserver?.prototype?.observe; // Preserved method so non-Nursery observers stay byte-for-byte behaviorally unchanged.
  const NURSERY_STACK_TOKEN = 'livestock-nursery.js'; // Used once to identify the private legacy observer without relying on creation order.
  const TARGET_IDS = Object.freeze(['farmLivestockList', 'farmBuildingsList']); // The only light-DOM regions decoratePanelNow reads/writes.

  let scopedObserver = null; // Remembers the identified private observer across its disconnect()/observe() reconnects.
  let interceptedObserveCalls = 0; // Mobile-copyable diagnostic: how often the body-wide request was redirected.
  let fallbackBodyObserveCalls = 0; // Should remain zero in normal browser startup; exposes an early-DOM timing miss.
  let installed = false; // Makes parser-time duplicate bridge loads harmless.

  function farmTargets() {
    if (typeof document === 'undefined') return [];
    return TARGET_IDS.map(id => document.getElementById(id)).filter(Boolean);
  }

  function calledFromNurseryObserver() {
    // This executes only on observer.observe(), not mutation delivery, so one
    // stack allocation at setup/reconnect is far cheaper than the body-wide
    // mutation stream it replaces. Once identified, scopedObserver bypasses it.
    try { return String(new Error().stack || '').includes(NURSERY_STACK_TOKEN); }
    catch (_) { return false; }
  }

  function observeFarmTargets(observer, options) {
    const targets = farmTargets();
    if (!targets.length) return false;
    const scopedOptions = {
      childList: options?.childList !== false,
      subtree: true,
    }; // Nursery only needs structural rerender detection; attributes/text are intentionally excluded.
    for (const target of targets) nativeObserve.call(observer, target, scopedOptions);
    interceptedObserveCalls++;
    return true;
  }

  function install() {
    if (installed || !NativeMutationObserver || typeof nativeObserve !== 'function') return installed;
    installed = true;

    NativeMutationObserver.prototype.observe = function nurseryScopedObserve(target, options) {
      const isRememberedNurseryObserver = this === scopedObserver;
      const isFirstNurseryBodyRequest = !scopedObserver
        && target === document.body
        && options?.childList === true
        && options?.subtree === true
        && calledFromNurseryObserver();

      if (isFirstNurseryBodyRequest) scopedObserver = this;
      if (isRememberedNurseryObserver || isFirstNurseryBodyRequest) {
        if (observeFarmTargets(this, options)) return;
        // Extremely early parser timing can precede the static Farm DOM. Keep
        // startup functional; the Nursery's next reconnect will rescope once
        // those lists exist, and expose the fallback in diagnostics.
        fallbackBodyObserveCalls++;
      }
      return nativeObserve.call(this, target, options);
    };
    return true;
  }

  function debugSnapshot() {
    return {
      installed,
      nurseryObserverIdentified: !!scopedObserver,
      interceptedObserveCalls,
      fallbackBodyObserveCalls,
      targetsPresent: Object.fromEntries(TARGET_IDS.map(id => [id, !!document.getElementById(id)])),
    };
  }

  window.LivestockNurseryObserverScope = { install, debugSnapshot };
  window.__livestockNurseryObserverScopeDebug = { snapshot: debugSnapshot };
  install();
})();