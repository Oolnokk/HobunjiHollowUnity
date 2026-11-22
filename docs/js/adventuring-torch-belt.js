// One posterior-stowed torch sharing the held torch's marker tint, ignition cloth and fire motes.
// AdventuringTools alone owns the lit/burn clock; this module owns only its stowed visual.
(function (global) {
  'use strict';
  if (global.AdventuringTorchBelt) return;

  const SAMPLE_INTERVAL_MS = 100; // Resample the posterior rig at 10 Hz; avoid repeated profile lookup on each frame.
  const TORCH_SOURCE = 'assets/toolsprites/torch.png'; // Original uncolored mask source, identical to the carried torch's assembly definition.
  let root = null; // One posterior stow display, reparented when the player's mesh is rebuilt.
  let art = null; // Own stowed mesh; uses the exact same authored PNG and material recipe as the held torch.
  let rawTexture = null; // Loaded original source PNG; marker masks must never sample the held instance's already-tinted canvas.
  let rawLoading = false; // Only one source request, even if many frames pass before load.
  let nextTextureRetryAt = 0; // Throttle failed image fetches instead of retrying during every render frame.
  let nextFireRetryAt = 0; // A renderer error can recover without triggering a shader/texture allocation storm.
  let fireState = null; // The ordinary HobunjiLayeredWeaponEffects state for this one stowed PNG.
  let lastFireAt = null; // Limits particle simulation to the period actually stowed.
  let fireError = null; // Mobile diagnostics for missing renderer/source failures.
  let lastSampleAt = -Infinity; // Throttles posterior profile lookup while preserving the live character height.
  let placement = 'not ready'; // Mobile Pixel Probe reports actual positioning provenance.
  let display = null; // Shared stow display consumes the same authored idle-scale multiplier used by the held torch.
  let ownerBody = null; // Current character owner; portrait children can change without rebuilding this body.
  let portraitMount = null; // Active portrait parent; stowed gear follows the same independent portrait facing as back Burdens.
  let lastPoseKey = null; // Skip costly world-space reparenting when the authored/anatomical attachment has not changed.
  let posteriorPosition = null; // Body-local anatomical coordinate retained for mobile diagnosis after portrait reparenting.
  let desiredStowAngleDeg = -45; // Authoritative body-space tilt, independent of the portrait-relative affine transform.
  let reparentMatrix = null; // Reused 4x4 scratch transform for exact posterior-to-portrait attachment; no per-frame allocations.

  function playerBody() {
    return global.PlayerBodyTransformComposer?.getPlayerMesh?.()
      || global.ProceduralHandAttachments?.gameDeps?.playerMesh
      || global.Combat?.deps?.playerMesh || null;
  }
  function equippedPlane() {
    const deps = global.ProceduralHandAttachments?.gameDeps || global.Combat?.deps;
    return deps?.toolMeshMap?.adventuring?.userData?.toolPlane || null;
  }
  function materialMap(material) {
    const parts = Array.isArray(material) ? material : [material];
    return parts.find(part => part?.map)?.map || null;
  }
  function ensureRoot(THREE) {
    if (root) return root;
    const factory = global.HobunjiBeltStowRig?.createTorchDisplay; // Single authored PNG/particle geometry used by gameplay and Rig Coordinates.
    const preview = factory?.(THREE, { previewFlame:false }); // Gameplay always uses the real carried-torch fire profile, never the editor's decorative flame.
    if (!preview) { placement = 'shared belt art unavailable'; return null; }
    display = preview;
    root = preview.root;
    art = preview.art;
    return root;
  }
  function belongsToBody(node, body) {
    for (let cursor = node; cursor; cursor = cursor.parent) if (cursor === body) return true;
    return false; // Never attach a torch to an avatar retained from a previous area/player rebuild.
  }
  function currentPortrait(body) {
    const avatar = global.WorldPortraitLife?.getPlayerAvatar?.()?.group;
    if (!avatar || !belongsToBody(avatar, body)) return body;
    const rigged = avatar.userData?.neckRig?.skinnedPlane; // Back-carried Burdens follow this active skinned portrait rather than a stale legacy mesh.
    if (rigged?.parent && belongsToBody(rigged, avatar)) return rigged;
    return avatar; // Rigid portraits already follow their group: no per-frame mesh traversal or stale plane cache.
  }
  function sourceImageDimensions(image) {
    return { width:Number(image?.naturalWidth || image?.width) || 0,
      height:Number(image?.naturalHeight || image?.height) || 0 }; // Same original PNG dimensions used by WeaponSpriteAssemblies.
  }
  function prepareFire(THREE) {
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
  function updateTexture(THREE) {
    if (rawTexture) { prepareFire(THREE); return; }
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
        if (root?.visible) prepareFire(THREE); // Late texture load immediately enables both the recolor and the correct fire.
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
  function positionAtPosterior(body, timestamp, target) {
    if (timestamp - lastSampleAt < SAMPLE_INTERVAL_MS && root.parent === target) return;
    lastSampleAt = timestamp;
    const height = Number(body.userData?.portraitModelHeight) || .9; // Small rear clearance scales with the current character.
    const species = String(body.userData?.speciesId || body.userData?.species || 'mao-ao').toLowerCase();
    const gender = String(body.userData?.gender || 'male').toLowerCase();
    const rig = global.HobunjiBeltStowRig;
    const profile = rig?.characterProfile?.(global.HOBUNJI_ATTACHMENT_RIG_PROFILES, species, gender);
    const origin = profile?.anchors?.posterior?.position || {}; // Same anatomical posterior source used by carried Burdens.
    const liveY = Number(global.PlayerBodyTransformComposer?.getPosteriorY?.());
    const point = {
      x: Number(origin.x) || 0,
      y: Number.isFinite(liveY) && liveY !== 0 ? liveY : Number(origin.y) || .5 * height,
      z: (Number(origin.z) || 0) - .04 * height,
    }; // Body-local base coordinate, before portrait yaw and authoring overrides.
    const configured = rig?.configuredSnapshot?.(global.HOBUNJI_ATTACHMENT_RIG_PROFILES, species, gender);
    const pose = configured || {
      position:point, rotationDeg:{x:0,y:0,z:-45}, scale:{x:1,y:1,z:1},
    }; // A profile's explicit stow coordinates retain precedence over the natural posterior.
    const key = ['position','rotationDeg','scale'].flatMap(group =>
      ['x','y','z'].map(axis => Number(pose[group]?.[axis]) || 0)).join('|');
    posteriorPosition = point;
    desiredStowAngleDeg = pose.rotationDeg.z;
    if (root.parent === target && key === lastPoseKey) return; // No matrix bake or allocation for ordinary animation frames.
    if (root.parent !== body) body.add(root); // First express the stowed torch in the anatomical player's body space.
    root.matrixAutoUpdate = true; // A previous portrait mount may have used an exact affine matrix rather than local TRS.
    rig?.placeRoot?.(root, pose);
    placement = configured ? 'authored beltStow override' : 'anatomical posterior, behind portrait';
    portraitMount = null;
    if (target && target !== body && typeof target.matrixWorld?.copy === 'function' && global.THREE?.Matrix4
      && typeof root.updateMatrix === 'function' && typeof target.add === 'function') {
      body.updateWorldMatrix?.(true, false);
      target.updateWorldMatrix?.(true, false);
      root.updateMatrix();
      reparentMatrix ||= new global.THREE.Matrix4();
      reparentMatrix.copy(target.matrixWorld).invert().multiply(body.matrixWorld).multiply(root.matrix); // Exact affine inverse preserves nonuniform rig scale and portrait yaw without an approximate quaternion decomposition.
      target.add(root);
      root.matrix.copy(reparentMatrix);
      root.matrixAutoUpdate = false; // Keep the full relative matrix, including shear caused by scaled/rotated ancestors.
      root.matrixWorldNeedsUpdate = true;
      portraitMount = target;
    } else if (target && target !== body && typeof target.attach === 'function') {
      target.attach(root); // Standalone author/legacy adapters without matrices retain the normal parent-preserving route.
      portraitMount = target;
    }
    lastPoseKey = key;
  }
  function sync(frame = {}) {
    const torch = global.AdventuringTools;
    torch?.updateBurn?.(); // Expiry runs even while held; a belt is not required for the burn clock.
    const body = playerBody();
    if (!torch || !body || !global.THREE) {
      if (root) root.visible = false;
      retireFire(); // A temporarily missing avatar cannot retain old lit motes in the previous scene.
      ownerBody = null; portraitMount = null; lastPoseKey = null; lastSampleAt = -Infinity;
      return;
    }
    const THREE = global.THREE;
    if (!ensureRoot(THREE)) return;
    if (ownerBody !== body) {
      retireFire(); body.add(root); ownerBody = body;
      portraitMount = null; lastPoseKey = null; lastSampleAt = -Infinity;
    } // Rebuilds retire the old character's motes and force a new posterior/portrait attachment.
    const burning = torch.isLit(); // Always query the authoritative 30-second flame clock before showing a belt copy.
    const stowed = burning && !torch.isHoldingTorch();
    root.visible = stowed;
    if (!stowed) { retireFire(); return; } // Drawing, burnout and throws remove the stowed emitters; the one burn clock continues in AdventuringTools.
    updateTexture(THREE);
    const plane = equippedPlane(); // Preserve live held-tool dimensions without borrowing its already-colored texture.
    const authoredPlaneSize = plane?.geometry?.parameters; // Real game.js PlaneGeometry dimensions already incorporate PNG aspect.
    const textureImage = materialMap(plane?.material)?.image || art?.material?.map?.image; // Fallback for unloaded/rebuilt held mesh.
    const fallbackWidth = global.HobunjiBeltStowRig?.TORCH_WIDTH || .5; // Canonical game/tool editor base width when the live plane is unavailable.
    const sourceWidth = Number(authoredPlaneSize?.width) > 0 ? Number(authoredPlaneSize.width) : fallbackWidth; // Sprite base width before Neutral size.
    const sourceHeight = Number(authoredPlaneSize?.height) > 0 ? Number(authoredPlaneSize.height)
      : Number(textureImage?.height || textureImage?.naturalHeight) > 0 && Number(textureImage?.width || textureImage?.naturalWidth) > 0
        ? sourceWidth * Number(textureImage.height || textureImage.naturalHeight) / Number(textureImage.width || textureImage.naturalWidth)
        : global.HobunjiBeltStowRig?.TORCH_HEIGHT || .5; // Preserve real PNG proportions through portrait/tool rebuilds.
    display?.setSourceDimensions?.(sourceWidth, sourceHeight); // Cached child transform; no per-frame mesh allocations.
    const idleScale = Number(global.WeaponToolStances?.poses?.torchHold?.scale ?? global.HeldActionAnimations?.torchIdle?.poses?.neutral?.scale) || 1; // Same live Neutral multiplier as the held torch, including editor overrides.
    display?.setIdleScale?.(idleScale); // Both ends remain equidistant from the actual stowed rotation midpoint.
    const timestamp = Number.isFinite(Number(frame.timestamp)) ? Number(frame.timestamp) : performance.now();
    positionAtPosterior(body, timestamp, currentPortrait(body));
    if (!fireState) return; // Original PNG or shared engine is not ready; never substitute a different flame style.
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
    root.updateWorldMatrix?.(true, true); // Refresh the complete cached art/emitter subtree once; world-rise particles read the actual posterior and 45° pose.
    global.HobunjiLayeredWeaponEffects.stepFire(fireState, delta); // Exact held-fire behavior: recolored wick, lit darkening and world-up motes.
  }

  global.AdventuringTorchBelt = Object.freeze({
    sync,
    get debug() {
      return {
        visible: !!root?.visible && !!root.parent,
        attachedToPlayer: !!root && ownerBody === playerBody() && belongsToBody(root, ownerBody),
        attachedToPortrait: !!portraitMount && root?.parent === portraitMount,
        fireVisible: !!root?.visible && !!fireState?.fireEmitters?.length,
        fireEmitters: fireState?.fireEmitters?.length || 0,
        fireParticles: fireState?.fireEmitters?.reduce((count, fx) => count + fx.particles.length, 0) || 0,
        sharedFire: !!fireState,
        fireError,
        pivot: 'grip-emitter midpoint',
        emitterSourcePoint: display?.emitterSourcePoint || null, // Original-PNG normalized emission marker, useful for phone-only pivot diagnosis.
        posteriorPosition, // Anatomical body-local anchor before the preserved-world portrait transform.
        mountedLocalPosition: root?.matrix?.elements && !root.matrixAutoUpdate ? { x:root.matrix.elements[12], y:root.matrix.elements[13], z:root.matrix.elements[14] } : root?.position ? { x:root.position.x, y:root.position.y, z:root.position.z } : null, // Exact portrait-local position even under nonuniform actor scaling.
        stowAngleDeg: desiredStowAngleDeg, // Body-space authored tilt survives the portrait-relative quaternion conversion.
        textureReady: !!art?.material?.map?.image,
        placement,
        idleScale: display?.idleScale || 1, // Mobile Pixel Probe compares belt sizing with the authored Neutral stance.
        sourceDimensions: display?.sourceDimensions || null, // Same base PNG plane dimensions as the held torch.
        visibleDimensions: art ? { width: Math.abs(art.scale.x) * (global.HobunjiBeltStowRig?.TORCH_WIDTH || .5), height: Math.abs(art.scale.y) * (global.HobunjiBeltStowRig?.TORCH_HEIGHT || 1.338) } : null, // Confirm full-sized belt art on a phone.
      };
    },
  });
  global.RuntimeFrameScheduler?.register?.('adventuring-torch-belt', sync, {
    phase: 'pre-render', owner: 'AdventuringTorchBelt',
    description: 'Posterior-stowed torch with the held torch\'s recolor, cloth darkening and shared fire motes.',
  });
})(window);
