// Real-time cast shadows are off by default. If opted in, refresh the
// gameplay renderer's shadow map a few times per second rather than every frame.
//
// Only the farm has a shadow-casting light (game.js's fixed sunLight; its
// position and shadow camera never move). Three.js re-renders every shadow
// caster into the 1024x1024 map on each frame: on the player's farm that was
// ~270 extra draw calls per frame (MeshDepthMaterial in a draw census), on a
// machine whose GPU sat at 8-17% while the CPU could not submit draws fast
// enough. Most farm ground is unlit MeshBasicMaterial and never shows those
// shadows; Lambert furniture/rocks do, and only moving casters (windmill
// blades, actors) can make the map stale, for at most REFRESH_MS.
//
// The map is still refreshed at once when the active scene changes or its
// direct child count changes (furniture placed/removed, tiles rebuilt).
// Other modules that temporarily force autoUpdate=false keep working: they
// save and restore the (now false) value. ShadowMapRefreshThrottle.setEnabled(false)
// restores per-frame updates.
(() => {
  'use strict';
  if (window.ShadowMapRefreshThrottle) return;

  const REFRESH_MS = 250;
  let enabled = true; // Existing refresh throttle, used only if real-time shadows are enabled.
  let shadowRenderingEnabled = false; // Performance-first default, independent of lighting and authored blob shadows.
  let owned = false; // True while this module holds shadowMap.autoUpdate at false.
  let previousMap = null; // A replacement gameplay renderer must not inherit another map's throttle state.
  let lastRefreshAt = -Infinity;
  let lastScene = null;
  let lastChildCount = -1;
  const stats = { frames: 0, refreshes: 0, skipped: 0, sceneChangeRefreshes: 0 };

  function renderer() { return window.__hobunjiGameRenderer || null; }

  function tick(now = performance.now()) {
    const r = renderer();
    const shadowMap = r?.shadowMap;
    if (!shadowMap) return;
    if (shadowMap !== previousMap) {
      if (owned && previousMap) previousMap.autoUpdate = true;
      previousMap = shadowMap;
      owned = false;
      lastRefreshAt = -Infinity;
    }
    if (!shadowRenderingEnabled) {
      if (shadowMap.enabled) shadowMap.enabled = false;
      if (shadowMap.needsUpdate) shadowMap.needsUpdate = false;
      if (owned) { shadowMap.autoUpdate = true; owned = false; }
      return; // Three.js never submits the shadow caster pass.
    }
    if (!shadowMap.enabled) {
      // A stored opt-in may precede renderer creation. Re-enable on its first tick.
      shadowMap.enabled = true;
      shadowMap.needsUpdate = true;
      lastRefreshAt = -Infinity;
    }
    if (!enabled) {
      if (owned) { shadowMap.autoUpdate = true; owned = false; }
      return;
    }
    if (!owned) { shadowMap.autoUpdate = false; owned = true; lastRefreshAt = -Infinity; }
    stats.frames++;
    const scene = window.GridTileAccessors?.getActiveScene?.() || null;
    const childCount = scene?.children?.length ?? -1;
    const sceneChanged = scene !== lastScene || childCount !== lastChildCount;
    if (sceneChanged || now - lastRefreshAt >= REFRESH_MS) {
      shadowMap.needsUpdate = true; // Consumed by the next render that has a shadow-casting light (the world pass).
      lastRefreshAt = now;
      stats.refreshes++;
      if (sceneChanged) stats.sceneChangeRefreshes++;
    } else {
      stats.skipped++;
    }
    lastScene = scene;
    lastChildCount = childCount;
  }

  function setEnabled(value) {
    enabled = value !== false;
    tick(); // Apply immediately (restores autoUpdate when disabling).
    return enabled;
  }

  function setShadowRenderingEnabled(value) {
    shadowRenderingEnabled = value === true;
    const shadowMap = renderer()?.shadowMap;
    if (shadowMap) {
      shadowMap.enabled = shadowRenderingEnabled;
      if (shadowRenderingEnabled) {
        lastRefreshAt = -Infinity; // Refresh immediately after switching back on.
        shadowMap.needsUpdate = true;
      }
    }
    tick();
    return shadowRenderingEnabled;
  }

  // Settings may apply before the game renderer exists. The pre-render
  // callback below also applies the stored policy to a newly created map.
  window.RuntimeFrameScheduler?.register?.('shadow-map-refresh-throttle', frame => tick(Number(frame?.timestamp) || performance.now()), {
    phase: 'pre-render',
    owner: 'ShadowMapRefreshThrottle',
    description: 'Refreshes the farm sun shadow map every 250 ms or on scene changes instead of every frame.',
  });

  window.ShadowMapRefreshThrottle = {
    tick,
    setEnabled,
    setShadowRenderingEnabled,
    snapshot: () => ({ enabled, shadowRenderingEnabled, activeShadowMap: !!renderer()?.shadowMap?.enabled, owned, refreshMs: REFRESH_MS, ...stats }),
  };
})();
