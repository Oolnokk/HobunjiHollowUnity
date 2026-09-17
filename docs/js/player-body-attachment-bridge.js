// Adapts game-owned body-bound attachments into PlayerBodyTransformComposer.
//
// The composer intentionally does not know about companions, tools, or any
// game-specific dependency bag. This thin adapter supplies those roots lazily,
// so ragdoll/drunk/future body channels all inherit to the same attachments
// without any one effect module owning the relationship.
(() => {
  'use strict';

  // This bridge is parser-loaded before game.js creates companion avatars.
  // Request the tiny shoulder-rest decorator here so it can wrap the animal
  // builder before any authored rest-rig creature is constructed.
  if (!window.AnimalShoulderRest) {
    if (document.readyState === 'loading') {
      document.write('<script src="js/animal-shoulder-rest.js?v=20260917rest1"></' + 'script>');
    } else if (!document.querySelector('script[data-animal-shoulder-rest]')) {
      const restScript = document.createElement('script'); // Late-loader fallback for standalone/debug contexts that inject this bridge after parsing.
      restScript.src = 'js/animal-shoulder-rest.js?v=20260917rest1';
      restScript.async = false;
      restScript.dataset.animalShoulderRest = '1';
      document.head.appendChild(restScript);
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

  function shoulderRun1Frame(companion, combatDeps) {
    const genotypeKind = combatDeps?.genotypeKindFor?.(companion) || companion?.creatureKey || companion?.kind || null; // Stable species key used by both raw CREATURE_DB art and genotype composites.
    const directRun = companion?.def?.sprites?.run;
    if (Array.isArray(directRun) && directRun[0]) return { url: directRun[0], genotypeKind };
    if (typeof directRun === 'string' && directRun) return { url: directRun, genotypeKind };
    const geneticsRun1 = window.CreatureGeneticsRender?.SPECIES?.[genotypeKind]?.base?.run1;
    return { url: geneticsRun1 || null, genotypeKind };
  }

  function ensureShoulderPetIdleFrame(companion, combatDeps) {
    const authoredRest = !!companion?.avatarRef?.shoulderRest?.authored; // The checkbox-authored body rest is what opts this pet into run1 presentation.
    const run1 = authoredRest ? shoulderRun1Frame(companion, combatDeps) : { url: null, genotypeKind: null };
    const idleUrl = companion?.def?.sprites?.idle;
    const frameUrl = run1.url || idleUrl; // Rest rigs use run1 when possible; legacy shoulder pets preserve the existing idle-frame behavior.
    const frameName = run1.url ? 'run1' : 'idle';
    if (!frameUrl || typeof combatDeps?.setCreatureFrame !== 'function' || !companion.avatarRef) return false;
    companion.__hobunjiShoulderFrame = frameUrl; // Mobile/debug-readable proof of whichever shouldered presentation frame is active.
    companion.__hobunjiShoulderIdleFrame = frameName === 'idle' ? frameUrl : null; // Retains the legacy diagnostic field only when the old idle presentation is actually in use.
    companion.__hobunjiShoulderRestFrame = frameName === 'run1' ? frameUrl : null; // Distinguishes authored rested run1 presentation from legacy idle.
    if (companion.currentFrameUrl === frameUrl) return true;
    const genotypeKind = run1.genotypeKind || combatDeps.genotypeKindFor?.(companion) || companion.creatureKey || companion.kind || null; // Preserves patterned/recolored livestock through the shared frame compositor.
    combatDeps.setCreatureFrame(companion.avatarRef, frameUrl, genotypeKind, frameName, companion.genotype);
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
        && (companion.master || player) === player; // One role predicate drives both body-rest activation and attachment-root inclusion.
      companion.avatarRef.setShoulderRestEnabled?.(isShoulderPet); // Rest geometry is shoulder-only and is restored to the undeformed bind positions immediately when the role stops applying.
      if (!isShoulderPet) continue;
      if (companion.avatarRef.group) {
        ensureShoulderPetIdleFrame(companion, combatDeps);
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
        : []; // Shared by the count and frame/rest diagnostics below.
      return {
        hasGameDeps: !!gameDeps,
        hasToolHolder: !!gameDeps?.toolHolder,
        proceduralHands: handDebug,
        activeShoulderPets: activeShoulderPets.length,
        shoulderPetsOnIdle: activeShoulderPets.filter(companion => !!companion.__hobunjiShoulderIdleFrame && companion.currentFrameUrl === companion.__hobunjiShoulderIdleFrame).length,
        shoulderPetsOnRestRun1: activeShoulderPets.filter(companion => !!companion.__hobunjiShoulderRestFrame && companion.currentFrameUrl === companion.__hobunjiShoulderRestFrame).length,
        shoulderRestActive: activeShoulderPets.filter(companion => companion?.avatarRef?.shoulderRest?.enabled).length,
      };
    },
  };
})();
