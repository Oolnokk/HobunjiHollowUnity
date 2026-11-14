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
  const LABEL_REFRESH_MS = 100; // Batch visual updates during bursts of texture/model requests, avoiding repeated DOM writes.
  const RETRY_DELAY_MS = 500; // Check for the first playable renderer only while work remains outstanding.
  let nextTaskId = 0; // Distinct tokens keep simultaneous jobs with the same label independent.
  let firstPendingAt = null; // The start of continuous loading; null also handles a first request at performance.now() === 0.
  let timer = null; // Only active while pending work needs a delayed presentation.
  let timerDueAt = null; // Retains the earliest scheduled refresh instead of rescheduling on every resource event.
  let lastLabelUpdateAt = -Infinity; // Used to coalesce category text updates without delaying loading completion.
  let label = ''; // Last written text; unchanged HTML never invalidates layout.
  let visible = false; // Last applied visibility; avoids redundant DOM writes.
  let maxPending = 0; // Diagnostics for large batches, not a progress percentage.
  let completedAssets = 0; // Diagnostics: real Three.js asset completions.
  let assetPending = 0; // O(1) total for Three.js requests; avoids expanding all active URLs on every itemStart/itemEnd.
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

  function pendingCount() {
    const loading = window.LoadingScreenRuntime; // Existing fetch tracker is the sole authority for in-flight network requests.
    const fetches = loading?.pendingRequestCount?.() ?? loading?.pendingRequestNames?.()?.length ?? 0;
    return fetches + assetPending + tasks.size; // O(1) with the runtime's new count getter, even during large asset bursts.
  }

  function pending() {
    const requests = window.LoadingScreenRuntime?.pendingRequestNames?.() || []; // Collect names only for a visible label or a manual Pixel Probe snapshot.
    const groups = new Map(); // Group by category without expanding repeated Three.js URLs into thousands of array entries.
    const add = (name, count = 1) => groups.set(name, (groups.get(name) || 0) + count);
    for (const url of requests) add(classify(url));
    for (const [url, count] of assetRequests) add(classify(url), count);
    for (const name of tasks.values()) add(name);
    return { groups, total: requests.length + assetPending + tasks.size, fetches: requests.length, assets: assetPending, tasks: tasks.size };
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
    if (timer !== null) clearTimeout(timer);
    timer = null;
    timerDueAt = null;
  }
  function schedule(ms) {
    const delay = Math.max(1, Math.ceil(ms));
    const dueAt = now() + delay; // Earliest requested display deadline wins during concurrent asset starts/finishes.
    if (timer !== null && timerDueAt <= dueAt) return;
    clearTimer();
    timerDueAt = dueAt;
    timer = setTimeout(() => { timer = null; timerDueAt = null; refresh(); }, delay);
  }
  function refresh() {
    const count = pendingCount(); // Constant-time fast path on every load edge; materialize names only for a visible update.
    if (!count) {
      firstPendingAt = null;
      lastLabelUpdateAt = -Infinity;
      clearTimer();
      toggle(false);
      write(''); // Pixel Probe cannot report a stale "Loading..." message after the last request settles.
      return;
    }
    maxPending = Math.max(maxPending, count);
    if (firstPendingAt === null) firstPendingAt = now();
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
    const sinceLastLabel = now() - lastLabelUpdateAt;
    if (visible && sinceLastLabel < LABEL_REFRESH_MS) {
      schedule(LABEL_REFRESH_MS - sinceLastLabel); // Batch many short model/texture arrivals into one DOM update.
      return;
    }
    clearTimer();
    const activity = pending(); // Only visible updates and explicit snapshots scan outstanding resource names.
    const parts = [...activity.groups].slice(0, 2).map(([name, quantity]) => name + (quantity > 1 ? ' ×' + quantity : ''));
    if (activity.groups.size > 2) parts.push('+' + (activity.groups.size - 2) + ' types');
    write('Loading ' + parts.join(' · ') + '…');
    lastLabelUpdateAt = now();
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
      assetPending++;
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
        if (count) {
          assetPending--;
          completedAssets++;
          refresh();
        }
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
        visible, text: label, pending: activity.total,
        fetches: activity.fetches, assets: activity.assets, tasks: activity.tasks,
        categories: [...activity.groups.keys()],
        maxPending, completedAssets, showDelayMs: SHOW_DELAY_MS, labelRefreshMs: LABEL_REFRESH_MS,
      };
    },
  });
  refresh();
})();
