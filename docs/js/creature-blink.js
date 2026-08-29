// Shared eye-blink timer for genotype-rendered animal creatures (see
// creature-genetics-render.js's composeFrame blinkShut param). One timer
// per creature instance (keyed by the entity object itself via WeakMap),
// so a pack of the same species doesn't all blink in lockstep — mirrors
// portrait-utils.js's per-head-URL blink timer (getBlinkConfig/
// shouldRenderBlink) but keyed by instance instead of by sprite URL, since
// every instance of the same species otherwise shares one texture cache
// key and would blink in perfect unison.
//
// Public API: window.CreatureBlink = { isShut(entity, nowMs) -> boolean }
(() => {
  'use strict';

  function config() {
    const cfg = window.SCRATCHBONES_CONFIG?.game?.animalBlink || {};
    return {
      minIntervalMs: Number.isFinite(Number(cfg.minIntervalMs)) ? Number(cfg.minIntervalMs) : 2500,
      maxIntervalMs: Number.isFinite(Number(cfg.maxIntervalMs)) ? Number(cfg.maxIntervalMs) : 6000,
      durationMs: Number.isFinite(Number(cfg.durationMs)) ? Number(cfg.durationMs) : 140,
    };
  }

  const _state = new WeakMap(); // entity -> { nextBlinkAt, shutUntil }

  function isShut(entity, nowMs) {
    if (!entity) return false;
    const now = Number.isFinite(nowMs) ? nowMs : performance.now();
    let state = _state.get(entity);
    if (!state) {
      const cfg = config();
      // Staggers each creature's very first blink across its own initial
      // window instead of every freshly-spawned creature blinking at once.
      state = { nextBlinkAt: now + cfg.minIntervalMs + Math.random() * (cfg.maxIntervalMs - cfg.minIntervalMs), shutUntil: 0 };
      _state.set(entity, state);
    }
    if (now >= state.nextBlinkAt) {
      const cfg = config();
      state.shutUntil = now + cfg.durationMs;
      state.nextBlinkAt = state.shutUntil + cfg.minIntervalMs + Math.random() * (cfg.maxIntervalMs - cfg.minIntervalMs);
    }
    return now < state.shutUntil;
  }

  window.CreatureBlink = { isShut };
})();
