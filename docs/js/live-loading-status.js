// Unobtrusive, event-driven progress text below the gameplay status bar.
// Tracks real pending fetches via LoadingScreenRuntime and Three.js assets via
// DefaultLoadingManager; no gameplay-frame polling, network interception, or DOM container.
(() => {
  'use strict';
  if (window.HobunjiLiveLoadingStatus?.installed) return;

  const status = document.getElementById('liveLoadingStatus'); // Text-only output directly below #statusBar.
  if (!status) return;
  const assetRequests = new Map(); // URL -> concurrent Three.js item count; itemStart/itemEnd preserve each original loader callback.
  const tasks = new Map(); // Token -> explicit async jobs for future CPU-bound/yielding zone loaders.
  const SHOW_DELAY_MS = 400; // Hide brief requests rather than flashing text between frames.
  const RETRY_DELAY_MS = 500; // Check for the first playable renderer only while work remains outstanding.
  let nextTaskId = 0; // Distinct tokens keep simultaneous jobs with the same label independent.
  let firstPendingAt = 0; // The start of the current continuous loading period.
  let timer = null; // Only active while pending work needs a delayed presentation.
  let label = ''; // Last written text; unchanged HTML never invalidates layout.
  let visible = false; // Last applied visibility; avoids redundant DOM writes.
  let maxPending = 0; // Diagnostics for large batches, not a progress percentage.
  let completedAssets = 0; // Diagnostics: real Three.js asset completions.
  const now = () => window.performance?.now?.() ?? Date.now();

  function classify(name) {
    const value = String(name || '').split('?')[0].toLowerCase(); // Ignore cache tokens without exposing URLs on screen.
    if (/\.(glb|gltf|obj|fbx)(?:$|#)/.test(value)) return '3D models';
    if (/\.(png|jpg|jpeg|webp|ktx2|basis|gif)(?:$|#)/.test(value)) return 'textures';
    if (/\.(mp3|m4a|wav|ogg)(?:$|#)/.test(value)) return 'audio';
    if (/\.(woff2?|ttf|otf)(?:$|#)/.test(value)) return 'fonts';
    if (/\.(json|bin)(?:$|#)/.test(value) || value.includes('/config/')) return 'world data';
    if (/\.js(?:$|#)/.test(value)) return 'scripts';
    return 'resources';
  }

  function pending() {
    const requests = window.LoadingScreenRuntime?.pendingRequestNames?.() || []; // Existing shared fetch wrapper, not another global monkeypatch.
    const names = requests.map(classify);
    for (const [url, count] of assetRequests) for (let i = 0; i < count; i++) names.push(classify(url));
    for (const name of tasks.values()) names.push(name);
    return { names, fetches: requests.length, assets: [...assetRequests.values()].reduce((sum, count) => sum + count, 0), tasks: tasks.size };
  }

  function toggle(show) {
    if (visible === show) return;
    visible = show;
    status.hidden = !show; // CSS has no background, border, box-shadow or panel.
  }
  function write(text) {
    if (label === text) return;
    label = text;
    status.textContent = text;
  }
  function clearTimer() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  }
  function schedule(ms) {
    clearTimer();
    timer = setTimeout(() => { timer = null; refresh(); }, Math.max(1, Math.ceil(ms)));
  }
  function refresh() {
    const activity = pending(); // Called on request edges and at the delayed visibility threshold, never every frame.
    const count = activity.names.length;
    if (!count) {
      firstPendingAt = 0;
      clearTimer();
      toggle(false);
      return;
    }
    maxPending = Math.max(maxPending, count);
    if (!firstPendingAt) firstPendingAt = now();
    const elapsed = now() - firstPendingAt;
    if (elapsed < SHOW_DELAY_MS) {
      toggle(false);
      schedule(SHOW_DELAY_MS - elapsed);
      return;
    }
    const loadingScreenVisible = window.LoadingScreenRuntime?.getDebug?.().visible === true; // Do not compete with the existing full-screen lore loader.
    if (loadingScreenVisible || !window.__hobunjiGameRenderer) {
      toggle(false);
      schedule(RETRY_DELAY_MS); // Wake rarely only during a real pending load; also refreshed when the full-screen screen hides.
      return;
    }
    clearTimer();
    const groups = new Map(); // Small event-only grouping for a compact one-line status without raw filenames.
    for (const name of activity.names) groups.set(name, (groups.get(name) || 0) + 1);
    const parts = [...groups].slice(0, 2).map(([name, quantity]) => name + (quantity > 1 ? ' ×' + quantity : ''));
    if (groups.size > 2) parts.push('+' + (groups.size - 2) + ' types');
    write('Loading ' + parts.join(' · ') + '…');
    toggle(true);
  }

  function begin(labelText = 'world tasks') {
    const token = ++nextTaskId; // Used by track() or a yielding world loader to release exactly its own outstanding job.
    tasks.set(token, String(labelText || 'world tasks'));
    refresh();
    let ended = false; // Idempotent release protects error/cleanup paths from ending other tasks.
    return () => {
      if (ended) return;
      ended = true;
      tasks.delete(token);
      refresh();
    };
  }
  function track(promise, labelText) {
    const finish = begin(labelText);
    return Promise.resolve(promise).then(value => { finish(); return value; }, error => { finish(); throw error; });
  }

  function installAssetHooks() {
    const manager = window.THREE?.DefaultLoadingManager;
    if (!manager || manager.__hobunjiLiveLoadingWrapped) return;
    const start = manager.itemStart, end = manager.itemEnd; // Preserve every previously registered Three.js asset loader.
    if (typeof start !== 'function' || typeof end !== 'function') return;
    manager.itemStart = function liveLoadingItemStart(url) {
      const result = start.apply(this, arguments);
      const key = String(url || 'resource'); // Used to balance duplicate simultaneous requests to the same asset.
      assetRequests.set(key, (assetRequests.get(key) || 0) + 1);
      refresh();
      return result;
    };
    manager.itemEnd = function liveLoadingItemEnd(url) {
      try { return end.apply(this, arguments); }
      finally {
        const key = String(url || 'resource');
        const count = assetRequests.get(key) || 0;
        if (count === 1) assetRequests.delete(key);
        else if (count > 1) assetRequests.set(key, count - 1);
        if (count) { completedAssets++; refresh(); }
      }
    };
    manager.__hobunjiLiveLoadingWrapped = true;
  }

  installAssetHooks();
  window.LoadingScreenRuntime?.onPendingRequestsChanged?.(refresh); // One existing fetch observer rather than a new window.fetch wrapper.
  window.LoadingScreenRuntime?.onHidden?.(refresh); // Requests started during the lore screen become visible once gameplay is uncovered.
  window.HobunjiLiveLoadingStatus = Object.freeze({
    installed: true,
    begin,
    track,
    snapshot() {
      const activity = pending(); // Copyable Pixel Probe diagnostics, never assembled in the game loop.
      return {
        visible, text: label, pending: activity.names.length,
        fetches: activity.fetches, assets: activity.assets, tasks: activity.tasks,
        categories: [...new Set(activity.names)],
        maxPending, completedAssets, showDelayMs: SHOW_DELAY_MS,
      };
    },
  });
  refresh();
})();
