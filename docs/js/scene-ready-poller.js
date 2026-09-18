// Generic "wait until a condition is true, or give up after a timeout"
// helper. Extracted from game.js's waitForBuildingSceneReady, which polled
// _buildingScenes.get(mapId) via a self-recursive requestAnimationFrame -
// a condition-wait, not per-frame work, so it belongs on a timer instead.
(function (global) {
  'use strict';

  function pollUntilReady(checkReady, timeoutMs = 4000, intervalMs = 50) {
    return new Promise(resolve => {
      const start = performance.now();
      (function poll() {
        if (checkReady() || performance.now() - start > timeoutMs) { resolve(); return; }
        global.setTimeout(poll, intervalMs);
      })();
    });
  }

  global.SceneReadyPoller = { pollUntilReady };
})(window);
