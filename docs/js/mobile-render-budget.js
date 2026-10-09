// Gameplay renderer policy; gameLoop owns sampling, so this adds no RAF loop.
(() => {
  'use strict';
  const STORAGE_KEY = 'hobunjiMobileRenderCheckpointV1'; // Stores a small last-known record across browser reloads.
  const memory = Number(globalThis.navigator?.deviceMemory); // Selects conservative defaults on low-memory desktops too.
  const mobile = !!globalThis.matchMedia?.('(pointer: coarse)')?.matches
    || (memory > 0 && memory <= 6); // Shared policy for rendering and optional post-processing.
  let previous = null; // Preserved at boot; subsequent checkpoints never replace the previous-session report.
  try { previous = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) {}
  let renderer = null; // Main gameplay renderer only; preview renderers keep their own lifecycle.
  let resize = null; // Calls the existing resize owner so outline targets stay in sync.
  let lost = false; // Suspends gameplay while the GPU cannot present a frame.
  let losses = 0; // Counts actual WebGL loss events rather than guessing from low FPS.
  let auto = mobile; // Manual resolution selections disable adaptation.
  let scale = 1; // Automatic world resolution relative to CSS pixels, never applied to HUD text.
  let lastSample = 0; // Start of the current sustained-FPS window.
  let frames = 0; // Counts rendered gameplay frames in that window.
  let fastWindows = 0; // Requires sustained headroom before restoring visual detail.
  let lastCheckpoint = 0; // Limits storage writes to once every 15 seconds, outside normal frame sampling.
  let lastFps = 0; // Latest gameplay-only sample exposed to the existing debug snapshot.
  let status = null; // Visible context-loss notice for users without DevTools.

  function pixelRatio(width, height, manualScale = 1) {
    const dpr = Math.max(0.1, Math.min(Number(window.devicePixelRatio) || 1, 2)); // Matches the existing manual resolution range.
    if (!auto) return dpr * Math.max(0.5, Math.min(1, Number(manualScale) || 1));
    const pixels = Math.max(1, Number(width) || 1) * Math.max(1, Number(height) || 1); // Bounds large tablet buffers as well as high-DPI phones.
    return Math.min(dpr, 1, Math.sqrt(1000000 / pixels)) * scale;
  }

  function checkpoint(reason) {
    if (!renderer) return;
    const record = { // Small scalar-only record: no scene traversal, save serialization, or GPU readback.
      at: new Date().toISOString(), reason, area: window.GridTileAccessors?.getCurrentArea?.() || null,
      fps: lastFps, auto, scale, contextLost: lost, contextLosses: losses,
      width: renderer.domElement.width, height: renderer.domElement.height,
      textures: renderer.info?.memory?.textures || 0, geometries: renderer.info?.memory?.geometries || 0,
      heapBytes: performance.memory?.usedJSHeapSize || null,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch (_) {}
  }

  function setMode(value) {
    auto = value === 'auto';
    scale = 1;
    resetSample();
  }

  function resetSample() {
    lastSample = 0;
    frames = 0;
    fastWindows = 0;
  }

  function sample(timestamp, eligible = true) {
    if (!eligible || lost || document.hidden) { resetSample(); return; }
    if (!lastSample) { lastSample = timestamp; return; }
    frames++;
    const elapsed = timestamp - lastSample; // Measures actual displayed-frame cadence, including GPU stalls.
    if (elapsed < 2000) return;
    lastFps = frames * 1000 / Math.max(1, elapsed);
    lastSample = timestamp;
    frames = 0;
    if (auto) {
      const oldScale = scale; // Resizes only after a sustained change, never every frame.
      if (lastFps < 40) { scale = Math.max(0.65, +(scale - 0.1).toFixed(2)); fastWindows = 0; }
      else if (lastFps > 55) {
        if (++fastWindows >= 5) { scale = Math.min(1, +(scale + 0.05).toFixed(2)); fastWindows = 0; }
      } else fastWindows = 0;
      if (scale !== oldScale) resize?.();
    }
    if (timestamp - lastCheckpoint >= 15000) { lastCheckpoint = timestamp; checkpoint('playing'); }
  }

  function attach(gameRenderer, resizeCanvas) {
    if (renderer) return;
    renderer = gameRenderer;
    resize = resizeCanvas;
    renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault(); // Allows Three.js to restore its resources when the browser returns the context.
      lost = true;
      losses++;
      resetSample();
      checkpoint('webglcontextlost');
      if (!status) {
        status = document.createElement('div');
        status.setAttribute('role', 'status');
        status.style.cssText = 'position:fixed;inset:35% 8% auto;z-index:1000001;padding:20px;background:#151d22;color:white;border:1px solid #bcd;border-radius:10px;text-align:center';
        document.body.appendChild(status);
      }
      status.textContent = 'Graphics interrupted. Gameplay is suspended while the graphics driver recovers.';
      status.style.display = 'block';
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      lost = false;
      if (auto) scale = 0.65; // Rebuild smaller buffers after real memory/driver pressure.
      resize?.();
      resetSample();
      checkpoint('webglcontextrestored');
      if (status) status.style.display = 'none';
    });
    document.addEventListener('visibilitychange', () => { resetSample(); if (document.hidden) checkpoint('hidden'); });
    window.addEventListener('pagehide', () => checkpoint('pagehide'));
  }

  window.MobileRenderBudget = {
    mobile, attach, pixelRatio, setMode, sample,
    shouldSuspend: () => lost || document.hidden,
    snapshot: () => ({ mobile, automatic: auto, scale, fps: lastFps, contextLost: lost, contextLosses: losses, previousSession: previous }),
  };
})();
