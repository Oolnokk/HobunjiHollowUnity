// Adapts game-owned body-bound attachments into PlayerBodyTransformComposer.
//
// The composer intentionally does not know about companions, tools, or any
// game-specific dependency bag. This thin adapter supplies those roots lazily,
// so ragdoll/drunk/future body channels all inherit to the same attachments
// without any one effect module owning the relationship.
(() => {
  'use strict';

  // This bridge is parser-loaded before game.js creates companion avatars.
  // Apply the latest authored Grehlr correction first, then install the generic
  // shoulder-rest decorator so every later avatar build sees the final rig.
  function parserLoad(src, marker) {
    if (document.readyState === 'loading') {
      document.write(`<script data-${marker}="1" src="${src}"></` + 'script>');
      return true;
    }
    return false;
  }
  function lateLoad(src, marker) {
    if (document.querySelector(`script[data-${marker}]`)) return;
    const script = document.createElement('script'); // Late fallback for standalone/debug contexts that inject this bridge after parsing.
    script.src = src;
    script.async = false;
    script.dataset[marker.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())] = '1';
    document.head.appendChild(script);
  }

  if (!window.HobunjiGrehlrHeadRigCorrection || Number(window.HobunjiGrehlrHeadRigCorrection.version) < 3) {
    if (!parserLoad('js/grehlr-head-rig-correction.js?v=20260917rough3','grehlr-head-rig-correction')) lateLoad('js/grehlr-head-rig-correction.js?v=20260917rough3','grehlr-head-rig-correction');
  }
  if (!window.AnimalShoulderRest || Number(window.AnimalShoulderRest.version) < 3) {
    if (!parserLoad('js/animal-shoulder-rest.js?v=20260917curl3','animal-shoulder-rest')) lateLoad('js/animal-shoulder-rest.js?v=20260917curl3','animal-shoulder-rest');
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
    return combatDeps?.genotypeKindFor?.(companion) || companion?.creatureKey || companion?.kind || null; // Stable species key shared by raw art and genotype compositing.
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
    return { url: companion?.def?.sprites?.idle || window.CreatureGeneticsRender?.SPECIES?.[genotypeKind]?.base?.idle || null, genotypeKind };
  }

  function loadFrameImage(url) {
    return new Promise((resolve, reject) => {
      if (!url) return reject(new Error('missing frame URL'));
      const image = new Image(); // Raw-frame fallback used only when the genotype compositor is unavailable.
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`could not load ${url}`));
      image.src = url;
    });
  }

  async function splitFrameCanvas(companion, combatDeps, rest) {
    const kind = genotypeKindFor(companion, combatDeps);
    const renderer = window.CreatureGeneticsRender;
    let idleSource = null, runSource = null;
    if (kind && typeof renderer?.composeFrame === 'function') {
      try {
        [idleSource, runSource] = await Promise.all([
          renderer.composeFrame(kind, 'idle', companion.genotype, false),
          renderer.composeFrame(kind, 'run1', companion.genotype, false),
        ]); // Uses already-genotyped art so coat colors/patterns survive the idle↔run1 fusion.
      } catch (_) {
        idleSource = null; runSource = null;
      }
    }
    if (!idleSource || !runSource) {
      const idle = shoulderIdleFrame(companion, combatDeps), run1 = shoulderRun1Frame(companion, combatDeps);
      if (!idle.url || !run1.url) return null;
      [idleSource, runSource] = await Promise.all([loadFrameImage(idle.url), loadFrameImage(run1.url)]);
    }

    const width = Number(idleSource.width || idleSource.naturalWidth) || Number(runSource.width || runSource.naturalWidth) || 1;
    const height = Number(idleSource.height || idleSource.naturalHeight) || Number(runSource.height || runSource.naturalHeight) || 1;
    const canvas = document.createElement('canvas'); // One cached PNG result is passed through the existing creature frame swapper.
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const authoredSplit = Number(rest?.frameShiftX); // Zero is a valid left-edge seam, so do not use truthiness for the fallback.
    const split = Number.isFinite(authoredSplit) ? Math.max(0, Math.min(1, authoredSplit)) : 0.5;
    const cut = Math.round(width * split);
    ctx.clearRect(0, 0, width, height);
    if (cut > 0) ctx.drawImage(idleSource, 0, 0, cut, height, 0, 0, cut, height);
    if (cut < width) ctx.drawImage(runSource, cut, 0, width - cut, height, cut, 0, width - cut, height);
    return canvas;
  }

  function splitFrameKey(companion, combatDeps, rest) {
    const idle = shoulderIdleFrame(companion, combatDeps).url || '';
    const run1 = shoulderRun1Frame(companion, combatDeps).url || '';
    const authoredSplit = Number(rest?.frameShiftX); // Preserves exact 0 and 1 seam positions in the composite cache key.
    const split = Math.round((Number.isFinite(authoredSplit) ? Math.max(0, Math.min(1, authoredSplit)) : 0.5) * 1000);
    return `${genotypeKindFor(companion, combatDeps) || ''}|${idle}|${run1}|${split}`; // Companion-local cache also implicitly keys the stable genotype instance.
  }

  function ensureSplitShoulderFrame(companion, combatDeps, rest) {
    const key = splitFrameKey(companion, combatDeps, rest);
    if (companion.__hobunjiShoulderSplitKey === key && companion.__hobunjiShoulderSplitUrl) {
      const url = companion.__hobunjiShoulderSplitUrl;
      companion.__hobunjiShoulderFrame = url;
      companion.__hobunjiShoulderSplitFrame = url;
      companion.__hobunjiShoulderIdleFrame = null;
      companion.__hobunjiShoulderRestFrame = null;
      if (companion.currentFrameUrl !== url && typeof combatDeps?.setCreatureFrame === 'function') {
        combatDeps.setCreatureFrame(companion.avatarRef, url, null, 'idle', null); // Composite is already genotyped; do not recolor it a second time.
        companion.currentFrameUrl = url;
      }
      return true;
    }
    if (companion.__hobunjiShoulderSplitPromise && companion.__hobunjiShoulderSplitKey === key) return true;
    companion.__hobunjiShoulderSplitKey = key;
    companion.__hobunjiShoulderSplitPromise = splitFrameCanvas(companion, combatDeps, rest).then(canvas => {
      if (!canvas || companion.__hobunjiShoulderSplitKey !== key) return null;
      const url = canvas.toDataURL('image/png'); // Same-origin/generated canvas; cached on the companion until its authored split changes.
      companion.__hobunjiShoulderSplitUrl = url;
      companion.__hobunjiShoulderSplitPromise = null;
      const stillShouldered = companion?.health > 0 && companion.stableRole === 'shoulderPet' && (companion.master || combatDeps?.player) === combatDeps?.player;
      if (stillShouldered && companion.avatarRef?.shoulderRest?.splitFrame && typeof combatDeps?.setCreatureFrame === 'function') {
        combatDeps.setCreatureFrame(companion.avatarRef, url, null, 'idle', null);
        companion.currentFrameUrl = url;
        companion.__hobunjiShoulderFrame = url;
        companion.__hobunjiShoulderSplitFrame = url;
      }
      return url;
    }).catch(() => { companion.__hobunjiShoulderSplitPromise = null; return null; });
    return true;
  }

  function ensureShoulderPetPresentationFrame(companion, combatDeps) {
    const rest = companion?.avatarRef?.shoulderRest;
    const authoredRest = !!rest?.authored;
    if (authoredRest && rest.splitFrame) {
      ensureSplitShoulderFrame(companion, combatDeps, rest);
      if (companion.__hobunjiShoulderSplitUrl) return true;
      // Use idle while the one-time split canvas is being composed.
    }

    let selected = authoredRest && rest.useRun1 ? shoulderRun1Frame(companion, combatDeps) : shoulderIdleFrame(companion, combatDeps);
    let frameName = authoredRest && rest.useRun1 && selected.url ? 'run1' : 'idle';
    if (frameName === 'run1' && !selected.url) {
      selected = shoulderIdleFrame(companion, combatDeps); // Explicit fallback so missing run1 never leaves a stale prior animation frame on the shoulder.
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
        && (companion.master || player) === player; // One role predicate drives both spline activation and attachment-root inclusion.
      companion.avatarRef.setShoulderRestEnabled?.(isShoulderPet); // Method itself checks the independent useSpline flag; frame presentation is handled separately below.
      if (!isShoulderPet) continue;
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
        shoulderSplineActive: activeShoulderPets.filter(companion => companion?.avatarRef?.shoulderRest?.enabled).length,
      };
    },
  };
})();
