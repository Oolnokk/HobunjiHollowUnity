// Shared owner for the browser's one gameplay requestAnimationFrame.
//
// Cadence contract:
//   gameplay simulation     -> gameLoop, invoked as the scheduler's frame driver
//   browser-frame visuals   -> RuntimeFrameScheduler subscribers
//   final render transforms -> Three.js onBeforeRender
//   low-frequency work      -> timers/events
//   one-shot layout work    -> a documented one-shot requestAnimationFrame
//
// Frame order contract (see docs/architecture/runtime-frame-scheduler.md):
//   requestAnimationFrame
//     -> input       (earliest browser-frame work)
//     -> pre-game     (after input, before gameplay simulation)
//     -> frame driver (gameLoop: simulation, AI, movement, resources...)
//          -> pre-render checkpoint (after simulation/state mutation,
//             immediately before gameplay rendering; the driver itself
//             calls RuntimeFrameScheduler.checkpoint('pre-render') at
//             exactly that point)
//     -> post-game    (after the frame driver/render has completed)
// Within one phase, subscribers run in stable registration order.
(() => {
  'use strict';

  const PHASES = Object.freeze(['input', 'pre-game', 'pre-render', 'post-game']); // The only valid subscriber phases; dispatch order for input/pre-game/post-game, and the sole valid checkpoint() name for pre-render.
  const PHASE_SET = new Set(PHASES);

  const subscribers = new Map(); // Used to retain one stable, inspectable record per registered runtime.
  const frameContext = { timestamp: 0, deltaMs: 0, frameId: 0 }; // Reused for every dispatch so the scheduler itself allocates no per-frame context object.
  let rafHandle = 0; // Used to guarantee that all subscribers share exactly one scheduled browser callback.
  let browserFrameId = 0; // Used by browser-frame-lifetime caches and mobile diagnostics.
  let previousTimestamp = null; // Used to derive an informational browser-frame delta without changing subscriber cadence.
  let profilingEnabled = false; // Used only when explicitly enabled because per-subscriber timers have their own cost.
  let dispatching = false; // True for the whole runFrame duration; used by diagnostics and to reveal accidental nested dispatch.
  let frameDriver = null; // The single gameplay simulation owner (gameLoop), invoked once between pre-game and post-game.
  let runningFrameDriver = false; // True only while frameDriver(frameContext) is executing; checkpoint() is only valid in this window.
  let preRenderFiredThisFrame = false; // Guards against a second checkpoint('pre-render') call within the same frame.
  let driverErrorState = { errorCount: 0, lastError: null, lastReportedError: null, lastErrorReportAt: -Infinity }; // Mirrors a subscriber record's error bookkeeping for the one frame driver.

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

  function dispatchOne(record, timestamp) {
    if (!record.enabled || browserFrameId < record.firstFrameId) return;
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

  function dispatchPhase(phase, timestamp) {
    for (const record of subscribers.values()) {
      if (record.phase === phase) dispatchOne(record, timestamp);
    }
  }

  function runFrameDriver(timestamp) {
    if (!frameDriver) return;
    runningFrameDriver = true;
    try {
      frameDriver(frameContext);
    } catch (error) {
      const message = String(error?.stack || error?.message || error);
      const signature = String(error?.message || error);
      driverErrorState.errorCount++;
      driverErrorState.lastError = message;
      const shouldReport = signature !== driverErrorState.lastReportedError || timestamp - driverErrorState.lastErrorReportAt >= 5000;
      if (shouldReport) {
        driverErrorState.lastReportedError = signature;
        driverErrorState.lastErrorReportAt = timestamp;
        console.error('[RuntimeFrameScheduler:frame-driver]', error); // A failed simulation frame must not strand input/pre-game/post-game subscribers or the next browser frame.
      }
    } finally {
      runningFrameDriver = false;
    }
  }

  function runFrame(timestamp) {
    rafHandle = 0;
    schedule(); // Schedule first so a subscriber or frame-driver failure can never strand unrelated visual runtimes.
    browserFrameId++;
    frameContext.timestamp = timestamp;
    frameContext.deltaMs = previousTimestamp == null ? 0 : Math.max(0, timestamp - previousTimestamp);
    frameContext.frameId = browserFrameId;
    previousTimestamp = timestamp;
    dispatching = true;
    preRenderFiredThisFrame = false;
    dispatchPhase('input', timestamp);
    dispatchPhase('pre-game', timestamp);
    runFrameDriver(timestamp);
    dispatchPhase('post-game', timestamp);
    dispatching = false;
  }

  function register(id, callback, options = {}) {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('RuntimeFrameScheduler.register requires a non-empty string id');
    if (typeof callback !== 'function') throw new TypeError(`RuntimeFrameScheduler.register(${id}) requires a callback`);
    if (options.phase !== undefined && !PHASE_SET.has(options.phase)) {
      throw new TypeError(`RuntimeFrameScheduler.register(${id}) has unknown phase "${options.phase}" (expected one of: ${PHASES.join(', ')})`);
    }
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
        phase: options.phase || 'post-game', // Most existing subscribers are HUD/presentation work with no ordering dependency on gameplay simulation.
        owner: options.owner || id,
        description: options.description || '',
        firstFrameId: browserFrameId + 1, // Prevents registration during dispatch from extending the active frame's participant set.
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

  // Registers gameLoop (or an equivalent gameplay simulation entry point) as
  // the scheduler's one frame driver. Idempotent for the same function
  // (safe for a dev reload of the same script); rejects a second, different
  // driver rather than silently replacing or stacking it, since exactly one
  // gameplay RAF cadence owner is the entire point of this contract.
  function setFrameDriver(fn) {
    if (typeof fn !== 'function') throw new TypeError('RuntimeFrameScheduler.setFrameDriver requires a callback');
    if (frameDriver && frameDriver !== fn) throw new Error('RuntimeFrameScheduler.setFrameDriver: a frame driver is already set; only one gameplay RAF cadence owner is allowed');
    frameDriver = fn;
    schedule();
  }

  // Called by the frame driver itself, synchronously, at the exact point
  // simulation/state mutation has finished and gameplay rendering is about
  // to begin. Dispatches every 'pre-render' subscriber in registration
  // order. Throws (rather than silently no-oping) on misuse, matching
  // register()'s existing contract-violation behavior, since a wrong
  // checkpoint call is a bug in the calling integration code, not in an
  // isolated subscriber.
  function checkpoint(name) {
    if (!PHASE_SET.has(name)) throw new TypeError(`RuntimeFrameScheduler.checkpoint: unknown phase "${name}" (expected one of: ${PHASES.join(', ')})`);
    if (name !== 'pre-render') throw new TypeError(`RuntimeFrameScheduler.checkpoint: "${name}" is not a checkpoint phase (only 'pre-render' is dispatched via checkpoint(); input/pre-game/post-game dispatch automatically)`);
    if (!runningFrameDriver) throw new Error('RuntimeFrameScheduler.checkpoint("pre-render") called outside an active frame driver call');
    if (preRenderFiredThisFrame) throw new Error('RuntimeFrameScheduler.checkpoint("pre-render") called twice in the same frame');
    preRenderFiredThisFrame = true;
    dispatchPhase('pre-render', frameContext.timestamp);
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
      hasFrameDriver: !!frameDriver,
      frameDriverErrorCount: driverErrorState.errorCount,
      frameDriverLastError: driverErrorState.lastError,
      entries,
    };
  }

  window.RuntimeFrameScheduler = {
    register,
    setEnabled,
    unregister,
    setFrameDriver,
    checkpoint,
    frameId: () => browserFrameId,
    setProfilingEnabled: enabled => { profilingEnabled = !!enabled; },
    getDebug,
  };
})();
