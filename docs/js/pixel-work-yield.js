// Time-slicing for long main-thread pixel jobs (clothing pattern composites,
// creature genetics recolors). Those are already async, but once their images
// are loaded every remaining step runs back-to-back in one task, and several
// NPCs/animals building at once used to stall a frame for up to ~2s.
//
// Callers `await window.PixelWorkYield?.maybeYield()` between heavy steps:
// it resolves immediately until SLICE_MS of continuous work has piled up,
// then gives the browser a turn (to render a frame / handle input) before
// continuing. The budget is shared, so concurrent jobs split one slice
// instead of each taking their own. Pages that don't load this file (editor
// tools, node tests) keep running the jobs straight through.
(function () {
  'use strict';

  const SLICE_MS = 6; // Leaves most of a 16ms frame for the game loop and render.
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let sliceStart = now();
  let yields = 0;

  function yieldToMain() {
    if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') return scheduler.yield();
    if (typeof MessageChannel === 'function') {
      return new Promise(resolve => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
        channel.port2.postMessage(null);
      });
    }
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  async function maybeYield() {
    if (now() - sliceStart < SLICE_MS) return;
    yields++;
    await yieldToMain();
    sliceStart = now();
  }

  window.PixelWorkYield = {
    SLICE_MS,
    maybeYield,
    getDebug: () => ({ sliceMs: SLICE_MS, yields }),
  };
})();
