// Renders the local player and body-bound attachments on authored town
// visualHeights without feeding that visual lift back into gameplay movement.
//
// The normal movement loop owns playerMesh.position.y. Town subtle elevation is
// a final render-only PlayerBodyTransformComposer translation, so the newly
// centralized equipped-tool and shoulder-pet roots receive the exact same lift
// as the player while retaining their own attack/perch transforms.
(() => {
  'use strict';

  const composer = window.PlayerBodyTransformComposer;
  const terrain = window.HobunjiTownSubtleElevation;
  if (!composer || !terrain?.sampleHeightAt || window.__hobunjiTownBodyElevationBridgeInstalled) return;
  window.__hobunjiTownBodyElevationBridgeInstalled = true;

  const CHANNEL = 'townSubtleElevation';
  const CHANNEL_PRIORITY = 50;
  const EPSILON = 1e-8;
  let lastDebug = {
    active: false,
    lift: 0,
    x: null,
    z: null,
    movementOwnedBaseY: null,
    reason: 'not-initialized',
  };

  function clearChannel(reason, playerMesh = null) {
    composer.clearChannel(CHANNEL);
    lastDebug = {
      active: false,
      lift: 0,
      x: Number.isFinite(Number(playerMesh?.position?.x)) ? Number(playerMesh.position.x) : null,
      z: Number.isFinite(Number(playerMesh?.position?.z)) ? Number(playerMesh.position.z) : null,
      movementOwnedBaseY: Number.isFinite(Number(playerMesh?.position?.y)) ? Number(playerMesh.position.y) : null,
      reason,
    };
  }

  function syncChannel(injectedDeps) {
    const playerMesh = injectedDeps?.playerMesh || composer.getPlayerMesh?.();
    if (injectedDeps?.getCurrentArea?.() !== 'town') {
      clearChannel('outside-town', playerMesh);
      return;
    }
    if (!playerMesh?.position) {
      clearChannel('no-player-root');
      return;
    }

    const sit = injectedDeps?.getSitInteraction?.();
    if (sit && sit.phase !== 'out') {
      // Seats own their authored vertical anchor. Do not add terrain lift on top.
      clearChannel('seated', playerMesh);
      return;
    }

    const x = Number(playerMesh.position.x) || 0;
    const z = Number(playerMesh.position.z) || 0;
    const baseY = Number(playerMesh.position.y) || 0;
    const lift = Number(terrain.sampleHeightAt(x, z)) || 0;

    if (Math.abs(lift) > EPSILON) {
      composer.setChannel(CHANNEL, {
        priority: CHANNEL_PRIORITY,
        mode: 'additive',
        translationMode: 'additive',
        translation: { x: 0, y: lift, z: 0 },
      });
      lastDebug = {
        active: true,
        lift,
        x,
        z,
        movementOwnedBaseY: baseY,
        reason: 'town-subtle-height',
      };
    } else {
      clearChannel('zero-lift', playerMesh);
    }
  }

  function patchPixelProbe(api) {
    if (!api || api.__hobunjiTownBodyElevationBridge || typeof api.init !== 'function') return api;
    const compatibilityInit = api.init;

    api.init = function townBodyElevationAwarePixelProbeInit(injectedDeps) {
      const renderer = injectedDeps?.renderer;

      // config.js's older compatibility wrapper would otherwise persist its
      // sampled lift into playerMesh.position.y. Mark that instance hook as
      // already handled before invoking it; movement remains the sole owner of
      // base Y and this module supplies only the final visual delta.
      if (renderer) renderer.__hobunjiTownHeightRenderHook = true;

      const result = compatibilityInit.call(this, injectedDeps);
      if (!renderer || typeof renderer.render !== 'function' || renderer.__hobunjiTownBodyElevationRenderHook) return result;

      const baseRender = renderer.render;
      renderer.render = function townBodyElevationRender(...args) {
        syncChannel(injectedDeps);
        return baseRender.apply(this, args);
      };
      renderer.__hobunjiTownBodyElevationRenderHook = true;
      renderer.__hobunjiTransientTownHeightRepair = true;
      return result;
    };

    api.__hobunjiTownBodyElevationBridge = true;
    // zone-grass-billboards.js carries the pre-composer transient player-only
    // repair for older builds. Suppress it now that the composer owns the lift.
    api.__hobunjiTransientTownHeightRepair = true;
    return api;
  }

  function installPixelProbeHook() {
    if (window.PixelProbe) {
      patchPixelProbe(window.PixelProbe);
      return;
    }

    // config.js publishes PixelProbe through a configurable future-global
    // setter. Chain it so its diagnostics remain intact, then replace only the
    // old player-height render behavior after the real API has been assigned.
    const descriptor = Object.getOwnPropertyDescriptor(window, 'PixelProbe');
    if (!descriptor?.configurable || typeof descriptor.set !== 'function') return;
    const priorGet = descriptor.get;
    const priorSet = descriptor.set;
    Object.defineProperty(window, 'PixelProbe', {
      configurable: true,
      enumerable: descriptor.enumerable !== false,
      get() { return priorGet ? priorGet.call(window) : undefined; },
      set(value) {
        priorSet.call(window, value);
        patchPixelProbe(priorGet ? priorGet.call(window) : value);
      },
    });
  }

  installPixelProbeHook();

  window.HobunjiTownBodyElevationBridge = {
    channel: CHANNEL,
    getDebug() {
      const attachmentDebug = window.PlayerBodyAttachmentBridge?.getDebug?.() || null;
      return {
        ...lastDebug,
        visualRoots: composer.getVisualRoots?.().map(root => root?.name || root?.type || 'Object3D') || [],
        hasToolHolder: attachmentDebug?.hasToolHolder ?? null,
        activeShoulderPets: attachmentDebug?.activeShoulderPets ?? null,
      };
    },
  };
})();
