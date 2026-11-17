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

  if (!window.HobunjiGrehlrHeadRigCorrection || Number(window.HobunjiGrehlrHeadRigCorrection.version) < 7) {
    if (!parserLoad('js/grehlr-head-rig-correction.js?v=20260917uploads1', 'grehlr-head-rig-correction')) {
      lateLoad('js/grehlr-head-rig-correction.js?v=20260917uploads1', 'grehlr-head-rig-correction');
    }
  }
  if (window.HobunjiAuthoredAnimalHeadRigs?.version !== '2026-11-16-moot-painted-baby-pets1') {
    if (!parserLoad('js/animal-head-rig-authored.js?v=20261116mootPaint132b', 'animal-head-rig-authored')) {
      lateLoad('js/animal-head-rig-authored.js?v=20261116mootPaint132b', 'animal-head-rig-authored');
    }
  }
  if (!window.HobunjiShoulderSplineProfiles || Number(window.HobunjiShoulderSplineProfiles.version) < 5) {
    if (!parserLoad('js/animal-shoulder-spline-profiles.js?v=20261115groundRoster5', 'animal-shoulder-spline-profiles')) {
      lateLoad('js/animal-shoulder-spline-profiles.js?v=20261115groundRoster5', 'animal-shoulder-spline-profiles');
    }
  }
  if (!window.AnimalShoulderSpline || Number(window.AnimalShoulderSpline.version) < 10) {
    if (!parserLoad('js/animal-shoulder-spline.js?v=20260917spline10', 'animal-shoulder-spline')) {
      lateLoad('js/animal-shoulder-spline.js?v=20260917spline10', 'animal-shoulder-spline');
    }
  }
  if (!window.HobunjiShoulderSplitLayerParity || Number(window.HobunjiShoulderSplitLayerParity.version) < 3) {
    if (!parserLoad('js/animal-shoulder-spline-layering.js?v=20261115shoulderStencil4', 'animal-shoulder-spline-layering')) {
      lateLoad('js/animal-shoulder-spline-layering.js?v=20261115shoulderStencil4', 'animal-shoulder-spline-layering');
    }
  }

  const composer = window.PlayerBodyTransformComposer;
  if (!composer || window.__playerBodyAttachmentBridgeInstalled) return;
  window.__playerBodyAttachmentBridgeInstalled = true;

  let gameDeps = null;

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
      window.ProceduralHandAttachments?.installGameRuntime?.(injectedDeps);
      return originalInit(injectedDeps);
    };
    api.__playerBodyAttachmentInitHooked = true;
  }

  function genotypeKindFor(companion, combatDeps) {
    return combatDeps?.genotypeKindFor?.(companion) || companion?.creatureKey || companion?.kind || null;
  }

  function authoredShoulderRestFor(companion, combatDeps) {
    const kind = genotypeKindFor(companion, combatDeps);
    const rawRig = kind ? window.CreatureGeneticsRender?.headRigForKind?.(kind) : null;
    return rawRig?.shoulderRest || null;
  }

  function effectiveShoulderRest(companion, combatDeps) {
    const runtime = companion?.avatarRef?.shoulderRest;
    const authored = authoredShoulderRestFor(companion, combatDeps);
    return runtime || authored ? { ...(runtime || {}), ...(authored || {}) } : null;
  }

  function splineAllowedFor(companion, combatDeps) {
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
  const smallPetHeadDebug = { applied: 0, failed: 0, lastError: null }; // In-game mobile diagnostic for small-pet head processing.
  function needsSmallPetHead(companion, combatDeps) {
    const kind = genotypeKindFor(companion, combatDeps); // Actual genotype species, never a visual-size guess.
    return !!window.BabyAnimalHeadWarp?.isSmallSizeVariantPet?.(kind, companion?.genotype, companion?.stableRole);
  }
  function warpSmallPetSource(source, kind) {
    const warp = window.BabyAnimalHeadWarp; // The final genotype image already contains base color, patterns and eyes.
    if (!warp || !source) return source;
    const width = Number(source.naturalWidth || source.width), height = Number(source.naturalHeight || source.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return source;
    const canvas = typeof source.getContext === 'function' ? source : document.createElement('canvas');
    if (canvas !== source) {
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(source, 0, 0, width, height);
    }
    return warp.applyToCanvas(canvas, kind); // Produces independent texture; the genotype cache remains unchanged.
  }
  function smallPetVisualKey(companion, combatDeps, frameName) {
    const kind = genotypeKindFor(companion, combatDeps);
    const renderer = window.CreatureGeneticsRender, warp = window.BabyAnimalHeadWarp;
    const signature = renderer?.genotypeSignature?.(kind, companion?.genotype) || JSON.stringify(companion?.genotype || {});
    const frame = warp?.frameForKind?.(kind);
    return [kind, frameName, signature, warp?.scaleForKind?.(kind) || 1,
      frame ? [frame.x, frame.y, frame.width, frame.height].join(',') : 'no-frame'].join('|'); // Cache invalidates when genotype, frame, head box or percent changes.
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
        if (companion.currentFrameUrl !== existing.url) {
          combatDeps.setCreatureFrame(companion.avatarRef, existing.url, null, 'idle', null); // Already carries eyes, coat and recolored patterns.
          companion.currentFrameUrl = existing.url;
        }
        companion.__hobunjiShoulderFrame = existing.url;
        companion.__hobunjiShoulderIdleFrame = frameName === 'idle' ? existing.url : null;
        companion.__hobunjiShoulderRestFrame = frameName === 'run1' ? existing.url : null;
        companion.__hobunjiShoulderSplitFrame = null;
        return true;
      }
      if (existing.pending) return true; // One in-flight composition per selected appearance.
      if (Date.now() < (existing.retryAt || 0)) return true; // Failed assets retry after cooldown, not on every render tick.
    }
    const entry = { key, url: null, pending: true }; // Owns completion; stale async callbacks cannot repaint a newer frame.
    smallPetHeadFrameCache.set(companion, entry);
    Promise.resolve().then(async () => {
      const warp = window.BabyAnimalHeadWarp;
      let mask = await warp?.ensureIdleMask?.(kind); // Prefer the original idle art, not genotype-specific run/eye overlays.
      if (!mask && !renderer?.SPECIES?.[kind]?.base?.idle) {
        const idleUrl = shoulderIdleFrame(companion, combatDeps).url; // Rare species without a genotype compositor still own an idle sprite.
        if (idleUrl) mask = await warp?.ensureIdleMask?.(kind, await loadFrameImage(idleUrl));
      }
      if (!mask) throw new Error(warp?.debugSnapshot?.()?.lastMaskError || 'No opaque head pixels in the idle frame');
      let composed = null;
      try { composed = await renderer?.composeFrame?.(kind, frameName, companion.genotype, false); }
      catch (error) {
        if (renderer?.SPECIES?.[kind]) throw error; // A supported species must retry its own eyes/coat, never cache a plain fallback.
        smallPetHeadDebug.lastError = 'Unsupported genotype, using raw sprite: ' + String(error?.message || error);
      }
      if (composed) return composed; // Final compositor includes eyes, recolors and coat patterns whenever supported.
      if (renderer?.SPECIES?.[kind]) throw new Error(`Incomplete ${kind}/${frameName} pet genotype frame`);
      const rawUrl = (frameName === 'run1' ? shoulderRun1Frame(companion, combatDeps) : shoulderIdleFrame(companion, combatDeps)).url;
      return loadFrameImage(rawUrl); // Unsupported species still get head growth on their uncomposited source PNG.
    }).then(composed => {
      if (!composed) throw new Error('Neither genotype compositor nor raw sprite supplied this pose');
      const enlarged = warpSmallPetSource(composed, kind);
      if (!enlarged || enlarged === composed) throw new Error(window.BabyAnimalHeadWarp?.debugSnapshot?.()?.lastError || 'No enlargable painted head frame');
      const url = enlarged.toDataURL('image/png');
      if (smallPetHeadFrameCache.get(companion) !== entry) return;
      entry.url = url;
      entry.pending = false;
      smallPetHeadDebug.applied++;
      const owner = combatDeps?.player;
      if (companion.health > 0 && companion.stableRole === 'shoulderPet'
        && (companion.master || owner) === owner && !effectiveShoulderRest(companion, combatDeps)?.splitFrame) {
        combatDeps.setCreatureFrame(companion.avatarRef, url, null, 'idle', null);
        companion.currentFrameUrl = url;
      }
    }).catch(error => {
      if (smallPetHeadFrameCache.get(companion) !== entry) return;
      entry.pending = false;
      entry.retryAt = Date.now() + 2000; // A temporarily failed head frame must not poison the companion's visual key forever.
      smallPetHeadDebug.failed++;
      smallPetHeadDebug.lastError = String(error?.message || error); // Visible through PlayerBodyAttachmentBridge.getDebug() on mobile.
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
        idleSource = await renderer.composeFrame(kind, 'idle', companion.genotype, false);
        rightSource = rightUsesIdle ? idleSource : await renderer.composeFrame(kind, 'run1', companion.genotype, false);
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
      const mask = await window.BabyAnimalHeadWarp?.ensureIdleMask?.(kind, idleSource); // Authoritative raw idle if registered, otherwise the left idle image.
      if (!mask) {
        smallPetHeadDebug.failed++;
        smallPetHeadDebug.lastError = String(window.BabyAnimalHeadWarp?.debugSnapshot?.()?.lastMaskError || 'No readable idle-head opacity mask for shoulder split');
      }
      const left = mask ? warpSmallPetSource(idleSource, kind) : idleSource; // All genotype pattern and eye pixels already exist; warp before seam clipping.
      const right = rightUsesIdle ? left : mask ? warpSmallPetSource(rightSource, kind) : rightSource;
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
    const smallHead = needsSmallPetHead(companion, combatDeps) ? smallPetVisualKey(companion, combatDeps, 'split') : 'normal-head';
    return `${genotypeKindFor(companion, combatDeps) || ''}|${idle}|${right}|${rightUsesIdle ? 'idle-right' : 'run1-right'}|${split}|zr${rotation}|${smallHead}`;
  }

  function applySplitLayers(companion, combatDeps, rightUrl, leftCanvas, fallbackUrl = null) {
    if (!rightUrl || !leftCanvas || !companion?.avatarRef) return false;
    const layered = typeof companion.avatarRef.setShoulderSplitOverlayCanvas === 'function';
    const frameUrl = layered ? rightUrl : (fallbackUrl || rightUrl);
    if (layered) companion.avatarRef.setShoulderSplitOverlayCanvas(leftCanvas, true);
    companion.__hobunjiShoulderFrame = frameUrl;
    companion.__hobunjiShoulderSplitFrame = frameUrl;
    companion.__hobunjiShoulderIdleFrame = null;
    companion.__hobunjiShoulderRestFrame = null;
    if (companion.currentFrameUrl !== frameUrl && typeof combatDeps?.setCreatureFrame === 'function') {
      combatDeps.setCreatureFrame(companion.avatarRef, frameUrl, null, 'idle', null);
      companion.currentFrameUrl = frameUrl;
    }
    return true;
  }

  function ensureSplitShoulderFrame(companion, combatDeps, rest) {
    const key = splitFrameKey(companion, combatDeps, rest);
    if (companion.__hobunjiShoulderSplitKey === key && companion.__hobunjiShoulderSplitUrl && companion.__hobunjiShoulderSplitLeftCanvas) {
      return applySplitLayers(companion, combatDeps, companion.__hobunjiShoulderSplitUrl, companion.__hobunjiShoulderSplitLeftCanvas, companion.__hobunjiShoulderSplitFallbackUrl);
    }
    if (companion.__hobunjiShoulderSplitKey === key) {
      if (companion.__hobunjiShoulderSplitPromise) return true;
      if (Date.now() < (companion.__hobunjiShoulderSplitRetryAt || 0)) return true; // Avoid per-frame retries when source art temporarily fails.
    }

    companion.avatarRef?.setShoulderSplitOverlayEnabled?.(false);
    companion.__hobunjiShoulderSplitKey = key;
    companion.__hobunjiShoulderSplitPromise = splitFrameLayers(companion, combatDeps, rest).then(layers => {
      if (!layers || companion.__hobunjiShoulderSplitKey !== key) return null;
      const rightUrl = layers.rightCanvas.toDataURL('image/png');
      const fallbackCanvas = combinedSplitFallbackCanvas(layers);
      const fallbackUrl = fallbackCanvas?.toDataURL?.('image/png') || rightUrl;
      companion.__hobunjiShoulderSplitUrl = rightUrl;
      companion.__hobunjiShoulderSplitFallbackUrl = fallbackUrl;
      companion.__hobunjiShoulderSplitLeftCanvas = layers.leftCanvas;
      companion.__hobunjiShoulderSplitPromise = null;
      const stillShouldered = companion?.health > 0
        && companion.stableRole === 'shoulderPet'
        && (companion.master || combatDeps?.player) === combatDeps?.player;
      if (stillShouldered && effectiveShoulderRest(companion, combatDeps)?.splitFrame) {
        applySplitLayers(companion, combatDeps, rightUrl, layers.leftCanvas, fallbackUrl);
      }
      return rightUrl;
    }).catch(error => {
      if (companion.__hobunjiShoulderSplitKey !== key) return null; // An old rejected request cannot alter newer split ownership.
      companion.__hobunjiShoulderSplitPromise = null;
      companion.__hobunjiShoulderSplitRetryAt = Date.now() + 2000; // Retry without permanently accepting a plain split frame.
      smallPetHeadDebug.failed++;
      smallPetHeadDebug.lastError = String(error?.message || error);
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
    if (needsSmallPetHead(companion, combatDeps)) {
      // A rare genetically Small pet gets the same head pixels as a baby. Naturally Small adults skip this entire branch.
      return ensureSmallPetHeadFrame(companion, combatDeps, frameName);
    }
    companion.__hobunjiShoulderFrame = frameUrl;
    companion.__hobunjiShoulderIdleFrame = frameName === 'idle' ? frameUrl : null;
    companion.__hobunjiShoulderRestFrame = frameName === 'run1' ? frameUrl : null;
    companion.__hobunjiShoulderSplitFrame = null;
    const geneticRenderer = window.CreatureGeneticsRender; // Determines whether this shoulder frame needs a composed CanvasTexture, not merely a loaded plain PNG.
    const expectsGenotype = !!(companion.genotype && geneticRenderer?.SPECIES?.[selected.genotypeKind]); // Only species with a registered compositor need a ready check.
    const signature = expectsGenotype ? geneticRenderer.genotypeSignature?.(selected.genotypeKind, companion.genotype) : null; // Color Pools/pattern mutations invalidate the same-URL shoulder frame.
    const currentMap = companion.avatarRef?.frontPlane?.material?.map; // The actual display texture, not the requested source sprite URL.
    const composedReady = !expectsGenotype || (currentMap?.isCanvasTexture === true && companion._shoulderPresentedSignature === signature);
    if (companion.currentFrameUrl === frameUrl && composedReady) return true;
    if (expectsGenotype && Date.now() < (companion._shoulderGenotypeRetryAt || 0)) return true; // Retry cold genotypes at a bounded cadence, not every render frame.
    const applied = combatDeps.setCreatureFrame(companion.avatarRef, frameUrl, selected.genotypeKind, frameName, companion.genotype);
    const actualMap = companion.avatarRef?.frontPlane?.material?.map; // Refresh after the authoritative game texture swap.
    const fullAppearance = !expectsGenotype || (applied !== false && actualMap?.isCanvasTexture === true); // A declined swap may leave an older tinted canvas bound; it is not proof the requested genotype arrived.
    companion._shoulderGenotypeRetryAt = expectsGenotype && !fullAppearance ? Date.now() + 150 : 0; // Plain fallbacks are temporary even when setCreatureFrame returned success.
    if (applied !== false) companion.currentFrameUrl = frameUrl; // A deferred genotype frame must never be marked complete.
    if (fullAppearance) companion._shoulderPresentedSignature = signature;
    return applied !== false;
  }

  function restoreAfterShoulderPet(companion, combatDeps) {
    companion.avatarRef?.setShoulderSplitOverlayEnabled?.(false);
    const idle = shoulderIdleFrame(companion, combatDeps);
    if (idle.url && typeof combatDeps?.setCreatureFrame === 'function' && companion.avatarRef && companion.currentFrameUrl !== idle.url) {
      const applied = combatDeps.setCreatureFrame(companion.avatarRef, idle.url, idle.genotypeKind, 'idle', companion.genotype);
      if (applied !== false) companion.currentFrameUrl = idle.url; // Never mark a failed post-shoulder restore as complete.
    }
    companion.__hobunjiShoulderFrame = null;
    companion.__hobunjiShoulderIdleFrame = null;
    companion.__hobunjiShoulderRestFrame = null;
    companion.__hobunjiShoulderSplitFrame = null;
    smallPetHeadFrameCache.delete(companion); // Invalidate callbacks when an animal leaves the shoulder.
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
        const isShoulderPet = companion.health > 0
          && companion.stableRole === 'shoulderPet'
          && (companion.master || player) === player;
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
        smallPetHead: { ...smallPetHeadDebug, active: activeShoulderPets.filter(companion => needsSmallPetHead(companion, window.Combat?.deps)).length }, // Debug overlay distinguishes eligibility from texture-read failures.
      };
    },
  };
})();
