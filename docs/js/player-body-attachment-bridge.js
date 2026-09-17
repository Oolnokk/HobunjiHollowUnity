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

  if (!window.HobunjiGrehlrHeadRigCorrection || Number(window.HobunjiGrehlrHeadRigCorrection.version) < 6) {
    if (!parserLoad('js/grehlr-head-rig-correction.js?v=20260917spline6', 'grehlr-head-rig-correction')) {
      lateLoad('js/grehlr-head-rig-correction.js?v=20260917spline6', 'grehlr-head-rig-correction');
    }
  }
  if (!window.HobunjiShoulderSplineProfiles || Number(window.HobunjiShoulderSplineProfiles.version) < 2) {
    if (!parserLoad('js/animal-shoulder-spline-profiles.js?v=20260917spline2', 'animal-shoulder-spline-profiles')) {
      lateLoad('js/animal-shoulder-spline-profiles.js?v=20260917spline2', 'animal-shoulder-spline-profiles');
    }
  }
  if (!window.AnimalShoulderSpline || Number(window.AnimalShoulderSpline.version) < 10) {
    if (!parserLoad('js/animal-shoulder-spline.js?v=20260917spline10', 'animal-shoulder-spline')) {
      lateLoad('js/animal-shoulder-spline.js?v=20260917spline10', 'animal-shoulder-spline');
    }
  }
  if (!window.HobunjiShoulderSplitLayerParity || Number(window.HobunjiShoulderSplitLayerParity.version) < 2) {
    if (!parserLoad('js/animal-shoulder-spline-layering.js?v=20260917parity2', 'animal-shoulder-spline-layering')) {
      lateLoad('js/animal-shoulder-spline-layering.js?v=20260917parity2', 'animal-shoulder-spline-layering');
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
      } catch (_) {
        idleSource = null;
        rightSource = null;
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
    return `${genotypeKindFor(companion, combatDeps) || ''}|${idle}|${right}|${rightUsesIdle ? 'idle-right' : 'run1-right'}|${split}|zr${rotation}`;
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
    if (companion.__hobunjiShoulderSplitPromise && companion.__hobunjiShoulderSplitKey === key) return true;

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
    }).catch(() => {
      companion.__hobunjiShoulderSplitPromise = null;
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
    companion.__hobunjiShoulderFrame = frameUrl;
    companion.__hobunjiShoulderIdleFrame = frameName === 'idle' ? frameUrl : null;
    companion.__hobunjiShoulderRestFrame = frameName === 'run1' ? frameUrl : null;
    companion.__hobunjiShoulderSplitFrame = null;
    if (companion.currentFrameUrl === frameUrl) return true;
    combatDeps.setCreatureFrame(companion.avatarRef, frameUrl, selected.genotypeKind, frameName, companion.genotype);
    companion.currentFrameUrl = frameUrl;
    return true;
  }

  function restoreAfterShoulderPet(companion, combatDeps) {
    companion.avatarRef?.setShoulderSplitOverlayEnabled?.(false);
    const idle = shoulderIdleFrame(companion, combatDeps);
    if (idle.url && typeof combatDeps?.setCreatureFrame === 'function' && companion.avatarRef && companion.currentFrameUrl !== idle.url) {
      combatDeps.setCreatureFrame(companion.avatarRef, idle.url, idle.genotypeKind, 'idle', companion.genotype);
      companion.currentFrameUrl = idle.url;
    }
    companion.__hobunjiShoulderFrame = null;
    companion.__hobunjiShoulderIdleFrame = null;
    companion.__hobunjiShoulderRestFrame = null;
    companion.__hobunjiShoulderSplitFrame = null;
  }

  if (window.DevSpawner) patchDevSpawner(window.DevSpawner);
  else chainFutureSetter('DevSpawner', patchDevSpawner);

  composer.registerExternalRootProvider('equippedTool', () => gameDeps?.toolHolder || null);

  composer.registerExternalRootProvider('shoulderPets', () => {
    const combatDeps = window.Combat?.deps;
    const player = combatDeps?.player;
    if (!player) return [];
    const roots = [];
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
      };
    },
  };
})();
