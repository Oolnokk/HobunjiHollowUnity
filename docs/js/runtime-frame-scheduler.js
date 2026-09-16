// Shared owner for permanent browser-frame visual/runtime work.
//
// Cadence contract:
//   gameplay simulation     -> gameLoop
//   browser-frame visuals   -> RuntimeFrameScheduler
//   final render transforms -> Three.js onBeforeRender
//   low-frequency work      -> timers/events
//   one-shot layout work    -> a documented one-shot requestAnimationFrame
(() => {
  'use strict';

  const subscribers = new Map(); // Used to retain one stable, inspectable record per registered runtime.
  const frameContext = { timestamp: 0, deltaMs: 0, frameId: 0 }; // Reused for every dispatch so the scheduler itself allocates no per-frame context object.
  let rafHandle = 0; // Used to guarantee that all subscribers share exactly one scheduled browser callback.
  let browserFrameId = 0; // Used by browser-frame-lifetime caches and mobile diagnostics.
  let previousTimestamp = null; // Used to derive an informational browser-frame delta without changing subscriber cadence.
  let profilingEnabled = false; // Used only when explicitly enabled because per-subscriber timers have their own cost.
  let dispatching = false; // Used by diagnostics to reveal accidental nested dispatch without changing iteration behavior.

  function schedule() {
    if (!rafHandle && subscribers.size) rafHandle = requestAnimationFrame(runFrame);
  }

  function reportError(record, error, timestamp) {
    const message = String(error?.stack || error?.message || error); // Stored for Pixel Probe so mobile testing never requires a console.
    const signature = String(error?.message || error); // Used for throttling because stack call sites can differ between otherwise identical frame failures.
    record.errorCount++;
    record.lastError = message;
    const shouldReport = signature !== record.lastReportedError || timestamp - record.lastErrorReportAt >= 5000; // Prevents a broken subscriber from flooding the console every frame.
    if (shouldReport) {
      record.lastReportedError = signature;
      record.lastErrorReportAt = timestamp;
      console.error(`[RuntimeFrameScheduler:${record.id}]`, error);
    }
  }

  function runFrame(timestamp) {
    rafHandle = 0;
    schedule(); // Schedule first so a subscriber failure can never strand unrelated visual runtimes.
    browserFrameId++;
    frameContext.timestamp = timestamp;
    frameContext.deltaMs = previousTimestamp == null ? 0 : Math.max(0, timestamp - previousTimestamp);
    frameContext.frameId = browserFrameId;
    previousTimestamp = timestamp;
    dispatching = true;
    for (const record of subscribers.values()) {
      if (!record.enabled) continue;
      const startedAt = profilingEnabled ? performance.now() : 0; // Sampled only during an explicit profiling session.
      record.callCount++;
      record.lastFrameId = browserFrameId;
      try {
        record.callback(frameContext);
      } catch (error) {
        reportError(record, error, timestamp);
      } finally {
        if (profilingEnabled) {
          record.lastDurationMs = Math.max(0, performance.now() - startedAt);
          record.totalDurationMs += record.lastDurationMs;
          record.profiledCalls++;
        }
      }
    }
    dispatching = false;
  }

  function register(id, callback, options = {}) {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('RuntimeFrameScheduler.register requires a non-empty string id');
    if (typeof callback !== 'function') throw new TypeError(`RuntimeFrameScheduler.register(${id}) requires a callback`);
    const existing = subscribers.get(id); // Updated in place so development reloads cannot create duplicate permanent work.
    if (existing) {
      existing.callback = callback;
      existing.enabled = options.enabled ?? existing.enabled;
      existing.phase = options.phase || existing.phase;
      existing.owner = options.owner || existing.owner;
      existing.description = options.description || existing.description;
    } else {
      subscribers.set(id, {
        id,
        callback,
        enabled: options.enabled !== false,
        phase: options.phase || 'visual',
        owner: options.owner || id,
        description: options.description || '',
        callCount: 0,
        errorCount: 0,
        lastFrameId: 0,
        lastDurationMs: 0,
        totalDurationMs: 0,
        profiledCalls: 0,
        lastError: null,
        lastReportedError: null,
        lastErrorReportAt: -Infinity,
      });
    }
    schedule();
    return () => unregister(id);
  }

  function setEnabled(id, enabled) {
    const record = subscribers.get(id); // Resolved by stable ID so feature modules never retain scheduler internals.
    if (!record) return false;
    record.enabled = !!enabled;
    schedule();
    return true;
  }

  function unregister(id) {
    const removed = subscribers.delete(id); // Returned to let module dispose paths verify that they actually owned a subscription.
    if (!subscribers.size && rafHandle) {
      cancelAnimationFrame(rafHandle);
      rafHandle = 0;
      previousTimestamp = null;
    }
    return removed;
  }

  function getDebug() {
    const entries = Array.from(subscribers.values(), record => ({ // Allocated only for explicit diagnostics, never during normal frame dispatch.
      id: record.id,
      phase: record.phase,
      owner: record.owner,
      description: record.description,
      enabled: record.enabled,
      callCount: record.callCount,
      errorCount: record.errorCount,
      lastFrameId: record.lastFrameId,
      lastDurationMs: record.lastDurationMs,
      averageDurationMs: record.profiledCalls ? record.totalDurationMs / record.profiledCalls : null,
      lastError: record.lastError,
    }));
    return {
      frameId: browserFrameId,
      scheduled: !!rafHandle,
      dispatching,
      profilingEnabled,
      registered: entries.length,
      enabled: entries.filter(entry => entry.enabled).length,
      entries,
    };
  }

  window.RuntimeFrameScheduler = {
    register,
    setEnabled,
    unregister,
    frameId: () => browserFrameId,
    setProfilingEnabled: enabled => { profilingEnabled = !!enabled; },
    getDebug,
  };
})();
