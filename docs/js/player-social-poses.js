// Held local-player social pose state. The three animation slots are
// intentionally empty until authored; this runtime is the stable chat/
// multiplayer-facing boundary that will play those clips later.
(() => {
  'use strict';

  const VALID_POSES = new Set(['sit', 'lie', 'kneel']);
  const state = { deps: null, manifest: { poses: {} }, active: null };

  async function loadManifest() {
    try {
      const response = await fetch('config/animations/player-social-poses.json');
      if (response.ok) state.manifest = await response.json();
    } catch (_) {}
    return state.manifest;
  }

  function stop(reason = 'stand') {
    if (!state.active) return false;
    const previous = state.active;
    state.active = null;
    window.dispatchEvent(new CustomEvent('hobunji-player-social-pose', {
      detail: { pose: null, previousPose: previous.pose, reason },
    }));
    return true;
  }

  function start(pose) {
    const normalized = String(pose || '').toLowerCase();
    if (normalized === 'stand') {
      const stopped = stop('command');
      return { ok: true, message: stopped ? 'You stand up.' : 'You are already standing.' };
    }
    if (!VALID_POSES.has(normalized)) return { ok: false, message: `Unknown pose: ${normalized}` };
    const definition = state.manifest.poses?.[normalized] || { animationId: normalized, frames: [] };
    state.active = { pose: normalized, definition, startedAt: performance.now() };
    window.dispatchEvent(new CustomEvent('hobunji-player-social-pose', {
      detail: { pose: normalized, animationId: definition.animationId || normalized, empty: !definition.frames?.length },
    }));
    return { ok: true, message: `You ${normalized === 'lie' ? 'lie down' : normalized}. Move to stand.` };
  }

  function update() {
    // Animation playback intentionally remains a no-op while the authored
    // frame list is empty. Keeping this call in the game loop means adding
    // frames later will not require changing chat or movement code.
    return state.active;
  }

  function init(deps) {
    state.deps = deps;
    loadManifest();
    return api;
  }

  const api = { init, start, stop, update, loadManifest, get active() { return state.active; }, validPoses: [...VALID_POSES] };
  window.PlayerSocialPoses = api;
})();
