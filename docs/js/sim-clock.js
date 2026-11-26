(() => {
  'use strict';

  // SimClock — the clock that gameplay timers (combo windows, charge time,
  // stamina regen/exhaustion windows) read instead of calling
  // performance.now() directly. Locally it is performance.now() plus an
  // offset; in a co-op session the guest sets the offset so its timers agree
  // with the host's (host time = local time + offset). With no session the
  // offset is 0 and this is exactly performance.now().
  //
  // Presentation-only timers (particles, audio variance, UI easing) should
  // stay on performance.now(): they must not jump when the offset is re-synced.

  let offsetMs = 0;
  let source = () => performance.now();

  const now = () => source() + offsetMs;

  window.SimClock = {
    now,
    nowSeconds: () => now() / 1000,
    getOffsetMs: () => offsetMs,
    // Re-sync (e.g. from a host ping/pong). Callers that cache absolute
    // deadlines must re-base them; deadlines should be kept as `now() + dur`.
    setOffsetMs: ms => { offsetMs = Number.isFinite(ms) ? ms : 0; },
    // Test/replay hook: replace the underlying time source.
    setSource: fn => { source = typeof fn === 'function' ? fn : () => performance.now(); },
  };
})();
