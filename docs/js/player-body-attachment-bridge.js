// Adapts game-owned body-bound attachments into PlayerBodyTransformComposer.
//
// Shoulder pets also use this bridge as the one place where authored shoulder
// presentation becomes active/inactive with the stable role. The actual body
// deformation is owned by animal-shoulder-spline.js; this file only handles
// frame selection/layer composition and role gating.
(() => {
  'use strict';

  function parserLoad(src, marker) {
    if (document.readyState === 'loading') {
      document.write(`<script data-${marker}="1" src="${src}"></` + 'script>');
      return true;
    }
    return false;
  }

  function lateLoad(src, marker) {
    if (document.querySelector(`script[data-${marker}]`)) return;
    const script = document.createElement('script'); // Fallback for debug contexts that inject this bridge after parser startup.
    script.src = src;
    script.async = false;
    script.dataset[marker.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = '1';
    document.head.appendChild(script);
  }

  if (!window.HobunjiGrehlrHeadRigCorrection || Number(window.HobunjiGrehlrHeadRigCorrection.version) < 10) {
    if (!parserLoad('js/grehlr-head-rig-correction.js?v=20261118GrehlrCorr10', 'grehlr-head-rig-correction')) {
      lateLoad('js/grehlr-head-rig-correction.js?v=20261118GrehlrCorr10', 'grehlr-head-rig-correction');
    }
  }
  if (window.HobunjiAuthoredAnimalHeadRigs?.version !== '2026-11-18-nine-authored-rigs2') {
    if (!parserLoad('js/animal-head-rig-authored.js?v=20261123h77c301d', 'animal-head-rig-authored')) {
      lateLoad('js/animal-head-rig-authored.js?v=20261123h77c301d', 'animal-head-rig-authored');
    }
  }
  if (!window.HobunjiShoulderSplineProfiles || Number(window.HobunjiShoulderSplineProfiles.version) < 5) {
    if (!parserLoad('js/animal-shoulder-spline-profiles.js?v=20261115groundRoster5', 'animal-shoulder-spline-profiles')) {
      lateLoad('js/animal-shoulder-spline-profiles.js?v=20261115groundRoster5', 'animal-shoulder-spline-profiles');
    }
  }
  if (!window.AnimalShoulderSpline || Number(window.AnimalShoulderSpline.version) < 10) {
    if (!parserLoad('js/animal-shoulder-spline.js?v=20261119h401d940', 'animal-shoulder-spline')) {
      lateLoad('js/animal-shoulder-spline.js?v=20261119h401d940', 'animal-shoulder-spline');
    }
  }
  if (!window.HobunjiShoulderSplitLayerParity || Number(window.HobunjiShoulderSplitLayerParity.version) < 3) {
    if (!parserLoad('js/animal-shoulder-spline-layering.js?v=20261117animalWireSpawn1', 'animal-shoulder-spline-layering')) {
      lateLoad('js/animal-shoulder-spline-layering.js?v=20261117animalWireSpawn1', 'animal-shoulder-spline-layering');
    }
  }

  const composer = window.PlayerBodyTransformComposer;
  if (!composer || window.__playerBodyAttachmentBridgeInstalled) return;
  window.__playerBodyAttachmentBridgeInstalled = true;

  let gameDeps = null;

  function ownsCreatureFrame(creature) {
    const player = window.Combat?.deps?.player; // The shoulder presenter and ordinary creature animator share this exact ownership test.
    return !!(player && creature?.health > 0 && creature.stableRole === 'shoulderPet'
      && creature.avatarRef?.group && (creature.master || player) === player);
  }

  function chainFutureSetter(name, beforeSet) {
    const desc = Object.getOwnPropertyDescriptor(window, name);
    const previousSet = desc?.set;
    if (typeof previousSet !== 'function') return false;
    Object.defineProperty(window, name, {
      configurable: true,
      get: desc.get,
      set(value) {
        beforeSet?.(value);
        previousSet.call(window, value);
      },
    });
    return true;
  }

  function patchDevSpawner(api) {
    if (!api?.init || api.__playerBodyAttachmentInitHooked) return;
    const originalInit = api.init.bind(api);
    api.init = function playerBodyAttachmentAwareInit(injectedDeps) {
      gameDeps = injectedDeps;
      // The scene-level weapon holder shares the same portrait and standing floor as the player.
      if (injectedDeps?.toolHolder?.userData && injectedDeps.playerMesh) {
        injectedDeps.toolHolder.userData.hobunjiHeldPortraitOwner = injectedDeps.playerMesh;
      }
      window.ProceduralHandAttachments?.installGameRuntime?.(injectedDeps);
      return originalInit(injectedDeps);
    };
    api.__playerBodyAttachmentInitHooked = true;
  }

  function genotypeKindFor(companion, combatDeps) {
    return combatDeps?.genotypeKindFor?.(companion) || companion?.creatureKey || companion?.kind || null;
  }

  function authoredShoulderRestFor(companion, combatDeps) {
    if (companion?.def?.isFlyingSpecies) return null; // Native folded-wing perch, never a mammal curl.
    const kind = genotypeKindFor(companion, combatDeps);
    const rawRig = kind ? window.CreatureGeneticsRender?.headRigForKind?.(kind) : null;
    return rawRig?.shoulderRest || null;
  }

  function effectiveShoulderRest(companion, combatDeps) {
    if (companion?.def?.isFlyingSpecies) return null; // Do not inherit a stale baked rest profile.
    const runtime = companion?.avatarRef?.shoulderRest;
    const authored = authoredShoulderRestFor(companion, combatDeps);
    return runtime || authored ? { ...(runtime || {}), ...(authored || {}) } : null;
  }

  function splineAllowedFor(companion, combatDeps) {
    if (companion?.def?.isFlyingSpecies) return false;
    const kind = genotypeKindFor(companion, combatDeps);
    return !!window.HobunjiShoulderSplineProfiles?.allows?.(kind);
  }

  function shoulderRun1Frame(companion, combatDeps) {
    const genotypeKind = genotypeKindFor(companion, combatDeps);
    const directRun = companion?.def?.sprites?.run;
    if (Array.isArray(directRun) && directRun[0]) return { url: directRun[0], genotypeKind };
    if (typeof directRun === 'string' && directRun) return { url: directRun, genotypeKind };
    const geneticsRun1 = window.CreatureGeneticsRender?.SPECIES?.[genotypeKind]?.base?.run1;
    return { url: geneticsRun1 || null, genotypeKind };
  }

  function shoulderIdleFrame(companion, combatDeps) {
    const genotypeKind = genotypeKindFor(companion, combatDeps);
    return {
      url: companion?.def?.sprites?.idle || window.CreatureGeneticsRender?.SPECIES?.[genotypeKind]?.base?.idle || null,
      genotypeKind,
    };
  }

  function loadFrameImage(url) {
    return new Promise((resolve, reject) => {
      if (!url) return reject(new Error('missing frame URL'));
      const image = new Image();
      image.decoding = 'async';
      image.crossOrigin = 'anonymous'; // Remote fallback sprite pixels must be readable before head enlargement.
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`could not load ${url}`));
      image.src = url;
    });
  }

  function drawSplitSide(ctx, image, width, height, rest, keepRight) {
    const polygon = window.AnimalShoulderSpline?.separatorPolygon?.(width, height, rest, keepRight);
    if (!polygon?.length) return false;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i].x, polygon[i].y);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(image, 0, 0, width, height);
    ctx.restore();
    return true;
  }

  const smallPetHeadFrameCache = new WeakMap(); // Per-pet async composed sprite, reused across repeated render-provider calls.
  const smallPetAppearanceKeys = new WeakMap(); // Memoized genotype/authoring signatures; avoids localStorage and paint scans on every render.
  const smallPetEligibility = new WeakMap(); // Caches the expensive size-class genetics query for an unchanged pet.
  const SMALL_PET_SIGNATURE_REFRESH_MS = 250; // Bound in-place genotype/edit propagation without recomputing it every frame.
  const MAX_SHOULDER_SPRITE_PIXELS = 1024 * 1024; // Worn pets occupy a tiny fraction of the screen: limit 6.75MP source raster uploads.
  const smallPetHeadDebug = { applied: 0, failed: 0, downsampled: 0, reusedOverlays: 0, overwritesRestored: 0, temporaryTexturesReleased: 0, lastError: null }; // Mobile diagnostics distinguish initial growth from recovery after another texture writer.

  function reportShoulderHeadFailure(kind, error) {
    smallPetHeadDebug.failed++;
    smallPetHeadDebug.lastError = String(error?.message || error); // Exposed in the existing mobile portrait diagnostic snapshot.
    if (smallPetHeadDebug.failed <= 3) {
      window.__farmLog?.('[shoulder-head] could not complete ' + (kind || 'pet')
        + ' head/split portrait: ' + smallPetHeadDebug.lastError, 'warn', 'render'); // Touch-accessible debug log, throttled across retries.
    }
  }

  function shoulderFrameMap(plane) {
    return (window.PNGPlaneAvatar?.meshBudget?.originalPortraitMaterial?.(plane) || plane?.material)?.map || null;
  }

  function shoulderTextureIsBound(companion, url, binding) {
    const avatar = companion?.avatarRef; // Compare actual rendered maps, not just a URL string that animation may leave unchanged.
    if (!binding || binding.url !== url || binding.avatar !== avatar || companion.currentFrameUrl !== url) return false;
    return shoulderFrameMap(avatar?.frontPlane) === binding.frontMap
      && shoulderFrameMap(avatar?.backPlane) === binding.backMap;
  }
  function bindShoulderTexture(companion, combatDeps, url, binding, spriteWarp = null) {
    companion.avatarRef?.setAnimalSpriteWarp?.(spriteWarp); // Keep cached and rebuilt avatars aligned with the frame being bound.
    if (shoulderTextureIsBound(companion, url, binding)) return false;
    if (binding.url === url && binding.avatar === companion.avatarRef) {
      smallPetHeadDebug.overwritesRestored++;
      if (smallPetHeadDebug.overwritesRestored <= 3) {
        const kind = companion.creatureKey || companion.kind || 'pet'; // Limits mobile debug warnings to the first three unexpected overwrites.
        window.__farmLog?.('[shoulder-head] restored enlarged/split portrait after competing texture write: ' + kind,
          'warn', 'render');
      }
    }
    // setCreatureFrame binds a shared source texture synchronously. Its false result only means a genotype composite was not used.
    combatDeps.setCreatureFrame(companion.avatarRef, url, null, 'idle', null);
    companion.currentFrameUrl = url;
    binding.url = url;
    binding.avatar = companion.avatarRef;
    binding.frontMap = shoulderFrameMap(companion.avatarRef?.frontPlane);
    binding.backMap = shoulderFrameMap(companion.avatarRef?.backPlane);
    return true;
  }
  function needsSmallPetHead(companion, combatDeps) {
    const kind = genotypeKindFor(companion, combatDeps); // Actual genotype species, never a visual-size guess.
    const previous = smallPetEligibility.get(companion), now = Date.now();
    if (previous?.kind === kind && previous?.genotype === companion?.genotype && previous?.role === companion?.stableRole
        && now < previous.refreshAt) return previous.eligible;
    const eligible = !!window.BabyAnimalHeadWarp?.isSmallSizeVariantPet?.(kind, companion?.genotype, companion?.stableRole);
    smallPetEligibility.set(companion, { kind, genotype: companion?.genotype, role: companion?.stableRole, eligible,
      refreshAt: now + SMALL_PET_SIGNATURE_REFRESH_MS });
    return eligible;
  }
  function warpSmallPetSource(source, kind) {
    const warp = window.BabyAnimalHeadWarp; // The final genotype image already contains base color, patterns and eyes.
    if (!warp || !source) return source;
    const width = Number(source.naturalWidth || source.width), height = Number(source.naturalHeight || source.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return source;
    const ratio = Math.min(1, Math.sqrt(MAX_SHOULDER_SPRITE_PIXELS / (width * height)));
    const targetW = Math.max(1, Math.floor(width * ratio)), targetH = Math.max(1, Math.floor(height * ratio));
    const canvas = typeof source.getContext === 'function' && ratio === 1 ? source : document.createElement('canvas');
    if (canvas !== source) {
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false; // Keep nearest-neighbor genotype eyes and pattern details when downsampling huge source art.
      ctx.drawImage(source, 0, 0, targetW, targetH);
      if (ratio < 1) smallPetHeadDebug.downsampled++;
    }
    return warp.applyToCanvas(canvas, kind); // Produces independent texture; the genotype cache remains unchanged.
  }
  function smallPetVisualKey(companion, combatDeps, frameName) {
    const kind = genotypeKindFor(companion, combatDeps), now = Date.now();
    const previous = smallPetAppearanceKeys.get(companion);
    if (previous?.kind === kind && previous?.genotype === companion?.genotype && previous?.frameName === frameName
        && now < previous.refreshAt) return previous.key;
    const renderer = window.CreatureGeneticsRender, warp = window.BabyAnimalHeadWarp;
    const signature = renderer?.genotypeSignature?.(kind, companion?.genotype) || JSON.stringify(companion?.genotype || {});
    const frame = warp?.frameForKind?.(kind);
    const key = [kind, frameName, signature, warp?.scaleForKind?.(kind) || 1,
      warp?.shorteningForKind?.(kind) ?? 0, warp?.maskModeForKind?.(kind) || 'idle-alpha',
      (() => { const body = warp?.abdomenForKind?.(kind); return body?.enabled
        ? ['abdomen', body.scale, body.frame?.x, body.frame?.y, body.frame?.width, body.frame?.height].join(',') : 'no-abdomen'; })(),
      frame ? [frame.x, frame.y, frame.width, frame.height].join(',') : 'no-frame'].join('|');
    smallPetAppearanceKeys.set(companion, { kind, genotype: companion?.genotype, frameName, key,
      refreshAt: now + SMALL_PET_SIGNATURE_REFRESH_MS }); // In-place mutations and rig preview edits are rechecked within 250ms.
    return key;
  }
  function headRequiresIdleMask(kind) {
    return window.BabyAnimalHeadWarp?.maskModeForKind?.(kind) !== 'legacy-frame'; // Original painted-box method does not require a source alpha readback.
  }
  function releasePetSpriteUrl(url) {
    if (typeof url !== 'string' || !url.startsWith('blob:')) return; // Identical data-URL fallbacks may still be bound by another pet.
    if (window.Combat?.deps?.releaseCreatureTemporaryFrameTexture?.(url)) {
      smallPetHeadDebug.temporaryTexturesReleased++; // Mobile debug counter for generated textures freed from game.js's URL cache.
    }
    if (url.startsWith('blob:') && typeof URL !== 'undefined') {
      try { URL.revokeObjectURL?.(url); } catch (_) {} // An object URL alone does not release its game-owned GPU cache entry.
    }
  }
  function canvasAsSpriteUrl(canvas) {
    if (typeof canvas?.toBlob !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function')
      return Promise.resolve(canvas.toDataURL('image/png')); // Node fixtures and older browser compatibility.
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
      if (!blob) return reject(new Error('Shoulder-pet PNG encoding returned no data'));
      resolve(URL.createObjectURL(blob)); // Async encoding avoids synchronous giant base64 PNG writes on equip.
    }, 'image/png'));
  }
  function recordSingleShoulderFrame(companion, url, frameName) {
    companion.__hobunjiShoulderFrame = url; // Exposes the completed grown texture to companion debug and single-frame presentation.
    companion.__hobunjiShoulderIdleFrame = frameName === 'idle' ? url : null;
    companion.__hobunjiShoulderRestFrame = frameName === 'run1' ? url : null;
    companion.__hobunjiShoulderSplitFrame = null;
  }

  function ensureSmallPetHeadFrame(companion, combatDeps, frameName) {
    if (!needsSmallPetHead(companion, combatDeps)) return false;
    const kind = genotypeKindFor(companion, combatDeps);
    const renderer = window.CreatureGeneticsRender;
    if (typeof combatDeps?.setCreatureFrame !== 'function' || !companion.avatarRef) return false; // Raw-asset fallback supports eligible species without a genotype compositor.
    const key = smallPetVisualKey(companion, combatDeps, frameName);
    const existing = smallPetHeadFrameCache.get(companion);
    if (existing?.key === key) {
      if (existing.url) {
        bindShoulderTexture(companion, combatDeps, existing.url, existing, existing.spriteWarp); // Recovers if animation or a rig rebuild replaced the actual GPU map.
        recordSingleShoulderFrame(companion, existing.url, frameName); // Cache hits and fresh async completion publish the same presentation metadata.
        return true;
      }
      if (existing.pending) return true; // One in-flight composition per selected appearance.
      if (Date.now() < (existing.retryAt || 0)) return true; // Failed assets retry after cooldown, not on every render tick.
    }
    const previousUrl = existing?.url || existing?.previousUrl; // Keep the currently displayed blob reachable through retries.
    const entry = { key, url: null, previousUrl, pending: true }; // Owns completion; stale async callbacks cannot repaint a newer frame.
    smallPetHeadFrameCache.set(companion, entry);
    Promise.resolve().then(async () => {
      const warp = window.BabyAnimalHeadWarp;
      const wantsGrowth = (warp?.scaleForKind?.(kind) ?? 1) > 1 || (warp?.shorteningForKind?.(kind) ?? 0) > 0; // Skips unnecessary alpha-mask work when the user requests original proportions.
      if (wantsGrowth && headRequiresIdleMask(kind)) {
        let mask = await warp?.ensureIdleMask?.(kind); // Prefer the original idle art, not genotype-specific run/eye overlays.
        if (!mask && !renderer?.SPECIES?.[kind]?.base?.idle) {
          const idleUrl = shoulderIdleFrame(companion, combatDeps).url;
          if (idleUrl) mask = await warp?.ensureIdleMask?.(kind, await loadFrameImage(idleUrl));
        }
        if (!mask) throw new Error(warp?.debugSnapshot?.()?.lastMaskError || 'No opaque head pixels in the idle frame');
      }
      let composed = null;
      try { composed = await renderer?.composeFrame?.(kind, frameName, companion.genotype, false, { priority: 'pet' }); }
      catch (error) {
        if (renderer?.SPECIES?.[kind]) throw error; // A supported species must retry its own eyes/coat, never cache a plain fallback.
        smallPetHeadDebug.lastError = 'Unsupported genotype, using raw sprite: ' + String(error?.message || error);
      }
      if (composed) return composed; // Final compositor includes eyes, recolors and coat patterns whenever supported.
      if (renderer?.SPECIES?.[kind]) throw new Error(`Incomplete ${kind}/${frameName} pet genotype frame`);
      const rawUrl = (frameName === 'run1' ? shoulderRun1Frame(companion, combatDeps) : shoulderIdleFrame(companion, combatDeps)).url;
      return loadFrameImage(rawUrl); // Unsupported species still get head growth on their uncomposited source PNG.
    }).then(async composed => {
      if (!composed) throw new Error('Neither genotype compositor nor raw sprite supplied this pose');
      const enlarged = warpSmallPetSource(composed, kind);
      if (!enlarged || (enlarged === composed && ((window.BabyAnimalHeadWarp?.scaleForKind?.(kind) ?? 1) > 1
        || (window.BabyAnimalHeadWarp?.shorteningForKind?.(kind) ?? 0) > 0))) {
        throw new Error(window.BabyAnimalHeadWarp?.debugSnapshot?.()?.lastError || 'No enlargable painted head frame');
      } // The user's 100%/0% experimental setting intentionally produces unwarped art, not a failed portrait.
      const url = await canvasAsSpriteUrl(enlarged);
      if (smallPetHeadFrameCache.get(companion) !== entry) {
        releasePetSpriteUrl(url); // Old pending equip cannot leak its encoded image.
        return;
      }
      entry.url = url;
      entry.spriteWarp = window.BabyAnimalHeadWarp?.rigWarpForCanvas?.(enlarged); // Preserve the mapping after the temporary canvas is freed.
      entry.pending = false;
      smallPetHeadDebug.applied++;
      const owner = combatDeps?.player;
      if (companion.health > 0 && companion.stableRole === 'shoulderPet'
        && (companion.master || owner) === owner && !effectiveShoulderRest(companion, combatDeps)?.splitFrame) {
        bindShoulderTexture(companion, combatDeps, url, entry, entry.spriteWarp); // Keep a reference to the maps actually bound, not just their URL.
        recordSingleShoulderFrame(companion, url, frameName); // Newly completed sprites are observable immediately, without a second render/provider tick.
      }
      if (entry.previousUrl && entry.previousUrl !== url) releasePetSpriteUrl(entry.previousUrl);
      entry.previousUrl = null; // A genotype/proportions change replaces the prior encoded portrait.
    }).catch(error => {
      if (smallPetHeadFrameCache.get(companion) !== entry) return;
      entry.pending = false;
      entry.retryAt = Date.now() + 2000; // A temporarily failed head frame must not poison the companion's visual key forever.
      reportShoulderHeadFailure(kind, error); // Missing masks/genotype colors retry without silently accepting adult-shaped art.
    });
    return true;
  }

  async function splitFrameLayers(companion, combatDeps, rest) {
    const kind = genotypeKindFor(companion, combatDeps);
    const renderer = window.CreatureGeneticsRender;
    const rightUsesIdle = !!rest?.splitRightUsesIdle;
    let idleSource = null;
    let rightSource = null;

    if (kind && typeof renderer?.composeFrame === 'function') {
      try {
        idleSource = await renderer.composeFrame(kind, 'idle', companion.genotype, false, { priority: 'pet' });
        rightSource = rightUsesIdle ? idleSource : await renderer.composeFrame(kind, 'run1', companion.genotype, false, { priority: 'pet' });
      } catch (error) {
        if (renderer?.SPECIES?.[kind]) throw error; // Preserve painted split layers; retry temporary compositor failures.
        idleSource = null;
        rightSource = null;
      }
      if ((!idleSource || !rightSource) && renderer?.SPECIES?.[kind]) {
        throw new Error(`Incomplete shoulder split genotype for ${kind}`);
      }
    }

    if (!idleSource || !rightSource) {
      const idle = shoulderIdleFrame(companion, combatDeps);
      if (!idle.url) return null;
      idleSource = await loadFrameImage(idle.url);
      if (rightUsesIdle) rightSource = idleSource;
      else {
        const run1 = shoulderRun1Frame(companion, combatDeps);
        if (!run1.url) return null;
        rightSource = await loadFrameImage(run1.url);
      }
    }

    if (needsSmallPetHead(companion, combatDeps)) {
      const warp = window.BabyAnimalHeadWarp; // The same committed baby-head settings used by the nursery and single-frame pet portrait.
      const wantsGrowth = (warp?.scaleForKind?.(kind) ?? 1) > 1 || (warp?.shorteningForKind?.(kind) ?? 0) > 0;
      const mask = wantsGrowth && headRequiresIdleMask(kind) ? await warp?.ensureIdleMask?.(kind, idleSource) : true; // No alpha readback when painted mode or 100%/0%.
      if (!mask) throw new Error(warp?.debugSnapshot?.()?.lastMaskError || 'No readable idle-head opacity mask for shoulder split');
      const left = warpSmallPetSource(idleSource, kind); // Grow already-composited eyes, coat and pattern pixels before seam clipping.
      const right = rightUsesIdle ? left : warpSmallPetSource(rightSource, kind);
      if (wantsGrowth && (left === idleSource || right === rightSource)) {
        throw new Error('Shoulder split head enlargement unavailable for ' + kind);
      }
      idleSource = left;
      rightSource = right;
    }
    const width = Number(idleSource.width || idleSource.naturalWidth) || Number(rightSource.width || rightSource.naturalWidth) || 1;
    const height = Number(idleSource.height || idleSource.naturalHeight) || Number(rightSource.height || rightSource.naturalHeight) || 1;
    const leftCanvas = document.createElement('canvas');
    const rightCanvas = document.createElement('canvas');
    leftCanvas.width = rightCanvas.width = width;
    leftCanvas.height = rightCanvas.height = height;
    const leftCtx = leftCanvas.getContext('2d');
    const rightCtx = rightCanvas.getContext('2d');
    leftCtx.clearRect(0, 0, width, height);
    rightCtx.clearRect(0, 0, width, height);
    drawSplitSide(leftCtx, idleSource, width, height, rest, false);
    drawSplitSide(rightCtx, rightSource, width, height, rest, true);
    return {
      leftCanvas,
      rightCanvas,
      spriteWarp: window.BabyAnimalHeadWarp?.rigWarpForCanvas?.(rightSource), // Both split halves share the pose dimensions and warp.
      width,
      height,
      rightUsesIdle,
      frameShiftX: Number(rest?.frameShiftX) || 0,
      separatorRotationDeg: Number(rest?.separatorRotationDeg) || 0,
    };
  }

  function combinedSplitFallbackCanvas(layers) {
    if (!layers) return null;
    const canvas = document.createElement('canvas');
    canvas.width = layers.width;
    canvas.height = layers.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layers.rightCanvas, 0, 0);
    ctx.drawImage(layers.leftCanvas, 0, 0);
    return canvas;
  }

  function splitFrameKey(companion, combatDeps, rest) {
    const idle = shoulderIdleFrame(companion, combatDeps).url || '';
    const rightUsesIdle = !!rest?.splitRightUsesIdle;
    const right = rightUsesIdle ? idle : (shoulderRun1Frame(companion, combatDeps).url || '');
    const authoredSplit = Number(rest?.frameShiftX);
    const split = Math.round((Number.isFinite(authoredSplit) ? Math.max(0, Math.min(1, authoredSplit)) : 0.5) * 1000);
    const rotation = Math.round((Number(rest?.separatorRotationDeg) || 0) * 10);
    const kind = genotypeKindFor(companion, combatDeps);
    const smallHead = needsSmallPetHead(companion, combatDeps) ? smallPetVisualKey(companion, combatDeps, 'split') : 'normal-head';
    const genotypeKey = companion.genotype
      ? window.CreatureGeneticsRender?.genotypeSignature?.(kind, companion.genotype) ?? JSON.stringify(companion.genotype)
      : 'no-genotype'; // A naturally Small adult's split frame still needs recoloring when its genes change.
    return `${kind || ''}|${idle}|${right}|${rightUsesIdle ? 'idle-right' : 'run1-right'}|${split}|zr${rotation}|${genotypeKey}|${smallHead}`;
  }

  function applySplitLayers(companion, combatDeps, rightUrl, leftCanvas, fallbackUrl = null, spriteWarp = null) {
    if (!rightUrl || !leftCanvas || !companion?.avatarRef) return false;
    const layered = typeof companion.avatarRef.setShoulderSplitOverlayCanvas === 'function';
    const frameUrl = layered ? rightUrl : (fallbackUrl || rightUrl);
    if (layered) {
      if (companion.__hobunjiShoulderOverlayCanvas !== leftCanvas || companion.__hobunjiShoulderOverlayAvatar !== companion.avatarRef) {
        companion.avatarRef.setShoulderSplitOverlayCanvas(leftCanvas, true); // Upload each unique overlay exactly once, never once per draw.
        companion.__hobunjiShoulderOverlayCanvas = leftCanvas;
        companion.__hobunjiShoulderOverlayAvatar = companion.avatarRef;
      } else {
        companion.avatarRef.setShoulderSplitOverlayEnabled?.(true); // Role changes can hide an existing texture without invalidating it.
        smallPetHeadDebug.reusedOverlays++;
      }
    }
    companion.__hobunjiShoulderFrame = frameUrl;
    companion.__hobunjiShoulderSplitFrame = frameUrl;
    companion.__hobunjiShoulderIdleFrame = null;
    companion.__hobunjiShoulderRestFrame = null;
    if (typeof combatDeps?.setCreatureFrame === 'function') {
      const binding = companion.__hobunjiShoulderSplitBinding || (companion.__hobunjiShoulderSplitBinding = {}); // Retains the expected GPU maps across split-animation and blink updates.
      bindShoulderTexture(companion, combatDeps, frameUrl, binding, spriteWarp);
    }
    return true;
  }

  function ensureSplitShoulderFrame(companion, combatDeps, rest) {
    const key = splitFrameKey(companion, combatDeps, rest);
    const request = companion.__hobunjiShoulderSplitRequest; // In-flight work and the last completed frame have separate lifetimes.
    if (companion.__hobunjiShoulderSplitKey === key && companion.__hobunjiShoulderSplitUrl) {
      companion.__hobunjiShoulderSplitRequest = null; // Reverting a change cancels the obsolete composition.
      return applySplitLayers(companion, combatDeps, companion.__hobunjiShoulderSplitUrl, companion.__hobunjiShoulderSplitLeftCanvas, companion.__hobunjiShoulderSplitFallbackUrl, companion.__hobunjiShoulderSplitWarp);
    }
    if (companion.__hobunjiShoulderSplitUrl) {
      // Keep the previous pair and its skin together while the new pair is being prepared or retried.
      applySplitLayers(companion, combatDeps, companion.__hobunjiShoulderSplitUrl, companion.__hobunjiShoulderSplitLeftCanvas, companion.__hobunjiShoulderSplitFallbackUrl, companion.__hobunjiShoulderSplitWarp);
    }
    if (request?.key === key && (request.pending || Date.now() < request.retryAt)) return true;

    const next = { key, pending: true, retryAt: 0 }; // Check request identity to handle A→B→A changes during PNG encoding.
    companion.__hobunjiShoulderSplitRequest = next;
    splitFrameLayers(companion, combatDeps, rest).then(async layers => {
      if (companion.__hobunjiShoulderSplitRequest !== next) return null;
      if (!layers) throw new Error('Shoulder split pose sources unavailable; retrying after asset recovery');
      const rightUrl = await canvasAsSpriteUrl(layers.rightCanvas);
      const layered = typeof companion.avatarRef?.setShoulderSplitOverlayCanvas === 'function';
      const fallbackCanvas = layered ? null : combinedSplitFallbackCanvas(layers); // Don't render/encode an unused second giant PNG.
      let fallbackUrl = rightUrl;
      try { if (fallbackCanvas) fallbackUrl = await canvasAsSpriteUrl(fallbackCanvas); }
      catch (error) { releasePetSpriteUrl(rightUrl); throw error; }
      if (companion.__hobunjiShoulderSplitRequest !== next) {
        releasePetSpriteUrl(rightUrl);
        if (fallbackUrl !== rightUrl) releasePetSpriteUrl(fallbackUrl);
        return null;
      }
      const previousRightUrl = companion.__hobunjiShoulderSplitUrl;
      const previousFallbackUrl = companion.__hobunjiShoulderSplitFallbackUrl;
      companion.__hobunjiShoulderSplitKey = key; // Publish the key, art and warp together.
      companion.__hobunjiShoulderSplitUrl = rightUrl;
      companion.__hobunjiShoulderSplitFallbackUrl = fallbackUrl;
      companion.__hobunjiShoulderSplitLeftCanvas = layers.leftCanvas;
      companion.__hobunjiShoulderSplitWarp = layers.spriteWarp;
      companion.__hobunjiShoulderSplitRequest = null;
      const stillShouldered = companion?.health > 0
        && companion.stableRole === 'shoulderPet'
        && (companion.master || combatDeps?.player) === combatDeps?.player;
      if (stillShouldered && effectiveShoulderRest(companion, combatDeps)?.splitFrame) {
        applySplitLayers(companion, combatDeps, rightUrl, layers.leftCanvas, fallbackUrl, layers.spriteWarp);
      }
      if (previousRightUrl && previousRightUrl !== rightUrl) releasePetSpriteUrl(previousRightUrl);
      if (previousFallbackUrl && previousFallbackUrl !== previousRightUrl && previousFallbackUrl !== fallbackUrl)
        releasePetSpriteUrl(previousFallbackUrl);
      return rightUrl;
    }).catch(error => {
      if (companion.__hobunjiShoulderSplitRequest !== next) return null; // An old rejected request cannot alter newer split ownership.
      next.pending = false;
      next.retryAt = Date.now() + 2000; // Retry without permanently accepting a plain split frame.
      reportShoulderHeadFailure(genotypeKindFor(companion, combatDeps), error); // Failed two-layer art can retry after asset recovery.
      return null;
    });
    return true;
  }

  function ensureShoulderPetPresentationFrame(companion, combatDeps) {
    const rest = effectiveShoulderRest(companion, combatDeps);
    const authoredRest = !!(rest && (rest.authored || authoredShoulderRestFor(companion, combatDeps)));
    if (authoredRest && rest.splitFrame) {
      ensureSplitShoulderFrame(companion, combatDeps, rest);
      if (companion.__hobunjiShoulderSplitUrl && companion.__hobunjiShoulderSplitLeftCanvas) return true;
      if (needsSmallPetHead(companion, combatDeps)) return true; // Pending split owns both head-warped layers; do not compose a redundant single frame.
    } else {
      companion.__hobunjiShoulderSplitRequest = null;
      companion.avatarRef?.setShoulderSplitOverlayEnabled?.(false);
    }

    let selected = authoredRest && rest.useRun1 ? shoulderRun1Frame(companion, combatDeps) : shoulderIdleFrame(companion, combatDeps);
    let frameName = authoredRest && rest.useRun1 && selected.url ? 'run1' : 'idle';
    if (frameName === 'run1' && !selected.url) {
      selected = shoulderIdleFrame(companion, combatDeps);
      frameName = 'idle';
    }
    const frameUrl = selected.url;
    if (!frameUrl || typeof combatDeps?.setCreatureFrame !== 'function' || !companion.avatarRef) return false;
    if (!companion?.def?.isFlyingSpecies && needsSmallPetHead(companion, combatDeps)) {
      // A rare genetically Small pet gets the same head pixels as a baby. Naturally Small adults skip this entire branch.
      return ensureSmallPetHeadFrame(companion, combatDeps, frameName);
    }
    companion.avatarRef?.setAnimalSpriteWarp?.(null);
    companion.__hobunjiShoulderFrame = frameUrl;
    companion.__hobunjiShoulderIdleFrame = frameName === 'idle' ? frameUrl : null;
    companion.__hobunjiShoulderRestFrame = frameName === 'run1' ? frameUrl : null;
    companion.__hobunjiShoulderSplitFrame = null;
    const geneticRenderer = window.CreatureGeneticsRender; // Determines whether this shoulder frame needs a composed CanvasTexture, not merely a loaded plain PNG.
    const expectsGenotype = !!(companion.genotype && geneticRenderer?.SPECIES?.[selected.genotypeKind]); // Only species with a registered compositor need a ready check.
    const signature = expectsGenotype ? geneticRenderer.genotypeSignature?.(selected.genotypeKind, companion.genotype) : null; // Color Pools/pattern mutations invalidate the same-URL shoulder frame.
    const currentMap = shoulderFrameMap(companion.avatarRef?.frontPlane); // The actual display texture, not the requested source sprite URL.
    const currentBackMap = shoulderFrameMap(companion.avatarRef?.backPlane); // Prevent an independent back-card overwrite from going unnoticed.
    const composedReady = !expectsGenotype || (currentMap?.isCanvasTexture === true && companion._shoulderPresentedSignature === signature);
    const mapsUnchanged = companion._shoulderPresentedAvatar === companion.avatarRef
      && companion._shoulderPresentedFrontMap === (currentMap || null)
      && companion._shoulderPresentedBackMap === (currentBackMap || null);
    if (companion.currentFrameUrl === frameUrl && composedReady && mapsUnchanged) return true;
    if (expectsGenotype && Date.now() < (companion._shoulderGenotypeRetryAt || 0)) return true; // Retry cold genotypes at a bounded cadence, not every render frame.
    const applied = combatDeps.setCreatureFrame(companion.avatarRef, frameUrl, selected.genotypeKind, frameName, companion.genotype, false, 'pet');
    const actualMap = shoulderFrameMap(companion.avatarRef?.frontPlane); // Refresh after the authoritative game texture swap.
    const fullAppearance = !expectsGenotype || (applied !== false && actualMap?.isCanvasTexture === true); // A declined swap may leave an older tinted canvas bound; it is not proof the requested genotype arrived.
    companion._shoulderGenotypeRetryAt = expectsGenotype && !fullAppearance ? Date.now() + 150 : 0; // Plain fallbacks are temporary even when setCreatureFrame returned success.
    if (applied !== false) companion.currentFrameUrl = frameUrl; // A deferred genotype frame must never be marked complete.
    if (fullAppearance) {
      companion._shoulderPresentedSignature = signature;
      companion._shoulderPresentedAvatar = companion.avatarRef;
      companion._shoulderPresentedFrontMap = actualMap || null;
      companion._shoulderPresentedBackMap = shoulderFrameMap(companion.avatarRef?.backPlane);
    }
    return applied !== false;
  }

  function restoreAfterShoulderPet(companion, combatDeps) {
    companion.avatarRef?.setAnimalSpriteWarp?.(null);
    companion.avatarRef?.setShoulderSplitOverlayEnabled?.(false);
    const idle = shoulderIdleFrame(companion, combatDeps);
    if (idle.url && typeof combatDeps?.setCreatureFrame === 'function' && companion.avatarRef && companion.currentFrameUrl !== idle.url) {
      const applied = combatDeps.setCreatureFrame(companion.avatarRef, idle.url, idle.genotypeKind, 'idle', companion.genotype, false, 'pet');
      if (applied !== false) companion.currentFrameUrl = idle.url; // Never mark a failed post-shoulder restore as complete.
    }
    companion.__hobunjiShoulderFrame = null;
    companion.__hobunjiShoulderIdleFrame = null;
    companion.__hobunjiShoulderRestFrame = null;
    companion.__hobunjiShoulderSplitFrame = null;
    const cachedHead = smallPetHeadFrameCache.get(companion); // A retry can still own the previously displayed blob.
    releasePetSpriteUrl(cachedHead?.url || cachedHead?.previousUrl); // Blob URLs are external browser resources, not reclaimed by a WeakMap alone.
    releasePetSpriteUrl(companion.__hobunjiShoulderSplitUrl);
    if (companion.__hobunjiShoulderSplitFallbackUrl !== companion.__hobunjiShoulderSplitUrl)
      releasePetSpriteUrl(companion.__hobunjiShoulderSplitFallbackUrl);
    companion.__hobunjiShoulderSplitKey = null; // Cancel in-flight split callbacks when unequipped.
    companion.__hobunjiShoulderSplitBinding = null;
    companion._shoulderPresentedAvatar = null; // Release frame ownership after leaving the perch.
    companion._shoulderPresentedFrontMap = null;
    companion._shoulderPresentedBackMap = null;
    companion._shoulderPresentedSignature = null;
    companion.__hobunjiShoulderSplitUrl = null;
    companion.__hobunjiShoulderSplitFallbackUrl = null;
    companion.__hobunjiShoulderSplitLeftCanvas = null;
    companion.__hobunjiShoulderSplitWarp = null;
    companion.__hobunjiShoulderSplitRequest = null;
    smallPetHeadFrameCache.delete(companion); // Invalidate callbacks when an animal leaves the shoulder.
    smallPetAppearanceKeys.delete(companion);
    smallPetEligibility.delete(companion);
    companion.__hobunjiShoulderOverlayCanvas = null; // Rebind the existing overlay texture if the pet avatar was rebuilt.
    companion.__hobunjiShoulderOverlayAvatar = null;
  }

  if (window.DevSpawner) patchDevSpawner(window.DevSpawner);
  else chainFutureSetter('DevSpawner', patchDevSpawner);

  composer.registerExternalRootProvider('equippedTool', () => gameDeps?.toolHolder || null);

  // WebGLRenderer.prototype.render() can fire more than once per real browser
  // frame (pixel-probe.js's diagnostic isolation renders, farm-panel-core.js's
  // secondary layout render), and this provider runs inside that patched
  // render(). Recomputing effectiveShoulderRest/splitFrameKey and re-running
  // ensureShoulderPetPresentationFrame's side effects on every extra render
  // call multiplies their cost by however many renders happen this frame.
  // RuntimeFrameScheduler.frameId() only advances once per actual rAF tick,
  // so it's used here to memoize the result across same-frame render() calls.
  let cachedShoulderPetsFrameId = -1;
  let cachedShoulderPetsRoots = [];

  composer.registerExternalRootProvider('shoulderPets', () => {
    const frameId = window.RuntimeFrameScheduler?.frameId?.();
    if (frameId != null && frameId === cachedShoulderPetsFrameId) return cachedShoulderPetsRoots;

    const combatDeps = window.Combat?.deps;
    const player = combatDeps?.player;
    const roots = [];
    if (player) {
      for (const companion of combatDeps.companionObjects || []) {
        if (!companion?.avatarRef) continue;
        const isShoulderPet = ownsCreatureFrame(companion); // Same role/owner/visual check used to suppress the base animator.
        const splineAllowed = splineAllowedFor(companion, combatDeps);
        companion.avatarRef.setShoulderRestEnabled?.(isShoulderPet && splineAllowed);
        if (!isShoulderPet) {
          if (companion.__hobunjiWasShoulderPet) restoreAfterShoulderPet(companion, combatDeps);
          companion.__hobunjiWasShoulderPet = false;
          continue;
        }
        companion.__hobunjiWasShoulderPet = true;
        if (companion.avatarRef.group) {
          ensureShoulderPetPresentationFrame(companion, combatDeps);
          roots.push(companion.avatarRef.group);
        }
      }
    }

    if (frameId != null) cachedShoulderPetsFrameId = frameId;
    cachedShoulderPetsRoots = roots;
    return roots;
  });

  window.PlayerBodyAttachmentBridge = {
    ownsCreatureFrame, // Invoked by game.js before any ordinary run/blink texture changes.
    getDebug() {
      const handDebug = window.ProceduralHandAttachments?.getActiveDebug?.().find(entry => entry?.speciesId) || null;
      const activeShoulderPets = window.Combat?.deps?.companionObjects
        ? Array.from(window.Combat.deps.companionObjects).filter(companion =>
          companion?.health > 0
          && companion.stableRole === 'shoulderPet'
          && (companion.master || window.Combat.deps.player) === window.Combat.deps.player)
        : [];
      return {
        hasGameDeps: !!gameDeps,
        hasToolHolder: !!gameDeps?.toolHolder,
        proceduralHands: handDebug,
        activeShoulderPets: activeShoulderPets.length,
        shoulderPetsOnIdle: activeShoulderPets.filter(companion => !!companion.__hobunjiShoulderIdleFrame && companion.currentFrameUrl === companion.__hobunjiShoulderIdleFrame).length,
        shoulderPetsOnRestRun1: activeShoulderPets.filter(companion => !!companion.__hobunjiShoulderRestFrame && companion.currentFrameUrl === companion.__hobunjiShoulderRestFrame).length,
        shoulderPetsOnSplitFrame: activeShoulderPets.filter(companion => !!companion.__hobunjiShoulderSplitFrame && companion.currentFrameUrl === companion.__hobunjiShoulderSplitFrame).length,
        shoulderSplitForegroundVisible: activeShoulderPets.filter(companion => !!companion?.avatarRef?.shoulderRest?.splitOverlayVisible).length,
        shoulderSplitIdleRight: activeShoulderPets.filter(companion => !!effectiveShoulderRest(companion, window.Combat?.deps)?.splitRightUsesIdle).length,
        shoulderSplineActive: activeShoulderPets.filter(companion => companion?.avatarRef?.shoulderRest?.enabled).length,
        shoulderDiagonalSeparators: activeShoulderPets.filter(companion => Math.abs(Number(effectiveShoulderRest(companion, window.Combat?.deps)?.separatorRotationDeg) || 0) > 0.001).length,
        babifiedSkins: activeShoulderPets.filter(companion => companion.avatarRef?.headRig?.spritePivot).length, // Pixel Probe confirms that the rig follows the warped art.
        smallPetHead: { ...smallPetHeadDebug, active: activeShoulderPets.filter(companion => needsSmallPetHead(companion, window.Combat?.deps)).length }, // Debug overlay distinguishes eligibility from texture-read failures.
      };
    },
  };
})();
