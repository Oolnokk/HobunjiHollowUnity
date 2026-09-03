(() => {
  'use strict';

  // Parser-time bridge for the decoupled farm modules. FarmTroughs loads before
  // FarmPanel, while LivestockNursery needs both public APIs before game.js calls
  // their init() functions. Capture FarmPanel's one global assignment and install
  // Nursery synchronously at that exact point; afterward FarmPanel is a normal
  // writable global again, so there is no permanent proxy/setter in the runtime.
  const installNursery = () => window.LivestockNursery?.install?.();
  if (window.FarmPanel) {
    installNursery();
    return;
  }

  let pendingFarmPanel = null; // Holds the assignment only for the setter's single synchronous handoff.
  try {
    Object.defineProperty(window, 'FarmPanel', {
      configurable: true,
      enumerable: true,
      get() { return pendingFarmPanel; },
      set(value) {
        pendingFarmPanel = value;
        Object.defineProperty(window, 'FarmPanel', {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        });
        installNursery();
      },
    });
  } catch (_) {
    // Very old/locked-down browsers may refuse redefining globals. This fallback
    // still installs before ordinary user interaction; supported browsers use the
    // synchronous setter path above.
    const timer = setInterval(() => {
      if (!window.FarmPanel) return;
      clearInterval(timer);
      installNursery();
    }, 0);
  }
})();
