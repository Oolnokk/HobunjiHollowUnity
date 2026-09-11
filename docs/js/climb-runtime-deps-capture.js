// Makes late ClimbSystem wrappers receive the exact dependency object game.js passes to ClimbSystem.init().
// Several climb/fall bridges install around the global assignment before game.js boots; this bridge closes
// the parser/microtask ordering hole by capturing that real init argument and replaying it once the roof
// wrapper is definitely installed. ClimbSystem.init() is assignment-only, so replaying the same deps is safe.
(() => {
  'use strict';

  if (window.HobunjiClimbRuntimeDepsCapture) return;

  let capturedDeps = null; // Used to replay the exact game.js ClimbSystem.init dependency object into late wrappers.
  let captureInit = null; // Used to detect when another wrapper (notably roof-climb) has wrapped around this capture layer.
  let assignmentPatched = false; // Used by diagnostics to confirm the pre-ClimbSystem assignment hook was armed.
  let rebound = false; // Used to guarantee the captured dependency object is replayed at most once.
  let retryRaf = 0; // Used to wait for roof-climb's deferred assignment hook without polling every frame forever.
  const debug = {
    capturedAt: 0,
    reboundAt: 0,
    lastReason: 'waiting for ClimbSystem assignment',
  }; // Used by Pixel Probe/mobile diagnostics when climb wrappers miss their init handoff.

  function scheduleRetry() {
    if (rebound || retryRaf || typeof window.requestAnimationFrame !== 'function') return;
    retryRaf = window.requestAnimationFrame(() => {
      retryRaf = 0;
      tryRebind();
    });
  }

  function tryRebind() {
    if (rebound) return true;
    if (!capturedDeps) {
      debug.lastReason = 'waiting for game ClimbSystem.init deps';
      return false;
    }
    const system = window.ClimbSystem;
    if (!system?.init) {
      debug.lastReason = 'waiting for final ClimbSystem';
      scheduleRetry();
      return false;
    }
    const roofReady = !!window.HobunjiRoofClimb?.getDebug?.()?.climbHooksInstalled;
    if (!roofReady || system.init === captureInit) {
      debug.lastReason = !roofReady ? 'waiting for roof-climb init wrapper' : 'waiting for wrapper around deps capture';
      scheduleRetry();
      return false;
    }

    // Replaying the exact original deps object is intentionally side-effect free:
    // base ClimbSystem.init only stores the reference, and every added init wrapper
    // in this branch likewise only captures that same reference before delegating.
    rebound = true;
    debug.reboundAt = Date.now();
    debug.lastReason = 'replayed live deps through final climb wrapper chain';
    system.init(capturedDeps);
    return true;
  }

  function wrapSystem(system) {
    if (!system?.init) return false;
    if (system.init.__hobunjiClimbRuntimeDepsCapture) {
      captureInit = system.init;
      return true;
    }
    const previousInit = system.init;
    function captureLiveClimbDeps(injectedDeps) {
      if (injectedDeps) {
        capturedDeps = injectedDeps;
        debug.capturedAt = Date.now();
        debug.lastReason = 'captured game ClimbSystem.init deps';
      }
      const result = previousInit.apply(this, arguments);
      // Roof-climb installs from a queued microtask after the global assignment;
      // defer the replay until that wrapper is observable.
      if (typeof queueMicrotask === 'function') queueMicrotask(tryRebind);
      else Promise.resolve().then(tryRebind);
      return result;
    }
    captureLiveClimbDeps.__hobunjiClimbRuntimeDepsCapture = true;
    captureLiveClimbDeps.__hobunjiClimbRuntimeDepsCapturePrevious = previousInit;
    system.init = captureLiveClimbDeps;
    captureInit = captureLiveClimbDeps;
    return true;
  }

  function armAssignmentHook() {
    if (window.ClimbSystem) {
      assignmentPatched = wrapSystem(window.ClimbSystem);
      return assignmentPatched;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, 'ClimbSystem');
    if (descriptor && descriptor.configurable === false) {
      debug.lastReason = 'ClimbSystem global is non-configurable';
      return false;
    }
    if (descriptor && typeof descriptor.set === 'function') {
      const priorGet = descriptor.get;
      const priorSet = descriptor.set;
      Object.defineProperty(window, 'ClimbSystem', {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return priorGet ? priorGet.call(window) : undefined; },
        set(value) {
          priorSet.call(window, value);
          const resolved = priorGet ? priorGet.call(window) : value;
          wrapSystem(resolved);
        },
      });
      assignmentPatched = true;
      debug.lastReason = 'chained existing ClimbSystem assignment hook';
      return true;
    }

    let value = descriptor?.value;
    Object.defineProperty(window, 'ClimbSystem', {
      configurable: true,
      enumerable: descriptor?.enumerable !== false,
      get() { return value; },
      set(next) {
        value = next;
        wrapSystem(next);
      },
    });
    assignmentPatched = true;
    debug.lastReason = 'armed ClimbSystem assignment hook';
    return true;
  }

  armAssignmentHook();

  window.HobunjiClimbRuntimeDepsCapture = Object.freeze({
    tryRebind,
    getDebug() {
      return {
        assignmentPatched,
        depsCaptured: !!capturedDeps,
        rebound,
        retryPending: !!retryRaf,
        ...debug,
      };
    },
  });
})();
