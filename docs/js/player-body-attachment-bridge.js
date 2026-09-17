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
  if (!window.AnimalShoulderSpline || Number(window.AnimalShoulderSpline.version) < 7) {
    if (!parserLoad('js/animal-shoulder-spline.js?v=20260917spline7', 'animal-shoulder-spline')) {
      lateLoad('js/animal-shoulder-spline.js?v=20260917spline7', 'animal-shoulder-spline');
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
      const run1 = shoulderRun1Frame(companion, combatDeps);
      try {
        idleSource = await loadFrameImage(idle.url);
        rightSource = rightUsesIdle ? idleSource : await loadFrameImage(run1.url);
      } catch (_) {
        return null;
      }
    }

    const width = idleSource.width || idleSource.naturalWidth || 1;
    const height = idleSource.height || idleSource.naturalHeight || 1;
    const seam = Math.max(0, Math.min(width, Math.round(width * Math.max(0, Math.min(1, Number(rest?.frameShiftX ?? 0.5))))));
    const makeCanvas = () => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; };
    const left = makeCanvas(), right = makeCanvas();
    const leftCtx = left.getContext('2d'), rightCtx = right.getContext('2d');
    if (seam > 0) leftCtx.drawImage(idleSource, 0, 0, seam, height, 0, 0, seam, height);
    if (seam < width) rightCtx.drawImage(rightSource, seam, 0, width - seam, height, seam, 0, width - seam, height);
    return { left, right, seam, width, height };
  }

  async function applyShoulderFramePresentation(companion, combatDeps, rest, isShoulderPet) {
    const avatarRef = companion?.avatarRef;
    if (!avatarRef) return;
    const kind = genotypeKindFor(companion, combatDeps);

    avatarRef.setShoulderRestEnabled?.(isShoulderPet && !!rest?.useSpline && splineAllowedFor(companion, combatDeps));

    if (!isShoulderPet) {
      avatarRef.setShoulderSplitOverlayEnabled?.(false);
      const idle = shoulderIdleFrame(companion, combatDeps);
      if (idle.url) combatDeps?.setCreatureFrame?.(avatarRef, idle.url, idle.genotypeKind, 'idle', companion.genotype);
      return;
    }

    if (rest?.splitFrame) {
      const layers = await splitFrameLayers(companion, combatDeps, rest);
      if (layers) {
        combatDeps?.setCreatureFrameCanvas?.(avatarRef, layers.right, kind, 'shoulderSplitRight', companion.genotype);
        avatarRef.setShoulderSplitOverlayCanvas?.(layers.left, true);
        avatarRef.__hobunjiShoulderFrame = `split:${Math.round((rest.frameShiftX ?? .5) * 100)}:${rest.splitRightUsesIdle ? 'idle' : 'run1'}`;
        return;
      }
    }

    avatarRef.setShoulderSplitOverlayEnabled?.(false);
    if (rest?.useRun1) {
      const run1 = shoulderRun1Frame(companion, combatDeps);
      if (run1.url) {
        combatDeps?.setCreatureFrame?.(avatarRef, run1.url, run1.genotypeKind, 'run1', companion.genotype);
        avatarRef.__hobunjiShoulderFrame = 'run1';
        return;
      }
    }
    const idle = shoulderIdleFrame(companion, combatDeps);
    if (idle.url) combatDeps?.setCreatureFrame?.(avatarRef, idle.url, idle.genotypeKind, 'idle', companion.genotype);
    avatarRef.__hobunjiShoulderFrame = 'idle';
  }

  const shoulderFrameTokens = new WeakMap();
  function requestShoulderPresentation(companion, combatDeps, isShoulderPet) {
    if (!companion?.avatarRef) return;
    const rest = effectiveShoulderRest(companion, combatDeps);
    const token = (shoulderFrameTokens.get(companion) || 0) + 1;
    shoulderFrameTokens.set(companion, token);
    Promise.resolve(applyShoulderFramePresentation(companion, combatDeps, rest, isShoulderPet)).catch(() => {}).then(() => {
      if (shoulderFrameTokens.get(companion) !== token) return;
      window.HobunjiShoulderSplitLayerParity?.syncAvatar?.(companion.avatarRef);
    });
  }

  function installExternalRootProvider() {
    if (window.__playerBodyAttachmentExternalRootProviderInstalled) return;
    window.__playerBodyAttachmentExternalRootProviderInstalled = true;
    composer.registerExternalRootProvider?.('companion-shoulder-pets', ({ player }) => {
      const combatDeps = gameDeps || window.DevSpawner?.deps || null;
      const companions = combatDeps?.companionObjects || window.companionObjects || [];
      const roots = [];
      for (const companion of companions) {
        if (!companion?.avatarRef?.group) continue;
        const isShoulderPet = companion.health > 0
          && companion.stableRole === 'shoulderPet'
          && (companion.master || player) === player;
        if (companion.__hobunjiShoulderPresentationActive !== isShoulderPet) {
          companion.__hobunjiShoulderPresentationActive = isShoulderPet;
          requestShoulderPresentation(companion, combatDeps, isShoulderPet);
        }
        if (!isShoulderPet) continue;
        roots.push(companion.avatarRef.group);
      }
      return roots;
    });
  }

  patchDevSpawner(window.DevSpawner);
  if (!chainFutureSetter('DevSpawner', patchDevSpawner) && !window.DevSpawner) {
    window.addEventListener?.('hobunji-dev-spawner-ready', event => patchDevSpawner(event?.detail || window.DevSpawner), { once: true });
  }
  installExternalRootProvider();

  window.PlayerBodyAttachmentBridge = {
    version: 3,
    patchDevSpawner,
    installExternalRootProvider,
    requestShoulderPresentation,
    effectiveShoulderRest,
  };
})();
