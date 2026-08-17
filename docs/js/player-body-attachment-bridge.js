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

  let gameDeps = null; // Captures the game's dependency bag for tool/body attachment providers below.

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
    const originalInit = api.init.bind(api); // Preserves DevSpawner's own dependency initialization after this bridge records it.
    api.init = function playerBodyAttachmentAwareInit(injectedDeps) {
      gameDeps = injectedDeps;
      window.ProceduralArmAnimation?.installGameRuntime?.(injectedDeps); // Gives the hand layer the existing playerMesh/toolHolder refs without editing game.js.
      return originalInit(injectedDeps);
    };
    api.__playerBodyAttachmentInitHooked = true;
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
      if (companion.avatarRef?.group) roots.push(companion.avatarRef.group);
    }
    return roots;
  });

  window.PlayerBodyAttachmentBridge = {
    getDebug() {
      const handDebug = window.ProceduralArmAnimation?.getActiveDebug?.().find(entry => entry?.speciesId) || null; // Surfaces hand runtime state through the existing mobile-accessible bridge diagnostics.
      return {
        hasGameDeps: !!gameDeps,
        hasToolHolder: !!gameDeps?.toolHolder,
        proceduralHands: handDebug,
        activeShoulderPets: (window.Combat?.deps?.companionObjects
          ? Array.from(window.Combat.deps.companionObjects).filter(companion =>
              companion?.health > 0
              && companion.stableRole === 'shoulderPet'
              && (companion.master || window.Combat.deps.player) === window.Combat.deps.player)
          : []).length,
      };
    },
  };
})();
