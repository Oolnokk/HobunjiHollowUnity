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
  let handDeadzoneCompensationRad = 0; // Latest player-hand local-Y correction copied from the procedural feet rig.
  let handDeadzoneSource = 'none'; // Mobile/Pixel-Probe-readable source for the current hand-facing correction.
  let handDeadzoneUpdates = 0; // Number of frames where a player hand root actually needed a new correction.

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

  function wrapPi(value) {
    let angle = Number(value) || 0;
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  function playerFeetRoot(playerMesh) {
    if (!playerMesh?.isObject3D) return null;
    return (playerMesh.children || []).find(child => String(child?.name || '') === 'player_procedural_feet')
      || (playerMesh.children || []).find(child => child?.getObjectByName?.('left_hip') && child?.getObjectByName?.('right_hip'))
      || null;
  }

  function playerHandRoots(playerMesh) {
    if (!playerMesh?.isObject3D) return [];
    return (playerMesh.children || []).filter(child => /_procedural_hands$/i.test(String(child?.name || '')));
  }

  // The PNG billboard alone uses perpClamp. The procedural legs already undo that
  // snap by rotating their child root by rawFacing - playerMeshFacing. Hands are
  // 3D attachments too, so copy the ALREADY-RESOLVED leg correction rather than
  // reimplementing the camera dead-zone rules here. This also automatically goes
  // back to zero in mount/fish-catch branches where the leg code disables its
  // own dead-zone counter-rotation.
  function syncProceduralHandDeadzone() {
    const playerMesh = gameDeps?.playerMesh || composer.getPlayerMesh?.() || null;
    if (!playerMesh) {
      handDeadzoneCompensationRad = 0;
      handDeadzoneSource = 'no-player-mesh';
      return;
    }

    const feet = playerFeetRoot(playerMesh);
    const hands = playerHandRoots(playerMesh);
    if (!feet || feet.parent !== playerMesh) {
      handDeadzoneCompensationRad = 0;
      handDeadzoneSource = 'no-player-feet-authority';
      return;
    }

    const correction = wrapPi(feet.rotation?.y);
    handDeadzoneCompensationRad = correction;
    handDeadzoneSource = 'procedural-feet';
    for (const root of hands) {
      if (!root?.rotation || Math.abs(wrapPi(root.rotation.y - correction)) < 1e-8) continue;
      root.rotation.y = correction;
      root.updateMatrix?.();
      root.updateMatrixWorld?.(true);
      handDeadzoneUpdates += 1;
    }
  }

  function syncHandDeadzoneFrame() {
    syncProceduralHandDeadzone();
    requestAnimationFrame(syncHandDeadzoneFrame);
  }
  requestAnimationFrame(syncHandDeadzoneFrame);

  window.PlayerBodyAttachmentBridge = {
    syncProceduralHandDeadzone,
    getDebug() {
      const handDebug = window.ProceduralHandAttachments?.getActiveDebug?.().find(entry => entry?.speciesId) || null;
      const playerMesh = gameDeps?.playerMesh || composer.getPlayerMesh?.() || null;
      return {
        hasGameDeps: !!gameDeps,
        hasToolHolder: !!gameDeps?.toolHolder,
        proceduralHands: handDebug,
        handDeadzoneSource,
        handDeadzoneCompensationDeg: handDeadzoneCompensationRad * 180 / Math.PI,
        handDeadzonePlayerRoots: playerHandRoots(playerMesh).length,
        handDeadzoneUpdates,
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