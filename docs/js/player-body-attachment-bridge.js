// Adapts game-owned body-bound attachments into PlayerBodyTransformComposer.
//
// The composer intentionally does not know about companions, tools, or any
// game-specific dependency bag. This thin adapter supplies those roots lazily,
// so ragdoll/drunk/future body channels all inherit to the same attachments
// without any one effect module owning the relationship.
(() => {
  'use strict';

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

  function ensureShoulderPetIdleFrame(companion, combatDeps) {
    const frameUrl = companion?.def?.sprites?.idle; // Uses the creature's own authored idle pose while it is perched on the player.
    if (!frameUrl || typeof combatDeps?.setCreatureFrame !== 'function' || !companion.avatarRef) return false;
    companion.__hobunjiShoulderIdleFrame = frameUrl; // Mobile/debug-readable proof of the shouldered presentation frame.
    if (companion.currentFrameUrl === frameUrl) return true;
    const genotypeKind = combatDeps.genotypeKindFor?.(companion) || companion.creatureKey || companion.kind || null; // Preserves patterned/recolored livestock through the shared frame compositor.
    combatDeps.setCreatureFrame(companion.avatarRef, frameUrl, genotypeKind, 'idle', companion.genotype);
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
      if (!companion || companion.health <= 0 || companion.stableRole !== 'shoulderPet') continue;
      if ((companion.master || player) !== player) continue;
      if (companion.avatarRef?.group) {
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
        : []; // Shared by the count and idle-frame diagnostics below.
      return {
        hasGameDeps: !!gameDeps,
        hasToolHolder: !!gameDeps?.toolHolder,
        proceduralHands: handDebug,
        activeShoulderPets: activeShoulderPets.length,
        shoulderPetsOnIdle: activeShoulderPets.filter(companion => !!companion.__hobunjiShoulderIdleFrame && companion.currentFrameUrl === companion.__hobunjiShoulderIdleFrame).length,
      };
    },
  };
})();
