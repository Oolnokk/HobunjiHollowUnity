// Reuses ordinary layered-weapon fire, marker recolor, and torch cloth-darkening.
// Independent of the player, portrait, and stow pose; only owns one PNG and its visual effects.
(function (global) {
  'use strict';
  if (global.HobunjiStowedTorchFire) return;

  const TORCH_SOURCE = 'assets/toolsprites/torch.png'; // Identical uncolored source used by the carried torch assembly.

  function create(THREE, art, display) {
    if (!THREE?.TextureLoader || !art || !display) return null;
    let rawTexture = null; // Cache one immutable original image to keep marker scanning separate from held recolors.
    let rawLoading = false; // Only one asynchronous source request may be outstanding.
    let nextTextureRetryAt = 0; // Retry unsuccessful image loading no more than once every five seconds.
    let nextFireRetryAt = 0; // Throttle layered-effects setup failures rather than allocating every frame.
    let fireState = null; // The active state owned by HobunjiLayeredWeaponEffects.
    let lastFireAt = null; // Fire simulation timestamp, reset on every draw, burnout, or avatar rebuild.
    let fireError = null; // Console-free loading and renderer error readout.

  function sourceImageDimensions(image) {
    return { width:Number(image?.naturalWidth || image?.width) || 0,
      height:Number(image?.naturalHeight || image?.height) || 0 }; // Same original PNG dimensions used by WeaponSpriteAssemblies.
  }
  function prepareFire() {
    if (fireState || !art || !rawTexture?.image) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now(); // Only used on setup failures, never on an emitting frame.
    if (now < nextFireRetryAt) return;
    const effects = global.HobunjiLayeredWeaponEffects; // Reuse the carried torch's recolor, cloth-darkening and particle engine verbatim.
    const base = global.WEAPON_SPRITE_ASSEMBLY_CONFIG?.weapons?.torch?.base; // Authoritative torch material and VFX settings.
    const { width } = sourceImageDimensions(rawTexture.image);
    if (!effects?.registerLayer || !effects?.activateStatic || !effects?.stepFire || !effects?.dispose
      || !base || !(width > 0) || !rawTexture.clone) {
      fireError = 'shared weapon fire unavailable'; return;
    }
    let partiallyBuilt = null; // Retire emitter groups even if activation throws halfway through setup.
    try {
      const copy = rawTexture.clone(); // Private map: recoloring the belt cannot mutate the cached source or an in-hand torch.
      copy.needsUpdate = true;
      art.material.map = copy;
      art.material.needsUpdate = true;
      const state = { THREE, plane:art, itemKey:'torch', masteryLevel:() => 5, dead:false }; // Fields consumed by the same layer-effects calls as a held rigid weapon.
      partiallyBuilt = state;
      effects.registerLayer(state, art, { id:'base', ...base }, rawTexture.image);
      effects.activateStatic(state, base, [], [], rawTexture.image, (global.HobunjiBeltStowRig?.TORCH_WIDTH || .5) / width);
      const emitter = state.fireEmitters?.find(fx => fx.sources?.length); // Real flame marker pixels, including bottom-tip fallback when a marker is absent.
      if (emitter) {
        const sourceWidth = Number(emitter.image?.width) || width; // Same unmodified image dimensions used by the particle emitter.
        const sourceHeight = Number(emitter.image?.height) || sourceImageDimensions(rawTexture.image).height;
        let sumX = 0, sumY = 0;
        for (const pixel of emitter.sources) {
          sumX += pixel % sourceWidth;
          sumY += Math.floor(pixel / sourceWidth);
        }
        display?.setEmitterSourcePoint?.(sumX / emitter.sources.length, sumY / emitter.sources.length,
          sourceWidth, sourceHeight); // Rotate about the actual grip/emission midpoint, not the PNG bounds' midpoint.
      }
      fireState = state;
      lastFireAt = null;
      fireError = emitter ? null : 'source PNG yielded no fire emitter'; // Fail visibly in Pixel Probe instead of pretending a torch without particles is ready.
    } catch (error) {
      fireError = String(error?.message || error);
      nextFireRetryAt = now + 2000;
      try { if (partiallyBuilt) effects?.dispose?.(partiallyBuilt); } catch {} // A failed setup cannot leak a half-built particle group into the scene.
      global.__farmLog?.('[stowed torch] Shared fire init failed: ' + fireError, 'warn');
      art.material.map?.dispose?.();
      art.material.map = null; art.material.needsUpdate = true;
    }
  }
  function retireFire() {
    if (!fireState) return;
    global.HobunjiLayeredWeaponEffects?.dispose?.(fireState); // Clear every mote on draw, burnout and character rebuild.
    fireState = null; lastFireAt = null;
    art?.material?.map?.dispose?.(); // Only the belt-owned clone is released; the shared source texture is retained.
    if (art?.material) { art.material.map = null; art.material.needsUpdate = true; }
  }
  function ensure() {
    if (rawTexture) { prepareFire(); return; }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now(); // Asset errors are bounded; successful loads never poll time.
    if (rawLoading || now < nextTextureRetryAt) return;
    rawLoading = true;
    try {
      new THREE.TextureLoader().load(TORCH_SOURCE, texture => {
        global.HobunjiSpritePngSurface?.configureTexture?.(THREE, texture, TORCH_SOURCE);
        if (THREE.NearestFilter !== undefined) texture.minFilter = texture.magFilter = THREE.NearestFilter; // Match the held tool factory's pixel-sharp sampling, not the portrait pipeline's linear filtering.
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        rawTexture = texture;
        rawLoading = false;
        if (art?.parent?.visible && art.visible!==false) prepareFire(); // Late texture load immediately enables both the recolor and the correct fire.
      }, undefined, error => {
        rawLoading = false;
        nextTextureRetryAt = now + 5000;
        fireError = 'source PNG: ' + String(error?.message || error);
        global.__farmLog?.('[stowed torch] ' + fireError, 'warn');
      });
    } catch (error) {
      rawLoading = false;
      nextTextureRetryAt = now + 5000;
      fireError = 'source PNG loader: ' + String(error?.message || error);
      global.__farmLog?.('[stowed torch] ' + fireError, 'warn');
    }
  }

  function step(timestamp, torch) {
    if (!fireState) return false;
    let delta;
    if (lastFireAt === null) {
      const burn = torch.debug; // Read once on transfer, not every frame: the wick must not restart its 180ms darkening after being carried lit.
      const alreadyBurnedMs = Math.max(0, (Number(burn?.burnDurationMs) || 30000) - (Number(burn?.burnRemainingMs) || 0));
      const clothDarkenS = Number(global.WEAPON_SPRITE_ASSEMBLY_CONFIG?.weapons?.torch?.base?.vfx?.clothDarkenS) || .18;
      delta = Math.min(Math.max(.01, clothDarkenS), alreadyBurnedMs / 1000); // Prime exactly the elapsed carried wick transition; bounded by the shared recipe.
    } else {
      delta = Math.max(0, Math.min(.05, (timestamp - lastFireAt) / 1000)); // Prevent resumed-tab particle bursts.
    }
    lastFireAt = timestamp;
    global.HobunjiLayeredWeaponEffects?.stepFire?.(fireState, delta); // Same wick tint and world-rise particles as the held torch.
    return true;
  }

  return Object.freeze({
    ensure,
    retire: retireFire,
    step,
    get active() { return !!fireState; },
    get debug() {
      return {
        fireVisible: !!art.parent?.visible && !!fireState?.fireEmitters?.length,
        fireEmitters: fireState?.fireEmitters?.length || 0,
        fireParticles: fireState?.fireEmitters?.reduce((count, fx) => count + fx.particles.length, 0) || 0,
        sharedFire: !!fireState,
        fireError,
        textureReady: !!art.material?.map?.image,
      };
    },
  });
  }

  global.HobunjiStowedTorchFire = Object.freeze({ create });
})(window);
